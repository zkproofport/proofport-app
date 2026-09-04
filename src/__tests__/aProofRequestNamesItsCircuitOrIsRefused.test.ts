/**
 * A proof request that does not name a circuit this app serves is refused.
 *
 * The screen used to open with `route.params?.circuitId || 'coinbase-kyc'` and
 * then test for each known id in turn with no final branch. Two ways to get the
 * wrong proof out of that, and both are real:
 *
 *   name nothing            -> the default fired -> a Coinbase KYC proof
 *   name something unknown  -> every check missed -> a Coinbase KYC proof
 *
 * The second one had already happened. Deep links send the canonical
 * `mdl_kr_age`, the screen only knew `mdl-kr-age`, and the request came back as
 * a Coinbase proof. It was patched by adding the underscore spellings as
 * aliases — which fixes the ids somebody noticed and leaves the shape intact.
 *
 * These cases pin the shape, not the alias list. The three spelling tables the
 * screen used to carry are gone; it keys everything off the canonical id
 * resolved by `canonicalCircuitId`, so what is checked here is that the
 * remaining canonical tables cover the PUBLISHED circuit list and that the
 * refusal has no way back to a default.
 *
 * Measured against `@zkproofport-app/sdk@0.2.12` from the registry.
 */
import * as fs from 'fs';
import * as path from 'path';
import {ALL_CIRCUIT_IDS} from '@zkproofport-app/sdk/circuits';

const SCREEN = path.join(
  __dirname, '..', 'screens', 'proof', 'ProofGenerationScreen.tsx',
);
const source = fs.readFileSync(SCREEN, 'utf8');

/**
 * The screen with comments removed. Needed because the note above
 * FLOW_OF_CANONICAL quotes the exact line that used to cause the bug, and a
 * plain search for that line finds the warning about it and calls the bug
 * present.
 */
const code = source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter(line => !line.trim().startsWith('//'))
  .join('\n');

/** The object literal for `const NAME: ... = { ... }`, as raw text. */
function literalBody(name: string): string {
  const start = source.indexOf(`const ${name}`);
  expect(start).toBeGreaterThan(-1);
  const open = source.indexOf('{', start);
  const close = source.indexOf('\n};', open);
  expect(close).toBeGreaterThan(open);
  return source.slice(open + 1, close);
}

/** Quoted or bare keys, ignoring anything inside a comment line. */
function keysOf(body: string): string[] {
  return body
    .split('\n')
    .filter(line => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
    .map(line => line.match(/^\s*'?([A-Za-z0-9_-]+)'?\s*:/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map(m => m[1]);
}

describe('a proof request names its circuit, or it is refused', () => {
  it('has no default circuit — a request that names none cannot become a Coinbase proof', () => {
    // The exact shape that caused it, and any other spelling of the same idea.
    expect(code).not.toMatch(/circuitId\s*\|\|\s*'/);
    expect(code).not.toMatch(/circuitId\s*\?\?\s*'coinbase/);
    expect(code).toMatch(/route\.params\?\.circuitId\s*\?\?\s*''/);
  });

  it('refuses an unrecognised id instead of generating something', () => {
    // The guard inside handleGenerateProof, and the code it reports.
    expect(code).toMatch(/if\s*\(!flow\s*\|\|\s*!canonical\)\s*\{/);
    expect(code).toMatch(/ErrorCodes\.E2006/);
  });

  it('resolves the id ONCE, through the shared alias table', () => {
    /*
     * The screen must not grow a private translation table again. Three of
     * them lived here (display names, id translation, mDL variant), each
     * listing both spellings of every id, and they drifted apart — which is
     * how the title block came to know only the hyphenated ids.
     */
    expect(code).toMatch(/canonicalCircuitId\(circuitId\)/);
    for (const dead of ['CIRCUIT_CONFIG', 'CIRCUIT_DISPLAY:', 'flowOf(']) {
      expect(code).not.toContain(dead);
    }
  });

  it('every published circuit has a flow, a title and a description', () => {
    /*
     * `Record<CircuitName, …>` already makes this a compile error, but tsc is
     * not what runs in CI on every change — and the failure it would produce
     * ("property missing") does not say that a person would see the wrong
     * heading over their proof.
     */
    const withFlow = new Set(keysOf(literalBody('FLOW_OF_CANONICAL')));
    const withText = new Set(keysOf(literalBody('CIRCUIT_TEXT')));
    for (const circuit of ALL_CIRCUIT_IDS) {
      expect([circuit, withFlow.has(circuit)]).toEqual([circuit, true]);
      expect([circuit, withText.has(circuit)]).toEqual([circuit, true]);
    }
  });

  it('the title and description tables name a DIFFERENT key per circuit', () => {
    /*
     * THE DEFECT THIS PINS. The heading was a ladder of `circuitId === …`
     * comparisons against the hyphenated ids with a catch-all `isMdl` arm that
     * fell through to the OWNERSHIP wording, so `mdl_kr_age` — the spelling a
     * deep link actually carries — proved the age predicate under the
     * ownership heading. Sharing one i18n key between two circuits is the same
     * fault written a different way.
     */
    const body = literalBody('CIRCUIT_TEXT');
    const keys = body.match(/'host\.proof\.generation\.[A-Za-z]+'/g) ?? [];
    expect(keys.length).toBe(ALL_CIRCUIT_IDS.length * 2);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('the mDL variants agree with the flow table', () => {
    // Every circuit mapped to the mdl flow must also have a variant, or the
    // screen takes the mDL path with no idea which predicate to prove.
    const flowBody = literalBody('FLOW_OF_CANONICAL');
    const mdlCanonical = keysOf(flowBody).filter(c =>
      flowBody.includes(`${c}: 'mdl'`),
    );
    expect(mdlCanonical.length).toBeGreaterThan(0);
    const variantIds = new Set(keysOf(literalBody('MDL_VARIANT_OF')));
    for (const canonical of mdlCanonical) {
      expect([canonical, variantIds.has(canonical)]).toEqual([canonical, true]);
    }
    // And nothing else has one: a variant on a non-mDL circuit would send it
    // down the mDL path the moment somebody keyed off the variant instead of
    // the flow.
    expect([...variantIds].sort()).toEqual(mdlCanonical.sort());
  });
});
