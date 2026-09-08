#!/usr/bin/env python3
"""Change the App Store version record. The counterpart to `asc-read.py`.

    source .env.ios && python3 scripts/asc-write.py show
    source .env.ios && python3 scripts/asc-write.py set-version 1.3.1
    source .env.ios && python3 scripts/asc-write.py set-build 9

Why a script and not the console: the two fields below are ordered — Apple only
offers builds whose marketing version equals the version record's number, so
setting the build before the number silently offers the wrong list. Doing it
here makes the order explicit and prints what actually changed afterwards.

WHAT THIS DOES NOT DO: it never submits. `set-build` and `set-version` edit a
record that is still in PREPARE_FOR_SUBMISSION; App Privacy answers and the
submit itself are console-only. That separation is deliberate — a submission is
not something a script should be able to do by accident.
"""
import sys
import os
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from asc_api import get, request  # noqa: E402

BUNDLE_ID = 'com.masselabs.zkproofport'
EDITABLE = {'PREPARE_FOR_SUBMISSION', 'DEVELOPER_REJECTED', 'REJECTED',
            'METADATA_REJECTED', 'INVALID_BINARY'}


def settles_on(read, wanted, tries=6, gap=1.0):
    """Read until the API agrees, or give up and answer what it last said.

    App Store Connect answers 200 to a change and then serves the OLD value for
    a moment. On 2026-09-07 setting the content-rights answer looked like a
    silent no-op for exactly this reason, and a second identical PATCH "fixed"
    something that was never broken. Reading once is not enough; reading
    forever hides a real failure. So: a few tries, then report the truth.
    """
    seen = None
    for attempt in range(tries):
        seen = read()
        if seen == wanted:
            return seen
        if attempt < tries - 1:
            time.sleep(gap)
    return seen


def app_id() -> str:
    for app in get('/v1/apps?limit=50')['data']:
        if app['attributes']['bundleId'] == BUNDLE_ID:
            return app['id']
    sys.exit(f"{BUNDLE_ID} is not in this key's app list — wrong Apple account")


def editable_version(app: str) -> dict:
    """The version record still open for editing, or exit saying which are not."""
    versions = get(f'/v1/apps/{app}/appStoreVersions?limit=10')['data']
    for v in versions:
        if v['attributes']['appStoreState'] in EDITABLE:
            return v
    states = ', '.join(f"{v['attributes']['versionString']} ({v['attributes']['appStoreState']})"
                       for v in versions)
    sys.exit(f'no version is open for editing — found: {states}')


def show(app: str, version: dict) -> None:
    a = version['attributes']
    print(f"버전 기록 {a['versionString']} — {a['appStoreState']}")
    build = get(f"/v1/appStoreVersions/{version['id']}/build").get('data')
    if build is None:
        print('  붙어 있는 빌드: 없음')
    else:
        b = build['attributes']
        print(f"  붙어 있는 빌드: {b.get('version')} (올린시각 {b.get('uploadedDate')})")
    builds = get(f'/v1/builds?filter[app]={app}&limit=10&sort=-uploadedDate'
                 '&fields[builds]=version,uploadedDate,processingState,expired')['data']
    print('  고를 수 있는 빌드 (최근순):')
    for b in builds:
        at = b['attributes']
        print(f"    빌드 {at.get('version'):<4} {at.get('processingState'):<12} "
              f"{at.get('uploadedDate')}{'  만료됨' if at.get('expired') else ''}")


def main() -> None:
    words = sys.argv[1:]
    if not words:
        sys.exit(__doc__)
    command = words[0]
    app = app_id()
    version = editable_version(app)

    if command == 'show':
        show(app, version)

    elif command == 'set-version':
        if len(words) < 2:
            sys.exit('set-version needs a version string, e.g. 1.3.1')
        wanted = words[1]
        request('PATCH', f"/v1/appStoreVersions/{version['id']}", {
            'data': {'type': 'appStoreVersions', 'id': version['id'],
                     'attributes': {'versionString': wanted}},
        })
        now = settles_on(
            lambda: get(f"/v1/appStoreVersions/{version['id']}")['data']['attributes']['versionString'],
            wanted)
        # Read it back rather than trusting the 200: a PATCH that Apple accepts
        # and quietly does not apply is indistinguishable from one that worked.
        print(f"버전 기록: {version['attributes']['versionString']} → {now}")
        if now != wanted:
            sys.exit(f'asked for {wanted} but the record says {now}')

    elif command == 'set-content-rights':
        # Apple blocks submission until this is answered. The question is
        # whether the app contains, displays or accesses THIRD-PARTY content —
        # someone else's music, video, images, text. It is not about libraries
        # or sign-in providers.
        choices = {'none': 'DOES_NOT_USE_THIRD_PARTY_CONTENT',
                   'uses': 'USES_THIRD_PARTY_CONTENT'}
        if len(words) < 2 or words[1] not in choices:
            sys.exit(f"set-content-rights needs one of: {' '.join(choices)}")
        request('PATCH', f'/v1/apps/{app}', {
            'data': {'type': 'apps', 'id': app,
                     'attributes': {'contentRightsDeclaration': choices[words[1]]}},
        })
        now = settles_on(
            lambda: get(f'/v1/apps/{app}')['data']['attributes']['contentRightsDeclaration'],
            choices[words[1]])
        print(f'콘텐츠 권한: {now}')
        if now != choices[words[1]]:
            sys.exit(f'asked for {choices[words[1]]} but the record says {now}')

    elif command == 'set-free':
        # A price schedule is created whole, not edited: one POST carrying the
        # base territory and the price rows. The row references a price point
        # through `included` with a placeholder id — that is Apple's shape for
        # creating both objects in one request, and a plain relationship
        # without it is refused.
        points = get(f'/v1/apps/{app}/appPricePoints?filter[territory]=USA&limit=200')['data']
        free = [pt for pt in points if float(pt['attributes'].get('customerPrice', -1)) == 0.0]
        if not free:
            sys.exit('no zero-price point offered for USA — check the territory')
        request('POST', '/v1/appPriceSchedules', {
            'data': {
                'type': 'appPriceSchedules',
                'relationships': {
                    'app': {'data': {'type': 'apps', 'id': app}},
                    'baseTerritory': {'data': {'type': 'territories', 'id': 'USA'}},
                    'manualPrices': {'data': [{'type': 'appPrices', 'id': '${price}'}]},
                },
            },
            'included': [{
                'type': 'appPrices',
                'id': '${price}',
                'relationships': {
                    'appPricePoint': {'data': {'type': 'appPricePoints', 'id': free[0]['id']}},
                },
            }],
        })
        back = get(f'/v1/appPriceSchedules/{app}/manualPrices?limit=5').get('data', [])
        print(f'가격 행 {len(back)}개 설정됨 (무료)')
        if not back:
            sys.exit('the schedule came back empty — check the console')

    elif command == 'show-notes':
        detail = get(f"/v1/appStoreVersions/{version['id']}/appStoreReviewDetail")['data']
        print(detail['attributes']['notes'])

    elif command == 'set-notes':
        # Takes a file rather than an inline string: the notes run to thousands
        # of characters across many lines, and a shell argument mangles them.
        if len(words) < 2:
            sys.exit('set-notes needs a path to a file holding the new notes')
        wanted = open(words[1]).read()
        detail = get(f"/v1/appStoreVersions/{version['id']}/appStoreReviewDetail")['data']
        request('PATCH', f"/v1/appStoreReviewDetails/{detail['id']}", {
            'data': {'type': 'appStoreReviewDetails', 'id': detail['id'],
                     'attributes': {'notes': wanted}},
        })
        back = get(f"/v1/appStoreVersions/{version['id']}/appStoreReviewDetail")
        now = back['data']['attributes']['notes']
        print(f"심사 노트: {len(detail['attributes']['notes'])}자 → {len(now)}자")
        if now != wanted:
            sys.exit('what came back is not what was sent — check the console')

    elif command == 'set-build':
        if len(words) < 2:
            sys.exit('set-build needs a build number, e.g. 9')
        wanted = words[1]
        builds = get(f'/v1/builds?filter[app]={app}&limit=20&sort=-uploadedDate'
                     '&fields[builds]=version,processingState,expired')['data']
        match = [b for b in builds if b['attributes'].get('version') == wanted]
        if not match:
            have = ', '.join(b['attributes'].get('version') for b in builds)
            sys.exit(f'no build numbered {wanted} — this app has: {have}')
        build = match[0]
        state = build['attributes'].get('processingState')
        if state != 'VALID':
            sys.exit(f'build {wanted} is {state}, not VALID — it cannot be attached yet')
        request('PATCH', f"/v1/appStoreVersions/{version['id']}/relationships/build",
                {'data': {'type': 'builds', 'id': build['id']}})
        back = get(f"/v1/appStoreVersions/{version['id']}/build").get('data')
        now = back['attributes'].get('version') if back else None
        print(f"붙은 빌드: {now}")
        if now != wanted:
            sys.exit(f'asked for build {wanted} but the record holds {now}')

    else:
        sys.exit(f'unknown command: {command}\n{__doc__}')


if __name__ == '__main__':
    main()
