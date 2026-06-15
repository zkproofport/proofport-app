// Phase 0 on-device PoC: ts-mls + ciphersuite 0x0001 round-trip on Hermes.
// Mirrors the validated Node smoke test (/tmp/ts-mls-poc/poc.mjs). Measures
// per-step latency to gauge Hermes / low-end-device viability.
//
// REQUIRES a WebCrypto polyfill (global.crypto.subtle) installed BEFORE this
// runs — ts-mls HPKE routes through @hpke/core which needs crypto.subtle.
// ts-mls is lazy-`require`d INSIDE runMlsRoundTrip (not a top-level import) so
// (a) it loads only after ensureSubtleCrypto() has attached subtle, and (b) a
// load error is caught here instead of nuking the module namespace under Metro
// inlineRequires. See ./installCryptoPolyfill.

const SUITE = 'MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519'; // 0x0001 (RFC 9420 MTI)

export interface MlsPocStep {
  label: string;
  ms: number;
}

export interface MlsPocResult {
  ok: boolean;
  suite: string;
  steps: MlsPocStep[];
  totalMs: number;
  decrypted?: string;
  aliceEpoch?: number;
  bobEpoch?: number;
  error?: string;
}

function now(): number {
  // Hermes has Date.now; performance.now may be absent.
  return Date.now();
}

export async function runMlsRoundTrip(): Promise<MlsPocResult> {
  const steps: MlsPocStep[] = [];
  const t0 = now();
  const mark = (label: string, from: number) => steps.push({ label, ms: now() - from });

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const tsmls = require('ts-mls');
    const {
      createApplicationMessage, createCommit, createGroup, joinGroup,
      processPrivateMessage, getCiphersuiteImpl, getCiphersuiteFromName,
      defaultCapabilities, defaultLifetime, emptyPskIndex, generateKeyPackage,
      encodeMlsMessage, decodeMlsMessage, zeroOutUint8Array,
    } = tsmls;

    let s = now();
    const impl = await getCiphersuiteImpl(getCiphersuiteFromName(SUITE));
    mark('ciphersuite impl', s);

    s = now();
    const aliceCred = { credentialType: 'basic' as const, identity: new TextEncoder().encode('alice') };
    const alice = await generateKeyPackage(aliceCred, defaultCapabilities(), defaultLifetime, [], impl);
    const groupId = new TextEncoder().encode('openstoa-topic-poc');
    let aliceGroup = await createGroup(groupId, alice.publicPackage, alice.privatePackage, [], impl);
    mark('alice keygen + createGroup', s);

    s = now();
    const bobCred = { credentialType: 'basic' as const, identity: new TextEncoder().encode('bob') };
    const bob = await generateKeyPackage(bobCred, defaultCapabilities(), defaultLifetime, [], impl);
    mark('bob keygen', s);

    s = now();
    const kpMsg = encodeMlsMessage({ keyPackage: bob.publicPackage, wireformat: 'mls_key_package', version: 'mls10' });
    const decodedKp = decodeMlsMessage(kpMsg, 0)![0];
    if (decodedKp.wireformat !== 'mls_key_package') throw new Error('expected key package');
    const addBob = { proposalType: 'add' as const, add: { keyPackage: decodedKp.keyPackage } };
    const commit = await createCommit({ state: aliceGroup, cipherSuite: impl }, { extraProposals: [addBob] });
    aliceGroup = commit.newState;
    commit.consumed.forEach(zeroOutUint8Array);
    mark('add(bob) commit', s);

    s = now();
    const welMsg = encodeMlsMessage({ welcome: commit.welcome!, wireformat: 'mls_welcome', version: 'mls10' });
    const decodedWel = decodeMlsMessage(welMsg, 0)![0];
    if (decodedWel.wireformat !== 'mls_welcome') throw new Error('expected welcome');
    let bobGroup = await joinGroup(
      decodedWel.welcome, bob.publicPackage, bob.privatePackage, emptyPskIndex, impl, aliceGroup.ratchetTree,
    );
    mark('bob joinGroup (welcome)', s);

    s = now();
    const PLAINTEXT = 'Hello from OpenStoa E2EE PoC';
    const msgRes = await createApplicationMessage(aliceGroup, new TextEncoder().encode(PLAINTEXT), impl);
    aliceGroup = msgRes.newState;
    msgRes.consumed.forEach(zeroOutUint8Array);
    const pmMsg = encodeMlsMessage({ privateMessage: msgRes.privateMessage, wireformat: 'mls_private_message', version: 'mls10' });
    const decodedPm = decodeMlsMessage(pmMsg, 0)![0];
    if (decodedPm.wireformat !== 'mls_private_message') throw new Error('expected private message');
    const recv = await processPrivateMessage(bobGroup, decodedPm.privateMessage, emptyPskIndex, impl);
    if (recv.kind === 'newState') throw new Error('expected application message');
    const decrypted = new TextDecoder().decode(recv.message);
    recv.consumed.forEach(zeroOutUint8Array);
    mark('app message encrypt+decrypt', s);

    const ok = decrypted === PLAINTEXT;
    return {
      ok,
      suite: SUITE,
      steps,
      totalMs: now() - t0,
      decrypted,
      aliceEpoch: Number(aliceGroup.groupContext.epoch),
      bobEpoch: Number(bobGroup.groupContext.epoch),
      error: ok ? undefined : `decrypt mismatch: "${decrypted}"`,
    };
  } catch (e) {
    return {
      ok: false,
      suite: SUITE,
      steps,
      totalMs: now() - t0,
      error: e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e),
    };
  }
}
