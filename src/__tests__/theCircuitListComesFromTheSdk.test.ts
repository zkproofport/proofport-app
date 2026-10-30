/**
 * There is ONE list of circuit ids, it is published, and this app reads it.
 *
 * A survey of this repository found TWENTY-FOUR separate lists of the same
 * seven strings — union types, `Record` literals, `includes([...])` arrays,
 * ladders of `===` comparisons, and a few that built the id by concatenation.
 * They did not agree, and the disagreements were not theoretical:
 *
 *   - the proof screen's heading matched only the HYPHENATED spellings, so a
 *     deep link carrying a canonical id ran one proof under another's title;
 *   - `getCircuitDisplayName` had no rows at all for three circuits and
 *     returned its argument, so the history list showed people a raw route id;
 *   - `giwa_attestation` was "GIWA KYC (Experimental)" in two tables and
 *     "GIWA KYC" in a third;
 *   - `syncDeployments` carried a hand-written list of three, so the other
 *     circuits' verifier addresses never refreshed;
 *   - `'oidc-domain'` was set as a route id that no table anywhere understood.
 *
 * `@zkproofport-app/core/circuits` is now the source of the IDENTIFIERS. The
 * app keeps everything else — paths, addresses, versions, icons, labels,
 * networks, wallet groups — but every one of those tables is keyed by the
 * published id, and this file fails when one of them stops covering the list.
 *
 * The package is `@zkproofport-app/core`, not the customer SDK: the SDK
 * re-exports the same list but brings a relay client, QR codes and bb.js
 * (about 153 MB unpacked) that an app proving on-device does not use. The
 * `/circuits` subpath is imported, not core's root: the subpath has no imports
 * of its own, the root carries on-chain verification and needs ethers.
 *
 * Measured against `@zkproofport-app/core@0.1.1` installed from the registry.
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  ALL_CIRCUIT_IDS,
  EXPERIMENTAL_CIRCUIT_IDS,
  PLANNED_CIRCUIT_IDS,
  SUPPORTED_CIRCUIT_IDS,
  isCircuitId,
} from '@zkproofport-app/core/circuits';
import {
  ROUTE_CIRCUIT_IDS,
  canonicalCircuitId,
} from '../config/circuitIds';
import {
  BROADCAST_PATHS,
  CIRCUITS_WITH_BROADCAST,
  CIRCUIT_DATA_VERSIONS,
  CIRCUIT_FILE_PATHS,
  CIRCUIT_NETWORKS,
  FALLBACK_VERIFIERS,
} from '../config/contracts';
import {NETWORK_INDEPENDENT_CIRCUITS, USER_FACING_NETWORKS} from '../config/networks';
import {getCircuitDisplayName, getCircuitIcon} from '../utils/circuit';
import {getProofRequestPresentation} from '../utils/proofRequestPresentation';

const SRC = path.join(__dirname, '..');
const read = (...p: string[]) => fs.readFileSync(path.join(SRC, ...p), 'utf8');

/** Every .ts / .tsx under src/, excluding tests. */
function sourceFiles(dir: string = SRC): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      out.push(...sourceFiles(full));
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/** A source file with block and line comments stripped. */
function codeOf(file: string): string {
  return fs
    .readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(line => !line.trim().startsWith('//'))
    .join('\n');
}

describe('the identifiers come from the published SDK', () => {
  it('CONTRACT: the SDK is the list — five canonical ids, none of them hyphenated', () => {
    /*
     * Not an assertion about the SDK's content so much as a statement of what
     * every other case here is measured against. If this number changes, a
     * circuit was added or removed upstream and the cases below say which of
     * this app's tables have not caught up.
     */
    expect(ALL_CIRCUIT_IDS.length).toBe(6);
    for (const id of ALL_CIRCUIT_IDS) {
      expect([id, /^[a-z][a-z0-9_]*$/.test(id)]).toEqual([id, true]);
    }
    expect(
      [...SUPPORTED_CIRCUIT_IDS, ...EXPERIMENTAL_CIRCUIT_IDS, ...PLANNED_CIRCUIT_IDS].sort(),
    ).toEqual([...ALL_CIRCUIT_IDS].sort());
  });

  it('CONTRACT: it is the dependency-free subpath that is imported, not the package root', () => {
    /*
     * The root export pulls socket.io-client and qrcode into the bundle for a
     * relay client this app is the other end of. Importing it would work and
     * cost a person's phone the download; the failure is silent, which is why
     * it is pinned rather than trusted.
     */
    const module = read('config', 'circuitIds.ts');
    expect(module).toContain("from '@zkproofport-app/core/circuits'");
    expect(module).not.toMatch(/from '@zkproofport-app\/core'/);

    const pkg = JSON.parse(
      fs.readFileSync(path.join(SRC, '..', 'package.json'), 'utf8'),
    );
    // Pinned exactly. The id list decides which proof a deep link produces, so
    // it moves when somebody bumps it and reads this file, not when a caret
    // resolves a new minor overnight.
    // An exact version, a pre-release one included -- never a range.
    expect(pkg.dependencies['@zkproofport-app/core']).toMatch(/^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/);
    // The customer SDK is not a dependency: everything the app takes from it
    // is in core, and the SDK would bring bb.js along.
    expect(pkg.dependencies['@zkproofport-app/sdk']).toBeUndefined();
  });

  it('CONTRACT: exactly one module imports the SDK', () => {
    // Twenty-four lists became one because there is one door. A second import
    // is a second door, and the drift starts again behind it. Comments naming
    // the package do not count — several explain where the ids come from.
    const importersOf = (pattern: RegExp) =>
      sourceFiles()
        .filter(f => pattern.test(codeOf(f)))
        .map(f => path.relative(SRC, f));
    // The circuit rules: one door.
    expect(importersOf(/'@zkproofport-app\/core\//)).toEqual([
      path.join('config', 'circuitIds.ts'),
    ]);
    // Core's root (on-chain verification): one module, the shared verifier
    // every proof hook calls.
    expect(importersOf(/'@zkproofport-app\/core'/)).toEqual([
      path.join('utils', 'proofVerification.ts'),
    ]);
    // The customer SDK: none.
    expect(importersOf(/@zkproofport-app\/sdk/)).toEqual([]);
  });
});

describe('every app table covers every published circuit', () => {
  /*
   * These are `Record<CircuitName, …>` and so are already exhaustive to `tsc`.
   * They are checked at runtime too because the compile error reads "property
   * missing from type" — true, and silent about the fact that a circuit would
   * ship with no download path, no verifier address and no name.
   */
  const covers = (name: string, table: Record<string, unknown>) =>
    it(`${name} has a row for each of the ${ALL_CIRCUIT_IDS.length}`, () => {
      expect(Object.keys(table).sort()).toEqual([...ALL_CIRCUIT_IDS].sort());
    });

  covers('BROADCAST_PATHS', BROADCAST_PATHS);
  covers('CIRCUIT_FILE_PATHS', CIRCUIT_FILE_PATHS);
  covers('CIRCUIT_DATA_VERSIONS', CIRCUIT_DATA_VERSIONS);
  // Keyed by environment first, because a circuit's chain differs between a
  // testnet build and a production one. Every environment must name every
  // circuit — there is no default to fall through to any more.
  covers('CIRCUIT_NETWORKS.development', CIRCUIT_NETWORKS.development);
  covers('CIRCUIT_NETWORKS.staging', CIRCUIT_NETWORKS.staging);
  covers('CIRCUIT_NETWORKS.production', CIRCUIT_NETWORKS.production);
  covers('FALLBACK_VERIFIERS.development', FALLBACK_VERIFIERS.development);
  covers('FALLBACK_VERIFIERS.staging', FALLBACK_VERIFIERS.staging);
  covers('FALLBACK_VERIFIERS.production', FALLBACK_VERIFIERS.production);

  it('every circuit has a display name that is not just its id echoed back', () => {
    /*
     * THE DEFECT. `CIRCUIT_DISPLAY_NAMES` had no rows for three circuits, and
     * the lookup ends in `|| circuitId`, so the history screens rendered a raw
     * route id as the name of the thing the person had proved. A missing
     * row does not throw; it prints the internal string at the user.
     */
    for (const id of ALL_CIRCUIT_IDS) {
      const name = getCircuitDisplayName(id);
      expect([id, typeof name]).toEqual([id, 'string']);
      expect([id, name]).not.toEqual([id, id]);
      expect([id, name.trim().length > 0]).toEqual([id, true]);
    }
  });

  it('every circuit has a real icon — not the fallback, and not nothing', () => {
    /*
     * The row is required to EXIST, not merely to differ from the fallback.
     * The first version of this case asserted only `!== 'shield'`, and a
     * deleted row returns `undefined` — which is not 'shield', so it passed
     * while `<Icon name={undefined}>` went to Feather. `Record<CircuitName,
     * string>` hides that from tsc by promising the row is there.
     */
    const glyphs = new Set(
      Object.keys(require('react-native-vector-icons/glyphmaps/Feather.json')),
    );
    for (const id of ALL_CIRCUIT_IDS) {
      const icon = getCircuitIcon(id);
      expect([id, typeof icon]).toEqual([id, 'string']);
      // A name Feather does not carry renders as a blank box, silently.
      expect([id, glyphs.has(icon)]).toEqual([id, true]);
      if (id === 'oidc_domain_attestation') continue; // legitimately a shield
      expect([id, icon]).not.toEqual([id, 'shield']);
    }
  });

  it('every circuit is reachable from the Verify tab — on a network or in "other"', () => {
    // A circuit in no network's list and not network-independent has a card
    // defined for it that is never rendered.
    const placed = new Set<string>([
      ...USER_FACING_NETWORKS.flatMap(n => n.circuits),
      ...NETWORK_INDEPENDENT_CIRCUITS,
    ]);
    expect([...placed].sort()).toEqual([...ALL_CIRCUIT_IDS].sort());
  });

  it('wallet routing and request presentation both cover every circuit', () => {
    /*
     * The wallet store pulls in React Native, so keep its source check. Request
     * presentation now lives in a pure typed utility: exercise that behavior
     * instead of demanding a duplicate circuit table inside the modal.
     */
    const wallet = read('stores', 'circuitWalletStore.ts');
    for (const id of ALL_CIRCUIT_IDS) {
      expect([id, wallet.includes(`${id}:`)]).toEqual([id, true]);
      const presentation = getProofRequestPresentation({
        circuit: id, inputs: {}, requestId: 'coverage', callbackUrl: 'https://requester.test', createdAt: 1,
      }, key => key);
      expect(presentation.title).toMatch(/^host\.proofRequest\.presentation\.[a-z][A-Za-z]*\.title$/);
      expect(presentation.shared).toMatch(/^host\.proofRequest\.presentation\.[a-z][A-Za-z]*\.shared$/);
      expect(presentation.private).toMatch(/^host\.proofRequest\.presentation\.[a-z][A-Za-z]*\.private$/);
      expect(presentation.conditions.length).toBeGreaterThan(0);
    }
  });
});

describe('one alias table, and route ids stop at it', () => {
  it('CONTRACT: every alias points at a canonical id, and no key is one', () => {
    /*
     * The keys are this app's own historical navigation spellings. If one of
     * them were also a canonical id the table would be translating a name into
     * itself, which is the sign that a canonical id has been mistaken for a
     * route id somewhere upstream.
     */
    for (const [route, canonical] of Object.entries(ROUTE_CIRCUIT_IDS)) {
      expect([route, isCircuitId(canonical)]).toEqual([route, true]);
      expect([route, isCircuitId(route)]).toEqual([route, false]);
      expect([route, route.includes('-')]).toEqual([route, true]);
    }
  });

  it('CONTRACT: resolves both spellings, and refuses everything else', () => {
    for (const id of ALL_CIRCUIT_IDS) expect(canonicalCircuitId(id)).toBe(id);
    expect(canonicalCircuitId('giwa-kyc')).toBe('giwa_attestation');
    expect(canonicalCircuitId('oidc-domain')).toBe('oidc_domain_attestation');
  });

  it('CONTRACT: the Korean mobile ID proofs are unknown, by either spelling', () => {
    // No circuit of this app: a request naming one resolves to nothing, so
    // every caller refuses it by name rather than proving something else.
    for (const gone of [
      'mdl_kr_ownership', 'mdl_kr_age', 'mdl_kr_region',
      'mdl-kr-ownership', 'mdl-kr-age', 'mdl-kr-region',
    ]) {
      expect([gone, canonicalCircuitId(gone)]).toEqual([gone, undefined]);
      expect([gone, isCircuitId(gone)]).toEqual([gone, false]);
      expect([gone, Object.prototype.hasOwnProperty.call(ROUTE_CIRCUIT_IDS, gone)]).toEqual([gone, false]);
    }
  });

  it('BOUNDARY / HOSTILE: nothing else resolves to a circuit', () => {
    /*
     * There is no default. An empty id used to become a Coinbase KYC proof,
     * and a near-miss spelling is the same failure with a typo in it. Case
     * folding is deliberately absent: the SDK says the ids are case-sensitive,
     * and accepting `GIWA_ATTESTATION` here would make the app disagree with the
     * relay about which nullifier scope a request belongs to.
     */
    for (const junk of [
      '', ' ', undefined, null,
      'coinbase', 'coinbase_attestation ', ' coinbase_attestation',
      'COINBASE_ATTESTATION', 'Coinbase_Attestation',
      'mdl_kr', 'mdl-kr-', 'mdl_kr_age_', 'mdl__kr__age',
      'coinbase_attestation%00', '__proto__', 'constructor', 'toString',
      'coinbase_attestation\n', '한국모바일신분증', '🪪',
      'a'.repeat(10000),
    ]) {
      expect([junk, canonicalCircuitId(junk as string)]).toEqual([junk, undefined]);
    }
  });

  it('INTEGRITY: the alias table is the only place a route id is written down', () => {
    /*
     * THE AXIS. Every defect above was a second copy of a spelling. A route id
     * appearing in any other module means a table has started keying off the
     * legacy name again, and the two will drift the same way they did before.
     */
    const routeIds = Object.keys(ROUTE_CIRCUIT_IDS);
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      if (path.relative(SRC, file) === path.join('config', 'circuitIds.ts')) continue;
      const code = codeOf(file);
      for (const routeId of routeIds) {
        if (code.includes(`'${routeId}'`) || code.includes(`"${routeId}"`)) {
          offenders.push(`${path.relative(SRC, file)} -> ${routeId}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('INTEGRITY: no module builds a circuit id by concatenation', () => {
    // A route id assembled from a variant was one of the twenty-four, and a
    // template string is invisible to every check that looks for a literal.
    // The prefixes are every id's first word, canonical and route alike.
    const prefixes = [...new Set([...ALL_CIRCUIT_IDS, ...Object.keys(ROUTE_CIRCUIT_IDS)].map(id => id.split(/[-_]/)[0]))];
    expect(prefixes.length).toBeGreaterThan(0);
    const built = new RegExp('`(' + prefixes.join('|') + ')[-_][A-Za-z_-]*\\$\\{');
    expect(built.test('`coinbase-${variant}`')).toBe(true);
    const offenders = sourceFiles()
      .filter(f => built.test(codeOf(f)))
      .map(f => path.relative(SRC, f));
    expect(offenders).toEqual([]);
  });
});

describe('the derived lists cannot be shorter than what they derive from', () => {
  it('THE REGRESSION: every circuit with a broadcast path is synced', () => {
    /*
     * `syncDeployments` held a literal list of three while six circuits had a
     * non-null broadcast path, so the other verifier addresses never
     * refreshed off the build-time fallback.
     */
    const expected = ALL_CIRCUIT_IDS.filter(c => BROADCAST_PATHS[c] !== null);
    expect(expected.length).toBeGreaterThan(0);
    expect([...CIRCUITS_WITH_BROADCAST].sort()).toEqual([...expected].sort());
    // And the deriving is what deployments.ts actually uses — a literal array
    // of circuit names reappearing there is the whole defect returning.
    const deployments = codeOf(path.join(SRC, 'config', 'deployments.ts'));
    expect(deployments).toContain('CIRCUITS_WITH_BROADCAST');
    expect(deployments).not.toMatch(/'coinbase_attestation'/);
  });

  it('launch downloads no circuit at all; each proof fetches its own', () => {
    /*
     * Until 2026-10-29 launch prefetched every circuit, derived from the SDK
     * lists so none was forgotten. On an Android phone that meant a 134 MB
     * .srs for a proof nobody had asked for. Now nothing is prefetched, so
     * there is no list here to keep complete.
     */
    const loading = codeOf(path.join(SRC, 'screens', 'LoadingScreen.tsx'));
    expect(loading).not.toMatch(/downloadCircuitFiles|SUPPORTED_CIRCUIT_IDS|MAIN_BRANCH_CIRCUIT_IDS/);
    expect(
      [...SUPPORTED_CIRCUIT_IDS, ...EXPERIMENTAL_CIRCUIT_IDS, ...PLANNED_CIRCUIT_IDS].sort(),
    ).toEqual([...ALL_CIRCUIT_IDS].sort());
  });

  it('THE REGRESSION: the circuits read from main are the planned ones, asked not listed', () => {
    // Was a four-way `||` chain of literal names, which is the shape that
    // forgets the fifth circuit.
    const download = codeOf(path.join(SRC, 'utils', 'circuitDownload.ts'));
    expect(download).toContain('MAIN_BRANCH_CIRCUIT_IDS.includes');
    expect(download).not.toMatch(/circuitName === '(giwa|dojang)_/);
  });

  it('THE REGRESSION: a deep link is validated against the published list', () => {
    // Was a seven-element array literal inside `validateProofRequest`.
    const deeplink = codeOf(path.join(SRC, 'utils', 'deeplink.ts'));
    expect(deeplink).toContain('isCircuitId(request.circuit)');
    expect(deeplink).not.toMatch(/'coinbase_country_attestation',/);
  });
});

describe('a circuit is called one thing', () => {
  it('THE DEFECT: the GIWA label exists exactly once in the app', () => {
    /*
     * It was "GIWA KYC (Experimental)" in `utils/circuit.ts` and on the
     * generation screen, and "GIWA KYC" on the completion screen — so the name
     * of the proof changed as the user moved from generating it to reading the
     * result. Any per-screen copy is the same fault waiting to be re-typed;
     * the label lives in one table and every screen asks that table.
     */
    const withLabel = sourceFiles()
      .filter(f => codeOf(f).includes('GIWA KYC'))
      .map(f => path.relative(SRC, f));
    expect(withLabel).toEqual([path.join('utils', 'circuit.ts')]);
  });

  it('no screen keeps a private display-name table', () => {
    for (const screen of [
      path.join('screens', 'proof', 'ProofGenerationScreen.tsx'),
      path.join('screens', 'proof', 'ProofCompleteScreen.tsx'),
    ]) {
      const code = codeOf(path.join(SRC, screen));
      expect([screen, /'Coinbase KYC'/.test(code)]).toEqual([screen, false]);
      expect([screen, /'GIWA KYC/.test(code)]).toEqual([screen, false]);
    }
  });

  it('ACCUMULATING: the same id asked ten times answers the same way', () => {
    // No memo, no latch, no lazily-built map that a first caller populates
    // differently from the second.
    for (const id of ['giwa-kyc', 'mdl_kr_age', 'giwa_attestation', 'nope']) {
      const names = Array.from({length: 10}, () => getCircuitDisplayName(id));
      const icons = Array.from({length: 10}, () => getCircuitIcon(id));
      expect(new Set(names).size).toBe(1);
      expect(new Set(icons).size).toBe(1);
    }
  });
});
