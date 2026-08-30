#!/usr/bin/env python3
"""Push the TestFlight "What to Test" note from the repo to the newest build.

    source .env.ios && python3 scripts/asc-set-build-note.py           # 무엇이 바뀌는지만 보여준다
    source .env.ios && python3 scripts/asc-set-build-note.py --write   # 실제로 쓴다

The note used to be typed straight into the console, and build 3's opened with
"the app comes up in English; that is known, no need to report it". That was
true when written. The moment the Korean declaration shipped it became an
instruction to ignore the defect the build existed to fix. Keeping the text in
`ios/fastlane/testflight-notes/` makes it reviewable; this script carries it up.

Defaults to showing the change rather than making it — writing to the store is
not something to do as a side effect of running a script.
"""
import json
import os
import sys
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
NOTES = os.path.join(REPO, 'ios', 'fastlane', 'testflight-notes')
APP = '6803903114'
MAX_CHARS = 4000  # Apple rejects a longer whatsNew

src = open(os.path.join(HERE, 'asc-read.py')).read()
ns = {'__name__': 'ascread'}
exec(compile(src.split("apps = get(")[0], 'asc-read.py', 'exec'), ns)
get, TOKEN, API = ns['get'], ns['TOKEN'], ns['API']

WRITE = '--write' in sys.argv


def send(method: str, path: str, body: dict) -> dict:
    req = urllib.request.Request(
        API + path, method=method,
        data=json.dumps(body).encode(),
        headers={'Authorization': f'Bearer {TOKEN}',
                 'Content-Type': 'application/json'},
    )
    try:
        with urllib.request.urlopen(req) as res:
            return json.load(res)
    except urllib.error.HTTPError as err:
        detail = ''
        try:
            detail = json.load(err)['errors'][0].get('detail', '')
        except Exception:
            pass
        sys.exit(f'{method} {path} → {err.code}: {detail}')


builds = get(f'/v1/builds?filter[app]={APP}&limit=1&sort=-uploadedDate')['data']
if not builds:
    sys.exit('이 앱에 올라간 빌드가 없다')
build = builds[0]
print(f"대상: 빌드 {build['attributes']['version']} "
      f"(처리 {build['attributes']['processingState']}, 올림 {build['attributes']['uploadedDate']})")

existing = {loc['attributes']['locale']: loc
            for loc in get(f"/v1/builds/{build['id']}/betaBuildLocalizations")['data']}

changed = 0
for filename in sorted(os.listdir(NOTES)):
    if not filename.endswith('.txt'):
        continue
    locale = filename[:-4]
    text = open(os.path.join(NOTES, filename)).read().strip()
    if len(text) > MAX_CHARS:
        sys.exit(f'{filename} 이 {len(text)}자 — 애플 한도 {MAX_CHARS}자를 넘는다')

    current = (existing.get(locale, {}).get('attributes', {}) or {}).get('whatsNew') or ''
    if current.strip() == text:
        print(f'  [{locale}] 이미 같다 — 건드리지 않음')
        continue

    changed += 1
    print(f'\n  [{locale}] 바뀐다 ({len(current)}자 → {len(text)}자)')
    print(f'    지금 첫 줄: {(current.splitlines() or ["(비어 있음)"])[0]}')
    print(f'    바꿀 첫 줄: {text.splitlines()[0]}')

    if not WRITE:
        continue

    if locale in existing:
        send('PATCH', f"/v1/betaBuildLocalizations/{existing[locale]['id']}",
             {'data': {'type': 'betaBuildLocalizations',
                       'id': existing[locale]['id'],
                       'attributes': {'whatsNew': text}}})
    else:
        send('POST', '/v1/betaBuildLocalizations',
             {'data': {'type': 'betaBuildLocalizations',
                       'attributes': {'locale': locale, 'whatsNew': text},
                       'relationships': {'build': {'data': {'type': 'builds',
                                                            'id': build['id']}}}}})
    print('    올렸다')

if not changed:
    print('\n바꿀 것 없음')
elif not WRITE:
    print(f'\n{changed}개 언어가 다르다. 실제로 쓰려면 --write 를 붙일 것 — 이대로는 아무것도 안 바꿨다')
