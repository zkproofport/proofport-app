#!/usr/bin/env python3
"""Read what App Store Connect actually holds for this app.

Written 2026-08-29 after an assistant reported the store's state by listing a
folder on disk — "the first screenshot is a launch screen, Korean is zero" —
when the screenshots had long been uploaded and the folder it read was a stale
copy nobody ships. A directory listing is not the store. This is.

    source .env.ios && python3 scripts/asc-read.py           # summary
    source .env.ios && python3 scripts/asc-read.py --json    # machine readable

Needs ASC_KEY_ID, ASC_ISSUER_ID, ASC_API_KEY_PATH — the same three fastlane
uses.

No third-party packages. The request token has to be signed ES256, which the
Python standard library cannot do, so the signing shells out to `openssl` — it
ships with macOS and is already a hard dependency of the iOS toolchain here.
The alternative, PyJWT, is not installed on this machine, and a script that
needs an install step before it runs is a script nobody runs.
"""
import base64
import json
import os
import subprocess
import sys
import time
import urllib.request

BUNDLE_ID = 'com.masselabs.zkproofport'
API = 'https://api.appstoreconnect.apple.com'


def need(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        sys.exit(f'{name} is not set — run `source .env.ios` first')
    return value


def b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip('=')


def der_to_raw(der: bytes) -> bytes:
    """ASN.1 SEQUENCE { INTEGER r, INTEGER s } → the r||s pair ASC expects.

    `openssl dgst -sign` emits DER. Feeding that to the API is rejected as a
    malformed token, with a message that says nothing about the encoding.
    """
    assert der[0] == 0x30, 'not a DER sequence'
    i = 2 if der[1] < 0x80 else 2 + (der[1] & 0x7F)

    def take(pos: int) -> tuple[bytes, int]:
        assert der[pos] == 0x02, 'expected an INTEGER'
        length = der[pos + 1]
        value = der[pos + 2:pos + 2 + length]
        return value.lstrip(b'\x00').rjust(32, b'\x00'), pos + 2 + length

    r, i = take(i)
    s, _ = take(i)
    return r + s


def token() -> str:
    key_id, issuer, key_path = need('ASC_KEY_ID'), need('ASC_ISSUER_ID'), need('ASC_API_KEY_PATH')
    header = b64(json.dumps({'alg': 'ES256', 'kid': key_id, 'typ': 'JWT'}).encode())
    payload = b64(json.dumps({
        'iss': issuer,
        'exp': int(time.time()) + 900,
        'aud': 'appstoreconnect-v1',
    }).encode())
    signing_input = f'{header}.{payload}'.encode()
    der = subprocess.run(
        ['openssl', 'dgst', '-sha256', '-sign', key_path],
        input=signing_input, capture_output=True, check=True,
    ).stdout
    return f'{header}.{payload}.{b64(der_to_raw(der))}'


TOKEN = token()


def get(path: str) -> dict:
    req = urllib.request.Request(API + path, headers={'Authorization': f'Bearer {TOKEN}'})
    try:
        with urllib.request.urlopen(req) as res:
            return json.load(res)
    except urllib.error.HTTPError as err:
        detail = ''
        try:
            detail = json.load(err)['errors'][0].get('detail', '')
        except Exception:
            pass
        sys.exit(f'{path} → {err.code}: {detail}')


apps = get('/v1/apps?limit=50')['data']
app = next((a for a in apps if a['attributes']['bundleId'] == BUNDLE_ID), None)
if app is None:
    sys.exit(f'{BUNDLE_ID} is not in this key\'s app list — wrong Apple account')

out: dict = {'app': {
    'id': app['id'],
    'name': app['attributes']['name'],
    'bundleId': app['attributes']['bundleId'],
}}

out['versions'] = []
for version in get(f"/v1/apps/{app['id']}/appStoreVersions?limit=5")['data']:
    locales = []
    for loc in get(f"/v1/appStoreVersions/{version['id']}/appStoreVersionLocalizations")['data']:
        attrs = loc['attributes']
        sets = get(f"/v1/appStoreVersionLocalizations/{loc['id']}/appScreenshotSets")['data']
        locales.append({
            'locale': attrs['locale'],
            'description': len(attrs.get('description') or ''),
            'keywords': attrs.get('keywords') or '',
            'whatsNew': len(attrs.get('whatsNew') or ''),
            'screenshotSets': [{
                'display': s['attributes']['screenshotDisplayType'],
                'count': len(get(f"/v1/appScreenshotSets/{s['id']}/appScreenshots")['data']),
            } for s in sets],
        })
    out['versions'].append({
        'version': version['attributes']['versionString'],
        'state': version['attributes']['appStoreState'],
        'locales': locales,
    })

out['appInfo'] = []
for info in get(f"/v1/apps/{app['id']}/appInfos")['data']:
    ilocs = get(f"/v1/appInfos/{info['id']}/appInfoLocalizations")['data']
    out['appInfo'].append({
        'state': info['attributes']['appStoreState'],
        'locales': [{'locale': l['attributes']['locale'], 'name': l['attributes']['name']}
                    for l in ilocs],
    })

if '--json' in sys.argv:
    print(json.dumps(out, ensure_ascii=False, indent=2))
else:
    print(f"{out['app']['name']}  ({out['app']['bundleId']}, id {out['app']['id']})")
    for v in out['versions']:
        print(f"\n{v['version']} — {v['state']}")
        for l in v['locales']:
            shots = ', '.join(f"{s['display']} {s['count']}장" for s in l['screenshotSets'])
            print(f"  {l['locale']:<8}  설명 {l['description']}자"
                  f"  키워드 {l['keywords'][:40]}"
                  f"  사진 {shots or '없음'}")
    for i in out['appInfo']:
        names = ', '.join(f"{l['locale']}={l['name']}" for l in i['locales'])
        print(f"\n스토어 이름 ({i['state']}): {names}")
