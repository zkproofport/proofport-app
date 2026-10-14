#!/usr/bin/env node
/**
 * A headless WalletConnect wallet for testing the app in the iOS simulator.
 *
 * WHY. The app connects wallets through Reown AppKit over WalletConnect and
 * nothing else, and the simulator has no wallet app to open. Without this, any
 * proof that needs a wallet signature (Coinbase, GIWA, Dojang Playground)
 * stops at the connect sheet in the simulator.
 *
 * WHAT IT DOES. Pairs with the app through a `wc:` URI, approves the session
 * for every chain the app proposes, and answers the app's requests by signing
 * with a key it reads at runtime:
 *
 *   personal_sign, eth_sign, eth_signTypedData_v4, eth_chainId,
 *   eth_accounts / eth_requestAccounts, wallet_switchEthereumChain,
 *   wallet_addEthereumChain
 *
 * It never sends a transaction (eth_sendTransaction is refused).
 *
 * THE KEY. Never passed on the command line and never written anywhere: it is
 * read from `DEV_WALLET_PRIVATE_KEY`, or else from PRIVATE_KEY in
 * `circuits/.env.development` (the circuits fixture wallet, whose GIWA
 * Playground issuances the dojang_playground fixtures were made from).
 *
 * THE URI. AppKit's sheet (Connect Wallet -> All wallets -> the QR icon) shows
 * the pairing link only as a QR code, with no copy button. `--from-simulator`
 * screenshots the booted simulator every two seconds and decodes the QR with
 * scripts/decode-qr.swift (CoreImage, nothing to install). A `wc:` URI put on
 * the simulator pasteboard (`xcrun simctl pbcopy`) is accepted too.
 *
 * Drive the simulator's taps with `idb ui tap`, which sends touches to the
 * device. Never with a tool that moves the host mouse or focuses the window:
 * someone is usually working on this Mac (a hook refuses those tools).
 *
 * Usage, from the project home:
 *   env -u NODE_OPTIONS node proofport-app/scripts/dev-wallet.js --from-simulator
 *   env -u NODE_OPTIONS node proofport-app/scripts/dev-wallet.js --uri 'wc:...'
 *
 * Runs until killed. Every request and answer is logged in full. The
 * WalletConnect library prints its own trace lines; `grep '^\[wallet\]'`.
 *
 * Proven 2026-10-14: paired with a Debug simulator build, answered the
 * dojang_playground EIP-712 request, and the proof verified on GIWA Sepolia.
 */
const {execFileSync, execSync} = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {SignClient} = require('@walletconnect/sign-client');
const {ethers} = require('ethers');

// The app's own WalletConnect project id is public (it ships in the bundle).
const {WALLETCONNECT_PROJECT_ID} = loadProjectId();

function projectHome() {
  const sh = cmd => execSync(cmd, {encoding: 'utf8', cwd: __dirname}).trim();
  return sh('git rev-parse --show-superproject-working-tree') || sh('git rev-parse --show-toplevel');
}

function loadProjectId() {
  const file = path.join(projectHome(), 'proofport-app', 'src', 'config', 'WalletConnectConfig.ts');
  const m = fs.readFileSync(file, 'utf8').match(/WALLETCONNECT_PROJECT_ID\s*=\s*'([0-9a-f]+)'/);
  if (!m) throw new Error(`No WALLETCONNECT_PROJECT_ID in ${file}`);
  return {WALLETCONNECT_PROJECT_ID: m[1]};
}

function loadKey() {
  if (process.env.DEV_WALLET_PRIVATE_KEY) return process.env.DEV_WALLET_PRIVATE_KEY;
  const file = path.join(projectHome(), 'circuits', '.env.development');
  if (!fs.existsSync(file)) {
    throw new Error(`Set DEV_WALLET_PRIVATE_KEY, or provide PRIVATE_KEY in ${file}`);
  }
  const line = fs.readFileSync(file, 'utf8').split('\n').find(l => /^PRIVATE_KEY\s*=/.test(l));
  if (!line) throw new Error(`PRIVATE_KEY missing from ${file}`);
  return line.slice(line.indexOf('=') + 1).trim();
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? null : process.argv[i + 1];
}

async function readUri() {
  const given = arg('--uri');
  if (given) return given;
  if (!process.argv.includes('--from-simulator')) {
    throw new Error('Pass --uri <wc:...> or --from-simulator.');
  }
  const before = pbpaste();
  console.log('[wallet] waiting for the AppKit QR on the simulator screen, or a wc: URI on its pasteboard');
  for (;;) {
    const now = pbpaste();
    if (now.startsWith('wc:') && now !== before) return now;
    const shown = qrOnScreen();
    if (shown) return shown;
    await new Promise(r => setTimeout(r, 2000));
  }
}

/** The `wc:` link in the QR on the simulator's screen right now, or null. */
function qrOnScreen() {
  const shot = path.join(os.tmpdir(), `dev-wallet-${process.pid}.png`);
  try {
    execFileSync('xcrun', ['simctl', 'io', 'booted', 'screenshot', shot], {stdio: 'ignore'});
    const out = execFileSync('swift', [path.join(__dirname, 'decode-qr.swift'), shot], {encoding: 'utf8'});
    return out.split('\n').find(line => line.startsWith('wc:')) || null;
  } catch {
    return null;
  } finally {
    fs.rmSync(shot, {force: true});
  }
}

function pbpaste() {
  try {
    return execFileSync('xcrun', ['simctl', 'pbpaste', 'booted'], {encoding: 'utf8'}).trim();
  } catch {
    return '';
  }
}

function hexToUtf8OrBytes(hex) {
  return ethers.utils.isHexString(hex) ? ethers.utils.arrayify(hex) : hex;
}

async function main() {
  const wallet = new ethers.Wallet(loadKey());
  console.log(`[wallet] address ${wallet.address}`);
  let activeChain = null;

  // A throwaway store per run: a stale pairing from an earlier run must not answer.
  const store = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-wallet-'));
  const client = await SignClient.init({
    projectId: WALLETCONNECT_PROJECT_ID,
    storageOptions: {database: path.join(store, 'wc.db')},
    metadata: {
      name: 'ZKProofport dev wallet',
      description: 'Headless test wallet (scripts/dev-wallet.js)',
      url: 'https://zkproofport.com',
      icons: [],
    },
  });

  client.on('session_proposal', async ({id, params}) => {
    console.log('[wallet] session proposal', JSON.stringify(params));
    const wanted = [params.requiredNamespaces, params.optionalNamespaces].filter(Boolean);
    const chains = new Set();
    const methods = new Set(['personal_sign', 'eth_signTypedData_v4', 'eth_chainId', 'wallet_switchEthereumChain', 'wallet_addEthereumChain']);
    const events = new Set(['chainChanged', 'accountsChanged']);
    for (const ns of wanted) {
      const eip = ns.eip155;
      if (!eip) continue;
      (eip.chains || []).forEach(c => chains.add(c));
      (eip.methods || []).forEach(m => methods.add(m));
      (eip.events || []).forEach(e => events.add(e));
    }
    if (chains.size === 0) chains.add('eip155:1');
    activeChain = [...chains][0];
    const namespaces = {
      eip155: {
        chains: [...chains],
        methods: [...methods],
        events: [...events],
        accounts: [...chains].map(c => `${c}:${wallet.address}`),
      },
    };
    const {acknowledged} = await client.approve({id, namespaces});
    await acknowledged();
    console.log(`[wallet] session approved for ${[...chains].join(', ')}`);
  });

  client.on('session_request', async ({topic, id, params}) => {
    const {request, chainId} = params;
    console.log(`[wallet] request ${request.method} on ${chainId}: ${JSON.stringify(request.params)}`);
    let result;
    try {
      switch (request.method) {
        case 'personal_sign': {
          const [message] = request.params;
          result = await wallet.signMessage(hexToUtf8OrBytes(message));
          break;
        }
        case 'eth_sign': {
          const [, message] = request.params;
          result = await wallet.signMessage(hexToUtf8OrBytes(message));
          break;
        }
        case 'eth_signTypedData_v4': {
          const [, payload] = request.params;
          const data = typeof payload === 'string' ? JSON.parse(payload) : payload;
          const types = {...data.types};
          delete types.EIP712Domain;
          result = await wallet._signTypedData(data.domain, types, data.message);
          break;
        }
        case 'eth_chainId':
          result = `0x${Number((activeChain || chainId).split(':')[1]).toString(16)}`;
          break;
        case 'eth_accounts':
        case 'eth_requestAccounts':
          result = [wallet.address];
          break;
        case 'wallet_switchEthereumChain':
        case 'wallet_addEthereumChain': {
          const target = `eip155:${Number(request.params[0].chainId)}`;
          activeChain = target;
          result = null;
          await client.emit({topic, chainId: target, event: {name: 'chainChanged', data: Number(request.params[0].chainId)}});
          break;
        }
        default:
          throw Object.assign(new Error(`dev wallet does not answer ${request.method}`), {code: 4200});
      }
      console.log(`[wallet] answered ${request.method}: ${JSON.stringify(result)}`);
      await client.respond({topic, response: {id, jsonrpc: '2.0', result}});
    } catch (e) {
      console.log(`[wallet] refused ${request.method}: ${e.message}`);
      await client.respond({topic, response: {id, jsonrpc: '2.0', error: {code: e.code || 5000, message: e.message}}});
    }
  });

  client.on('session_delete', () => console.log('[wallet] session deleted by the app'));

  const uri = await readUri();
  console.log(`[wallet] pairing ${uri}`);
  await client.core.pairing.pair({uri});
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
