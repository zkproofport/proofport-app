/**
 * There is ONE list of circuit ids, it is published, and this app reads it.
 *
 * A survey of this repository found TWENTY-FOUR separate lists of the same
 * seven strings — union types, `Record` literals, `includes([...])` arrays,
 * ladders of `===` comparisons, and a few that built the id by concatenation.
 * They did not agree, and the disagreements were not theoretical:
 *
 *   - the proof screen's heading matched only the HYPHENATED spellings, so a
 *     deep link carrying `mdl_kr_age` ran the age proof under the OWNERSHIP
 *     title;
 *   - `getCircuitDisplayName` had no `mdl_kr_*` rows at all and returned its
 *     argument, so the history list showed people the raw string `mdl-kr-age`;
 *   - `giwa_attestation` was "GIWA KYC (Experimental)" in two tables and
 *     "GIWA KYC" in a third;
 *   - `syncDeployments` carried a hand-written list of three, so the three
 *     Korea mDL verifier addresses never refreshed;
 *   - `'oidc-domain'` was set as a route id that no table anywhere understood.
 *
 * `@zkproofport-app/sdk/circuits` is now the source of the IDENTIFIERS. The
 * app keeps everything else — paths, addresses, versions, icons, labels,
 * networks, wallet groups — but every one of those tables is keyed by the
 * published id, and this file fails when one of them stops covering the list.
 *
 * The subpath is imported, not the package root: `/circuits` has no imports of
 * its own, while the root drags in `socket.io-client` and `qrcode` for a relay
 * client an app that proves on-device does not use.
 *
 * Measured against `@zkproofport-app/sdk@0.2.12` installed from the registry.
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  ALL_CIRCUIT_IDS,
  PLANNED_CIRCUIT_IDS,
  SUPPORTED_CIRCUIT_IDS,
  isCircuitId,
} from '@zkproofport-app/sdk/circuits';
import {
  ROUTE_CIRCUIT_IDS,
  canonicalCircuitId,
} from '../config/circuitIds';
import {
  BROADCAST_PATHS,
  CIRCUITS_WITH_BROADCAST,
  CIRCUIT_DATA_VERSIONS,
  CIRCUIT_FILE_PATHS,
  CIRCUIT_NETWORK_OVERRIDES,
  FALLBACK_VERIFIERS,
} from '../config/contracts';
import {NETWORK_INDEPENDENT_CIRCUITS, USER_FACING_NETWORKS} from '../config/networks';
import {getCircuitDisplayName, getCircuitIcon} from '../utils/circuit';

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
  it('CONTRACT: the SDK is the list — seven canonical ids, none of them hyphenated', () => {
    /*
     * Not an assertion about the SDK's content so much as a statement of what
     * every other case here is measured against. If this number changes, a
     * circuit was added or removed upstream and the cases below say which of
     * this app's tables have not caught up.
     */
    expect(ALL_CIRCUIT_IDS.length).toBe(7);
    for (const id of ALL_CIRCUIT_IDS) {
      expect([id, /^[a-z][a-z0-9_]*$/.test(id)]).toEqual([id, true]);
    }
    expect([...SUPPORTED_CIRCUIT_IDS, ...PLANNED_CIRCUIT_IDS].sort()).toEqual(
      [...ALL_CIRCUIT_IDS].sort(),
    );
  });

  it('CONTRACT: it is the dependency-free subpath that is imported, not the package root', () => {
    /*
     * The root export pulls socket.io-client and qrcode into the bundle for a
     * relay client this app is the other end of. Importing it would work and
     * cost a person's phone the download; the failure is silent, which is why
     * it is pinned rather than trusted.
     */
    const module = read('config', 'circuitIds.ts');
    expect(module).toContain("from '@zkproofport-app/sdk/circuits'");
    expect(module).not.toMatch(/from '@zkproofport-app\/sdk'/);

    const pkg = JSON.parse(
      fs.readFileSync(path.join(SRC, '..', 'package.json'), 'utf8'),
    );
    // Pinned exactly. The id list decides which proof a deep link produces, so
    // it moves when somebody bumps it and reads this file, not when a caret
    // resolves a new minor overnight.
    expect(pkg.dependencies['@zkproofport-app/sdk']).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('CONTRACT: exactly one module imports the SDK', () => {
    // Twenty-four lists became one because there is one door. A second import
    // is a second door, and the drift starts again behind it. Comments naming
    // the package do not count — several explain where the ids come from.
    const importers = sourceFiles()
      .filter(f => codeOf(f).includes('@zkproofport-app/sdk'))
      .map(f => path.relative(SRC, f));
    expect(importers).toEqual([path.join('config', 'circuitIds.ts')]);
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
  covers('CIRCUIT_NETWORK_OVERRIDES', CIRCUIT_NETWORK_OVERRIDES);
  covers('FALLBACK_VERIFIERS.development', FALLBACK_VERIFIERS.development);
  covers('FALLBACK_VERIFIERS.staging', FALLBACK_VERIFIERS.staging);
  covers('FALLBACK_VERIFIERS.production', FALLBACK_VERIFIERS.production);

  it('every circuit has a display name that is not just its id echoed back', () => {
    /*
     * THE DEFECT. `CIRCUIT_DISPLAY_NAMES` had no `mdl_kr_*` rows, and the
     * lookup ends in `|| circuitId`, so the history screens rendered
     * `mdl-kr-age` as the name of the thing the person had proved. A missing
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

  it('the tables that are not typed by CircuitName still name every circuit', () => {
    /*
     * `circuitWalletStore` and `ProofRequestModal` are read as text rather than
     * imported: both pull React Native in, and this suite runs on plain node.
     * They are `Record<CircuitName, …>` in the source, so tsc holds them; this
     * only catches the case where somebody loosens the type to `string`.
     */
    const wallet = read('stores', 'circuitWalletStore.ts');
    const modal = read('components', 'ProofRequestModal.tsx');
    for (const id of ALL_CIRCUIT_IDS) {
      expect([id, wallet.includes(`${id}:`)]).toEqual([id, true]);
      expect([id, modal.includes(`${id}:`)]).toEqual([id, true]);
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
    expect(canonicalCircuitId('mdl-kr-age')).toBe('mdl_kr_age');
    expect(canonicalCircuitId('oidc-domain')).toBe('oidc_domain_attestation');
  });

  it('BOUNDARY / HOSTILE: nothing else resolves to a circuit', () => {
    /*
     * There is no default. An empty id used to become a Coinbase KYC proof,
     * and a near-miss spelling is the same failure with a typo in it. Case
     * folding is deliberately absent: the SDK says the ids are case-sensitive,
     * and accepting `MDL_KR_AGE` here would make the app disagree with the
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
    // `mdl-kr-${variant}` was one of the twenty-four, and a template string is
    // invisible to every check that looks for a literal.
    const offenders = sourceFiles()
      .filter(f => /`(mdl[-_]kr|coinbase)[-_]\$\{/.test(codeOf(f)))
      .map(f => path.relative(SRC, f));
    expect(offenders).toEqual([]);
  });
});

describe('the derived lists cannot be shorter than what they derive from', () => {
  it('THE REGRESSION: every circuit with a broadcast path is synced', () => {
    /*
     * `syncDeployments` held a literal list of three while six circuits had a
     * non-null broadcast path, so the three `mdl_kr_*` verifier addresses
     * never refreshed off the build-time fallback. Checked 2026-09-04: all
     * three `DeployMdlKr*.s.sol/84532/run-latest.json` answer 200 on
     * circuits@main.
     */
    const expected = ALL_CIRCUIT_IDS.filter(c => BROADCAST_PATHS[c] !== null);
    expect([...CIRCUITS_WITH_BROADCAST].sort()).toEqual([...expected].sort());
    for (const mdl of ['mdl_kr_ownership', 'mdl_kr_age', 'mdl_kr_region']) {
      expect([mdl, CIRCUITS_WITH_BROADCAST.includes(mdl as never)]).toEqual([mdl, true]);
    }
    // And the deriving is what deployments.ts actually uses — a literal array
    // of circuit names reappearing there is the whole defect returning.
    const deployments = codeOf(path.join(SRC, 'config', 'deployments.ts'));
    expect(deployments).toContain('CIRCUITS_WITH_BROADCAST');
    expect(deployments).not.toMatch(/'coinbase_attestation'/);
  });

  it('THE REGRESSION: startup prefetches every circuit, in the right tier', () => {
    /*
     * The startup lists named three circuits plus GIWA and omitted the three
     * Korea mDL ones, so a first mDL proof paid for a cold download. Derived
     * from the SDK's own supported/planned split now: the union is the whole
     * list by construction, and the split matches the one `circuitDownload.ts`
     * uses to decide which circuits are read from `main`.
     */
    const loading = codeOf(path.join(SRC, 'screens', 'LoadingScreen.tsx'));
    expect(loading).toMatch(/BASE_CIRCUITS[^=]*=\s*SUPPORTED_CIRCUIT_IDS/);
    expect(loading).toMatch(/DEV_ONLY_CIRCUITS[^=]*=\s*PLANNED_CIRCUIT_IDS/);
    expect(loading).not.toMatch(/'(coinbase|giwa|oidc|mdl)_/);
    expect([...SUPPORTED_CIRCUIT_IDS, ...PLANNED_CIRCUIT_IDS].sort()).toEqual(
      [...ALL_CIRCUIT_IDS].sort(),
    );
  });

  it('THE REGRESSION: the circuits read from main are the planned ones, asked not listed', () => {
    // Was a four-way `||` chain of literal names, which is the shape that
    // forgets the fifth circuit.
    const download = codeOf(path.join(SRC, 'utils', 'circuitDownload.ts'));
    expect(download).toContain('PLANNED_CIRCUIT_IDS.includes');
    expect(download).not.toMatch(/circuitName === '(giwa|mdl)_/);
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
      expect([screen, /Korea Mobile ID/.test(code)]).toEqual([screen, false]);
    }
  });

  it('ACCUMULATING: the same id asked ten times answers the same way', () => {
    // No memo, no latch, no lazily-built map that a first caller populates
    // differently from the second.
    for (const id of ['mdl_kr_age', 'mdl-kr-age', 'giwa_attestation', 'nope']) {
      const names = Array.from({length: 10}, () => getCircuitDisplayName(id));
      const icons = Array.from({length: 10}, () => getCircuitIcon(id));
      expect(new Set(names).size).toBe(1);
      expect(new Set(icons).size).toBe(1);
    }
  });
});
