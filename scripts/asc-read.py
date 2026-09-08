#!/usr/bin/env python3
"""Read what App Store Connect actually holds for this app.

Written 2026-08-29 after an assistant reported the store's state by listing a
folder on disk — "the first screenshot is a launch screen, Korean is zero" —
when the screenshots had long been uploaded and the folder it read was a stale
copy nobody ships. A directory listing is not the store. This is.

    source .env.ios && python3 scripts/asc-read.py           # store listing
    source .env.ios && python3 scripts/asc-read.py builds    # TestFlight builds
    source .env.ios && python3 scripts/asc-read.py --json    # machine readable
    source .env.ios && python3 scripts/asc-read.py --get /v1/betaGroups   # one read

An unknown word is REFUSED rather than ignored. Until 2026-09-04 this script
took no subcommand at all, so `asc-read.py builds` printed the store listing —
descriptions, keywords, screenshots — and an assistant read that as "the build
is not on TestFlight". Silently ignoring an argument is how a reader ends up
confidently looking at the wrong thing.

Needs ASC_KEY_ID, ASC_ISSUER_ID, ASC_API_KEY_PATH — the same three fastlane
uses.

Signing and sending live in `asc_api.py`, which this and every other App
Store script here now share. Until 2026-09-08 there were three copies of it and
two scripts that exec'd a SLICE OF THIS FILE'S SOURCE to borrow the `get`
helper, because there was nothing importable.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from asc_api import get  # noqa: E402

BUNDLE_ID = 'com.masselabs.zkproofport'


# `--get <path>` answers one arbitrary read and stops. Without it, any question
# the fixed report below does not cover — TestFlight groups, who is a tester,
# which build a group can see — needs either a second script or a hand-rolled
# curl with its own ES256 signing. Placed here because the report starts making
# requests on the very next line.
if '--get' in sys.argv:
    print(json.dumps(get(sys.argv[sys.argv.index('--get') + 1]), ensure_ascii=False, indent=2))
    raise SystemExit(0)

KNOWN_WORDS = {'builds'}
words = [a for a in sys.argv[1:] if not a.startswith('--')]
unknown = [w for w in words if w not in KNOWN_WORDS]
if unknown:
    sys.exit(f"unknown argument: {' '.join(unknown)}\n"
             f"  known: {' '.join(sorted(KNOWN_WORDS))}, or --json / --get <path>")

apps = get('/v1/apps?limit=50')['data']
app = next((a for a in apps if a['attributes']['bundleId'] == BUNDLE_ID), None)
if app is None:
    sys.exit(f'{BUNDLE_ID} is not in this key\'s app list — wrong Apple account')

out: dict = {'app': {
    'id': app['id'],
    'name': app['attributes']['name'],
    'bundleId': app['attributes']['bundleId'],
}}

# TESTFLIGHT BUILDS. A different question from the store listing below, and the
# one asked after every release: did the upload arrive, and has Apple finished
# processing it. `processingState` is what answers that — a build sits in
# PROCESSING for several minutes before testers can install it, so VALID is the
# state that means "it is really there".
if 'builds' in words:
    builds = get(f"/v1/builds?filter[app]={app['id']}&limit=10"
                 "&sort=-uploadedDate&fields[builds]="
                 "version,uploadedDate,processingState,expired")['data']
    if '--json' in sys.argv:
        print(json.dumps(builds, ensure_ascii=False, indent=2))
    elif not builds:
        print('TestFlight: no builds at all')
    else:
        print(f"{app['attributes']['name']}  TestFlight 빌드 {len(builds)}개 (최근순)")
        for b in builds:
            a = b['attributes']
            print(f"  빌드 {a.get('version', '?'):<6} {a.get('processingState', '?'):<12}"
                  f" 올린시각 {a.get('uploadedDate', '?')}"
                  f"{'  만료됨' if a.get('expired') else ''}")
    raise SystemExit(0)

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
