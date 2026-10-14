#!/usr/bin/env python3
"""
Write src/utils/__tests__/fixtures/dojangPlayground.json from the circuits
repository's own Prover.toml files and the GIWA Sepolia RPC.

What it records, so the app's unit tests can compare its input builder with
circuits/scripts/dojang-playground/generate-prover-toml.js without network
access or a sibling checkout:

  - the two recorded real issuances, exactly as eth_getTransactionByHash and
    eth_getTransactionReceipt return them
  - the values generate-prover-toml.js wrote for them (Prover.toml is the
    legacy one in EIP-712 action mode, Prover.no-action.toml the EIP-1559 one
    in signal mode)
  - the raw transactions of the refusal vectors in test-vectors/, which the
    circuit rejects and so must the app

Run from anywhere inside proofport-app-dev, after the circuits submodule is at
the commit whose vectors you want:

    python3 proofport-app/scripts/make-dojang-playground-fixtures.py

Requires network access to https://sepolia-rpc.giwa.io/.
"""
import json
import re
import subprocess
import sys
import urllib.request
from pathlib import Path


def project_home() -> Path:
    def git(*args):
        return subprocess.run(['git', *args], capture_output=True, text=True, check=True).stdout.strip()
    return Path(git('rev-parse', '--show-superproject-working-tree') or git('rev-parse', '--show-toplevel'))


REPO = project_home()
CIRCUIT = REPO / 'circuits' / 'dojang-playground'
OUT = REPO / 'proofport-app' / 'src' / 'utils' / '__tests__' / 'fixtures' / 'dojangPlayground.json'
RPC = 'https://sepolia-rpc.giwa.io/'
RECORDED = {
    'legacy': '0xc38c0b2418dfaa3127f70d8d33d72590e074965487905370dfd8394c187dea53',
    'eip1559': '0xabeac22b039000e4396f933ea73463823551bec6be30310a7fe40ae1b95f8eb6',
}
REFUSED = ['tx_wrong_contract', 'tx_wrong_selector', 'tx_extra_calldata', 'tx_wrong_chain',
           'tx_no_chain', 'tx_type_1', 'tx_other_signer']


def read_toml(path: Path) -> dict:
    """The flat subset generate-prover-toml.js writes: name = [0x.., ..] or name = int."""
    text = path.read_text()
    out = {}
    for m in re.finditer(r'^(\w+)\s*=\s*(\[[^\]]*\]|\d+)', text, re.M):
        name, value = m.group(1), m.group(2)
        if value.startswith('['):
            out[name] = '0x' + ''.join(b[2:] for b in re.findall(r'0x[0-9a-fA-F]{2}', value)).lower()
        else:
            out[name] = int(value)
    if not out:
        raise SystemExit(f'{path}: no values parsed')
    head = re.search(r'^# Issuance: (\S+)', text, re.M)
    out['_issuance'] = head.group(1) if head else None
    return out


def raw_of(toml: dict) -> str:
    """The unpadded signed transaction: raw_transaction cut to tx_length."""
    return toml['raw_transaction'][: 2 + 2 * toml['tx_length']]


def rpc(method: str, params: list):
    body = json.dumps({'jsonrpc': '2.0', 'id': 1, 'method': method, 'params': params}).encode()
    # The RPC sits behind a filter that answers 403 to urllib's default User-Agent.
    req = urllib.request.Request(RPC, body, {'Content-Type': 'application/json', 'User-Agent': 'proofport-fixtures'})
    with urllib.request.urlopen(req, timeout=30) as resp:
        reply = json.load(resp)
    if 'error' in reply:
        raise SystemExit(f'{method} {params}: {reply["error"]}')
    return reply['result']


def main():
    fixture = {'_source': 'scripts/make-dojang-playground-fixtures.py', 'recorded': {}, 'refused': {}}
    tomls = {'legacy': read_toml(CIRCUIT / 'Prover.toml'), 'eip1559': read_toml(CIRCUIT / 'Prover.no-action.toml')}
    for name, tx_hash in RECORDED.items():
        toml = tomls[name]
        if toml['_issuance'] != tx_hash:
            raise SystemExit(f'{name}: the TOML was built from {toml["_issuance"]}, expected {tx_hash}')
        tx = rpc('eth_getTransactionByHash', [tx_hash])
        receipt = rpc('eth_getTransactionReceipt', [tx_hash])
        fixture['recorded'][name] = {
            'rpcTransaction': tx,
            'receiptStatus': receipt['status'],
            'expected': {k: v for k, v in toml.items() if not k.startswith('_')} | {'raw': raw_of(toml)},
        }
    vectors = CIRCUIT / 'test-vectors'
    for name in REFUSED:
        fixture['refused'][name] = raw_of(read_toml(vectors / f'{name}.toml'))
    short = read_toml(vectors / 'short_scalar.toml')
    fixture['shortScalar'] = {'raw': raw_of(short), 'user_address': short['user_address']}

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(fixture, indent=2) + '\n')
    print(f'wrote {OUT.relative_to(REPO)}')


if __name__ == '__main__':
    sys.exit(main())
