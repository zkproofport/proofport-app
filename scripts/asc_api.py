"""Sign a request to App Store Connect and send it.

The ONE place this repo talks to App Store Connect. Every script here imports
it: `asc-read.py`, `asc-write.py`, `asc-set-build-note.py`, `testflight.py`,
`store-screenshots.py`.

It was pulled out on 2026-09-07 and finished on 2026-09-08. Before that there
were THREE copies of the ES256 signing, and two scripts reached the helpers by
exec'ing a slice of another file's source:

    exec(compile(src.split("apps = get(")[0], 'asc-read.py', 'exec'), ns)

That worked only while the borrowed file's first API call stayed on the line it
was split at. Adding an import to `asc-read.py` would have silently broken both
callers, which is why nobody touched it.

Needs ASC_KEY_ID, ASC_ISSUER_ID, and the key itself as EITHER:

    ASC_API_KEY       the .p8 base64-encoded — preferred, and the only one CI
                      has ever used
    ASC_API_KEY_PATH  a path to the .p8 on disk

Prefer the base64. A .p8 is downloadable exactly ONCE from App Store Connect,
so every copy on disk is a copy that cannot be replaced quietly if it leaks —
and a path means a second file to carry to the next machine, or to another
project, which is how the old one ended up pointing at a home directory that no
longer existed. With the base64 in the environment there is nothing to carry.

The key is written to a temporary file for the length of one signature and
deleted, because `openssl` signs from a file. This is the same shape
`play-api.py` uses for the Play service account, for the same reason.

Signing shells out to `openssl`: the standard library cannot do ES256, and a
script that needs `pip install` before it runs is a script nobody runs.
"""
import base64
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

API = 'https://api.appstoreconnect.apple.com'


def _need(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        sys.exit(f'{name} is not set — run `source .env.ios` first')
    return value


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip('=')


def _der_to_raw(der: bytes) -> bytes:
    """ASN.1 SEQUENCE { INTEGER r, INTEGER s } → the r||s pair ASC expects.

    `openssl dgst -sign` emits DER. Feeding that to the API is rejected as a
    malformed token, with a message that says nothing about the encoding.
    """
    assert der[0] == 0x30, 'not a DER sequence'
    i = 2 if der[1] < 0x80 else 2 + (der[1] & 0x7F)

    def take(pos: int):
        assert der[pos] == 0x02, 'expected an INTEGER'
        length = der[pos + 1]
        value = der[pos + 2:pos + 2 + length]
        return value.lstrip(b'\x00').rjust(32, b'\x00'), pos + 2 + length

    r, i = take(i)
    s, _ = take(i)
    return r + s


def _sign(signing_input: bytes) -> bytes:
    """ES256 over the token, from whichever form of the key is present.

    ASC_API_KEY (base64) wins. It is written to a file with owner-only
    permissions for the length of one call and removed in `finally`, so an
    interrupt does not leave a private key behind in the temp directory.
    """
    encoded = os.environ.get('ASC_API_KEY')
    if encoded:
        handle = None
        try:
            with tempfile.NamedTemporaryFile(suffix='.p8', delete=False) as f:
                handle = f.name
                os.chmod(handle, 0o600)
                f.write(base64.b64decode(encoded))
            return subprocess.run(
                ['openssl', 'dgst', '-sha256', '-sign', handle],
                input=signing_input, capture_output=True, check=True,
            ).stdout
        finally:
            if handle and os.path.exists(handle):
                os.unlink(handle)

    key_path = os.environ.get('ASC_API_KEY_PATH')
    if not key_path:
        sys.exit('Neither ASC_API_KEY nor ASC_API_KEY_PATH is set — '
                 'run `source .env.ios` first')
    if not os.path.exists(key_path):
        # The failure this replaces: openssl answers a signing error that never
        # names the file, so a path left over from another machine reads as a
        # broken key rather than a missing one.
        sys.exit(f'ASC_API_KEY_PATH points at nothing: {key_path}')
    return subprocess.run(
        ['openssl', 'dgst', '-sha256', '-sign', key_path],
        input=signing_input, capture_output=True, check=True,
    ).stdout


def token() -> str:
    key_id, issuer = _need('ASC_KEY_ID'), _need('ASC_ISSUER_ID')
    header = _b64(json.dumps({'alg': 'ES256', 'kid': key_id, 'typ': 'JWT'}).encode())
    payload = _b64(json.dumps({
        'iss': issuer,
        'exp': int(time.time()) + 900,
        'aud': 'appstoreconnect-v1',
    }).encode())
    signing_input = f'{header}.{payload}'.encode()
    return f'{header}.{payload}.{_b64(_der_to_raw(_sign(signing_input)))}'


_TOKEN = None


def request(method: str, path: str, body=None):
    """One call. Answers the parsed body, or {} when the API sends none.

    A failure EXITS with the API's own `detail` text rather than raising, so a
    refusal reads as the reason Apple gave and not as a stack trace.
    """
    global _TOKEN
    if _TOKEN is None:
        _TOKEN = token()
    req = urllib.request.Request(
        API + path,
        data=json.dumps(body).encode() if body is not None else None,
        headers={'Authorization': f'Bearer {_TOKEN}', 'Content-Type': 'application/json'},
        method=method,
    )
    try:
        with urllib.request.urlopen(req) as res:
            raw = res.read()
    except urllib.error.HTTPError as err:
        detail = err.read().decode()
        try:
            errors = json.loads(detail)['errors']
            detail = '\n'.join(f"{e.get('title')}: {e.get('detail')}" for e in errors)
        except Exception:
            pass
        sys.exit(f'{method} {path} → {err.code}\n{detail}')
    return json.loads(raw) if raw.strip() else {}


def get(path: str):
    return request('GET', path)
