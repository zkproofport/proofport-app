/**
 * The proof progress list draws a circle per step and a line down to the next.
 *
 * The line used to start 4px below its circle and stop at a fixed 24px, so on
 * every proof screen the circles and the line visibly did not meet, and a step
 * whose label wrapped left a longer gap. The first circle also showed "?",
 * because it asked Feather for an icon named `wallet`, which Feather has never
 * had.
 */
import fs from 'fs';
import path from 'path';
import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';

jest.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  StyleSheet: {create: (value: unknown) => value, flatten: (value: unknown) => value},
  Animated: {
    View: 'AnimatedView',
    Value: class {
      setValue() {}
    },
    loop: () => ({start: () => undefined}),
    sequence: () => undefined,
    timing: () => undefined,
  },
}));
jest.mock('react-native-vector-icons/Feather', () => 'Feather');
jest.mock('../../context', () => ({
  useThemeColors: () => ({mode: 'dark', colors: {info: {500: '#3B82F6'}}}),
}));

const {StepIndicator, CONNECTOR_MIN_HEIGHT} = require('../ui/organisms/StepIndicator');

const flat = (style: unknown): Record<string, unknown> =>
  Array.isArray(style) ? Object.assign({}, ...style.map(flat)) : ((style as Record<string, unknown>) ?? {});

const LONG = 'A label long enough to wrap onto a second and a third line on a narrow phone';

function render(steps: Array<{id: string; icon: string; label: string; status: string}>) {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(React.createElement(StepIndicator, {steps}));
  });
  return tree;
}

const connectorsOf = (tree: TestRenderer.ReactTestRenderer) =>
  tree.root.findAll(n => (n.type as unknown) === 'View' && flat(n.props.style).width === 2);

let errorSpy: jest.SpyInstance;
beforeEach(() => {
  (globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;
  const original = console.error;
  errorSpy = jest.spyOn(console, 'error').mockImplementation((...args) => {
    if (String(args[0]).startsWith('react-test-renderer is deprecated.')) return;
    original(...args);
  });
});
afterEach(() => errorSpy.mockRestore());

describe('the line between step circles', () => {
  const steps = [
    {id: 'a', icon: 'credit-card', label: 'Wallet connected', status: 'complete'},
    {id: 'b', icon: 'search', label: LONG, status: 'active'},
    {id: 'c', icon: 'cpu', label: 'Generating ZK proof', status: 'pending'},
  ];

  it('draws one line fewer than there are steps', () => {
    expect(connectorsOf(render(steps))).toHaveLength(steps.length - 1);
  });

  it('starts at its circle and grows to reach the next one', () => {
    for (const line of connectorsOf(render(steps))) {
      const style = flat(line.props.style);
      expect(style.marginTop ?? 0).toBe(0);
      expect(style.marginBottom ?? 0).toBe(0);
      expect(style.height).toBeUndefined();
      expect(style.flexGrow).toBe(1);
      expect(style.minHeight).toBe(CONNECTOR_MIN_HEIGHT);
    }
  });

  it('sits in a row that stretches to the label, so a wrapped label still connects', () => {
    const tree = render(steps);
    for (const line of connectorsOf(tree)) {
      const row = line.parent!.parent!;
      expect(flat(row.props.style).flexDirection).toBe('row');
      expect(flat(row.props.style).alignItems).toBe('stretch');
    }
  });

  it('draws no line under a single step, and nothing for none', () => {
    expect(connectorsOf(render([steps[0]]))).toHaveLength(0);
    expect(connectorsOf(render([]))).toHaveLength(0);
  });
});

describe('every step icon exists in the icon font', () => {
  const glyphs = require('react-native-vector-icons/glyphmaps/Feather.json');
  const app = path.resolve(__dirname, '..', '..');
  const sources = [
    'screens/proof/ProofGenerationScreen.tsx',
    'components/ui/organisms/StepIndicator.tsx',
  ];

  it.each(sources)('%s names only icons Feather draws', source => {
    const text = fs.readFileSync(path.join(app, source), 'utf8');
    const named = new Set<string>();
    // `icon: 'x'`, and every branch result in `icon: id === 'a' ? 'x' : 'y'`
    // -- the quoted step ids after `===` are not icons. Only lines that build
    // a step (they carry `status` or a step id) count; prose does not.
    for (const m of text.matchAll(/^.*icon:\s*([^\n]+)$/gm)) {
      if (!/status|s\.id/.test(m[0])) continue;
      for (const q of ('icon: ' + m[1]).matchAll(/(?:icon:|\?|:)\s*'([a-z0-9-]+)'/g)) named.add(q[1]);
    }
    const map = text.match(/const iconMap[^{]*{([^}]*)}/);
    if (map) for (const q of map[1].matchAll(/:\s*'([a-z0-9-]+)'/g)) named.add(q[1]);
    for (const q of text.matchAll(/iconMap\[[^\]]+\]\s*\|\|\s*'([a-z0-9-]+)'/g)) named.add(q[1]);

    expect(named.size).toBeGreaterThan(0);
    expect([...named].filter(name => !(name in glyphs))).toEqual([]);
  });
});
