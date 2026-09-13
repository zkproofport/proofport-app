/**
 * Nothing falls back to Coinbase, and nothing falls back to Base.
 *
 * Base was the first chain this app spoke to and Coinbase the first
 * attestation it read. Neither is a property of the project — it proves on
 * Arc, GIWA and a Korea mobile-ID network too — but both became the answer
 * wherever nobody had decided one:
 *
 *   - `getNetworkConfig()` returned "the chain this BUILD was made for", and
 *     every circuit that named no chain of its own inherited it. An
 *     `arc_eligibility` proof was verified on Base Sepolia and reported
 *     failed while being valid.
 *   - On-chain verification looked up `'coinbase_attestation'` whatever the
 *     circuit, so the Arc proof was checked against the Coinbase contract.
 *   - The proof history recorded the literal string 'Sepolia' for every proof.
 *   - The deep-link parser defaulted a missing circuit to Coinbase KYC.
 *
 * None of these announced themselves. Each produced a confident wrong answer,
 * and each was found by a person watching a screen.
 */
import * as fs from 'fs';
import * as path from 'path';

const SRC = path.resolve(__dirname, '..');

function sourceFiles(dir = SRC, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__') sourceFiles(full, out);
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/** Code with comments and strings-in-comments removed, so prose is not evidence. */
function codeOf(file: string): string {
  return fs
    .readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1');
}

const FILES = sourceFiles();

describe('nothing falls back to Coinbase or Base', () => {
  it('reads the app source', () => {
    expect(FILES.length).toBeGreaterThan(50);
  });

  it('has no build-wide network for a caller to inherit', () => {
    // Deleted on 2026-09-12. A chain belongs to a circuit; asking the build
    // gives an answer that is right only by coincidence.
    const users = FILES.filter(f => /\bgetNetworkConfig\(\)/.test(codeOf(f)));
    expect(users.map(f => path.relative(SRC, f))).toEqual([]);
  });

  it('never ends a fallback or a ternary at Coinbase', () => {
    const offenders: string[] = [];
    for (const f of FILES) {
      for (const line of codeOf(f).split('\n')) {
        if (/(\?\?|\|\||\?[^?:]{0,120}:)[^;{]{0,120}['"]coinbase_[a-z_]+['"]/.test(line)) {
          offenders.push(`${path.relative(SRC, f)}: ${line.trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('never names a chain as a bare string where a config lookup belongs', () => {
    const offenders: string[] = [];
    for (const f of FILES) {
      // The proof history recorded 'Sepolia' for every proof, on every chain.
      for (const line of codeOf(f).split('\n')) {
        if (/\b(network|chainName)\s*:\s*['"](Sepolia|Base|Base Sepolia)['"]/.test(line)) {
          offenders.push(`${path.relative(SRC, f)}: ${line.trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('asks for a circuit’s chain per circuit AND per environment', () => {
    const env = codeOf(path.join(SRC, 'config', 'environment.ts'));
    expect(env).toContain('CIRCUIT_NETWORKS[getEnvironment()][circuit]');
    // And refuses rather than substituting when a circuit has none.
    expect(env).toMatch(/throw new Error\([\s\S]{0,200}No network is configured/);
  });
});
