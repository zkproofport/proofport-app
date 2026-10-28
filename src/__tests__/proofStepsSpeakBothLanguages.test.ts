/**
 * The proving screen shows its step names through
 * host.proof.generation.steps.<id>; every id it translates has words in both
 * languages (on 2026-10-29 the Korean screen still read "Generate ZK proof").
 */
import fs from 'fs';
import path from 'path';
import en from '../i18n/locales/en.json';
import ko from '../i18n/locales/ko.json';

const screen = fs.readFileSync(path.join(__dirname, '../screens/proof/ProofGenerationScreen.tsx'), 'utf8');
const block = /TRANSLATED_STEP_IDS: ReadonlySet<string> = new Set\(\[([\s\S]*?)\]\)/.exec(screen);
const ids = block ? [...block[1].matchAll(/'([a-z_]+)'/g)].map(m => m[1]) : [];

type Steps = Record<string, string>;
const stepsOf = (locale: unknown): Steps =>
  (locale as {host: {proof: {generation: {steps: Steps}}}}).host.proof.generation.steps;

describe('proof step names', () => {
  it('the screen names its translated step ids', () => {
    expect(ids.length).toBeGreaterThanOrEqual(10);
  });

  it.each([
    ['en', en],
    ['ko', ko],
  ])('%s has a non-empty label for every one, and nothing extra', (_l, locale) => {
    const steps = stepsOf(locale);
    for (const id of ids) expect(typeof steps[id] === 'string' && steps[id].trim().length > 0).toBe(true);
    expect(Object.keys(steps).sort()).toEqual([...ids].sort());
  });

  it('the Korean labels are not the English ones', () => {
    for (const id of ids) expect(stepsOf(ko)[id]).not.toBe(stepsOf(en)[id]);
  });
});
