/**
 * A proof is checked against ITS verifier on ITS chain.
 *
 * Every proof hook took only a logger, looked up a circuit name typed into the
 * call, and read `getNetworkConfig()` — the BUILD's default network. That is
 * right only while every circuit lives on the build's chain.
 *
 * `arc_eligibility` does not: its verifier is deployed on Arc Testnet and
 * nowhere else. So a valid Arc proof was sent to the Coinbase verifier on Base
 * Sepolia and came back "failed" — off-chain green and on-chain red on the
 * same proof, in a simulator on 2026-09-12. Nothing said the call had gone to
 * another chain.
 *
 * The GIWA hook had already been fixed the same way, alone, some time earlier.
 * That is the shape of this defect: it is fixed one circuit at a time, by
 * whoever hits it.
 */
import * as fs from 'fs';
import * as path from 'path';

const HOOKS = path.resolve(__dirname, '..');

/** Every hook that verifies a proof on chain. */
const PROOF_HOOKS = fs
  .readdirSync(HOOKS)
  .filter(f => f.endsWith('.ts'))
  .filter(f => fs.readFileSync(path.join(HOOKS, f), 'utf8').includes('verifyProofOnChain'));

describe('a proof is checked against its own chain', () => {
  it('finds the proof hooks', () => {
    // Five at the time of writing. A lower number means the sweep stopped
    // seeing files and the rest of this suite proves nothing.
    expect(PROOF_HOOKS.length).toBeGreaterThanOrEqual(5);
  });

  it.each(PROOF_HOOKS)('%s asks for the circuit’s network, not the build’s', file => {
    const src = fs.readFileSync(path.join(HOOKS, file), 'utf8');
    // `getNetworkConfig()` is the build default. `getNetworkConfigForCircuit`
    // is the question that has a right answer for every circuit.
    expect(src).not.toMatch(/getNetworkConfig\(\)/);
  });

  it.each(PROOF_HOOKS)('%s takes the circuit rather than naming one inline', file => {
    const src = fs.readFileSync(path.join(HOOKS, file), 'utf8');
    expect(src).toMatch(/verifyProofOnChain[\s\S]{0,300}circuit: CircuitName/);
    // A literal circuit id in the verifier lookup is how the Coinbase contract
    // came to be asked about an Arc proof.
    expect(src).not.toMatch(/getVerifierAddress\('[a-z_]+'\)/);
  });

  it.each(PROOF_HOOKS)('%s refuses a circuit it does not prove', file => {
    const src = fs.readFileSync(path.join(HOOKS, file), 'utf8');
    expect(src).toMatch(/it was asked to verify|it was asked for/);
  });

  it('makes the screen pass the circuit, and refuse when it has none', () => {
    const screen = fs.readFileSync(
      path.join(HOOKS, '..', 'screens', 'proof', 'ProofCompleteScreen.tsx'),
      'utf8',
    );
    expect(screen).toContain('verifyProofOnChain(circuitId, addLog)');
    expect(screen).toContain('if (!isCircuitId(circuitId))');
    // And it no longer names Coinbase's verifier for a proof of unknown origin.
    expect(screen).not.toContain("getVerifierAddressSync('coinbase_attestation')");
  });
});
