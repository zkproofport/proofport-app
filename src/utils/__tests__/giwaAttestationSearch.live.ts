/**
 * The GIWA lookup against the REAL chain. Opt-in: `npm run test:giwa-live`.
 *
 * Jest's testMatch is `**\/__tests__\/**\/*.test.ts`, so this file is invisible
 * to a normal run and to CI. That is deliberate — it needs GIWA Sepolia to be
 * up, and a suite that goes red when a testnet explorer is having a bad morning
 * teaches people to ignore red.
 *
 * WHY IT EXISTS ANYWAY. The stubbed cases next door prove the lookup asks the
 * right questions; they cannot prove the explorer still answers them. Both
 * things this replaced were broken by the outside world moving, not by the code
 * changing: a 3M-block search window that GIWA quietly outgrew, and an RPC that
 * answers a too-wide range with an empty list instead of an error. Neither is
 * visible from a mock.
 *
 * Run it after touching the lookup, and when someone asks "is it actually fast
 * now" — the numbers it prints are the answer, not a remembered measurement.
 */
import {findAttestationLog, GIWA_MOCK_ATTESTER_CONTRACT} from '../giwaAttestationSearch';

const SCHEMA_UID =
  '0xbda8dd64efa4c537514cfe4c96ab5d5f14a8ec0c9105b799b47a010e89c0c72d';

/** Registered on GIWA Sepolia at block 25,424,198 — about 9.7M behind the head. */
const OLD_ATTESTATION = '0x5A3E649208ae15EC52496c1AE23b2Ff89aC02f0c';
/** Registered at block 35,145,008, near the head. */
const RECENT_ATTESTATION = '0xdC5197a8a0ba55f506CFC3DDd491e864f2340590';
/** Never attested. */
const NO_ATTESTATION = '0x000000000000000000000000000000000000dEaD';

jest.setTimeout(120_000);

async function timed(label: string, wallet: string) {
  const lines: string[] = [];
  const started = Date.now();
  const log = await findAttestationLog(SCHEMA_UID, wallet, m => lines.push(m));
  const ms = Date.now() - started;
  console.log(
    `\n  ${label}\n` +
      `    wallet   ${wallet}\n` +
      `    result   ${log ? `block ${log.block_number}, tx ${log.transaction_hash}` : 'no attestation'}\n` +
      `    took     ${(ms / 1000).toFixed(2)}s\n` +
      lines.map(l => `    · ${l}`).join('\n'),
  );
  return {log, ms, lines};
}

describe('GIWA lookup against the live chain', () => {
  it('finds an attestation 9.7M blocks back, in about a second', async () => {
    const {log, ms, lines} = await timed('old attestation', OLD_ATTESTATION);

    expect(log).not.toBeNull();
    expect(log!.block_number).toBe(25424198);
    // The number that matters. The EAS log search this replaced took 26s for
    // this exact wallet, and the RPC walk took 126s and then answered wrong.
    expect(ms).toBeLessThan(5000);
    // Fast AND for the right reason: the wide search must not have run.
    expect(lines.join('\n')).toMatch(/attester match/);
    expect(lines.join('\n')).not.toMatch(/explorer log search/);
  });

  it('finds a recent attestation too', async () => {
    const {log, ms} = await timed('recent attestation', RECENT_ATTESTATION);
    expect(log).not.toBeNull();
    expect(log!.block_number).toBe(35145008);
    expect(ms).toBeLessThan(5000);
  });

  it('answers no quickly for a wallet that was never attested', async () => {
    // The common case, and the one that used to be slowest: before this change
    // a miss paid the full search before returning nothing.
    const {log, ms, lines} = await timed('never attested', NO_ATTESTATION);
    expect(log).toBeNull();
    expect(ms).toBeLessThan(5000);
    expect(lines.join('\n')).toMatch(/never registered this wallet/);
  });

  it('the attester contract is still there and still the one the app names', async () => {
    // A redeploy that changed this address would make every lookup above answer
    // "no attestation" — correctly, for the wrong contract — and nothing else
    // in the suite would notice.
    const resp = await fetch('https://sepolia-rpc.giwa.io', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_getCode',
        params: [GIWA_MOCK_ATTESTER_CONTRACT, 'latest'],
      }),
    });
    const {result} = await resp.json();
    expect(result).toBeTruthy();
    expect(result).not.toBe('0x');
  });
});
