#!/usr/bin/env python3
"""Say which screenshots are live on each store, and whether the repo matches.

    source .env.ios && scripts/store-screenshots.py

Why this exists: on 2026-08-30 a session opened a folder of screenshots, found
them wrong, and reported that the store carried the wrong pictures. The store
was fine — the folder was a July backup nobody uploads from. There are five
folders on disk that look like the answer and only two of them are. Reading a
folder cannot tell you what a store is serving; asking the store can.

Both stores hand out a checksum of what they hold, so the comparison is exact
rather than "the dates look about right":

  Play      sha256, per image, from the listing
  App Store md5 (sourceFileChecksum) plus the original file name

A mismatch here means the repo and the store have genuinely diverged. It does
NOT say which one is correct — a screenshot retaken locally and not yet uploaded
looks the same as a store carrying something stale.
"""
import hashlib
import importlib.util
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from asc_api import get  # noqa: E402

APP = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP_ID = '6803903114'

# Only these four folders feed a store. Anything else that looks like a
# screenshot folder — the July asc-backup, the empty ios/fastlane/screenshots —
# is not uploaded from and is listed at the end so it cannot be mistaken again.
SOURCES = {
    ('App Store', 'en-US'): 'screenshots',
    ('App Store', 'ko'): 'screenshots/ios-ko',
    ('Play', 'en-US'): 'android/fastlane/metadata/android/en-US/images/phoneScreenshots',
    ('Play', 'ko-KR'): 'android/fastlane/metadata/android/ko-KR/images/phoneScreenshots',
}
NOT_UPLOADED_FROM = [
    ('ios/fastlane/screenshots',
     'fastlane deliver would use this, but the shots are uploaded by script instead'),
]


def digests(folder: str) -> dict:
    """{file name: (md5, sha256)} for the screenshots in one folder, top level only."""
    out = {}
    path = os.path.join(APP, folder)
    if not os.path.isdir(path):
        return out
    for name in sorted(os.listdir(path)):
        if not name.lower().endswith('.png'):
            continue
        # icon and feature graphic live beside the shots and are not screenshots
        if name.startswith(('app-icon', 'feature-graphic')):
            continue
        raw = open(os.path.join(path, name), 'rb').read()
        out[name] = (hashlib.md5(raw).hexdigest(), hashlib.sha256(raw).hexdigest())
    return out


def report(store, lang, live, folder):
    """live: list of (label, checksum). Compare against the folder by checksum."""
    known = digests(folder)
    by_sum = {}
    for name, (md5, sha) in known.items():
        by_sum[md5] = name
        by_sum[sha] = name
    print(f"\n{store} · {lang} — 올라간 것 {len(live)}장, 저장소 {len(known)}장")
    print(f"  저장소 폴더: {folder}")
    matched = set()
    for order, (label, checksum) in enumerate(live, 1):
        hit = by_sum.get(checksum)
        if hit:
            matched.add(hit)
            print(f"  {order}. {label:16} = {hit}")
        else:
            print(f"  {order}. {label:16} ✗ 저장소의 어느 파일과도 다름 ({checksum[:12]})")
    for name in known:
        if name not in matched:
            print(f"     {name} 은 저장소에만 있고 올라가 있지 않음")


def play():
    spec = importlib.util.spec_from_file_location(
        "playapi", os.path.join(os.path.dirname(os.path.abspath(__file__)), "play-api.py"))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    tok = m.access_token()
    edit = m.call(tok, "/edits", method="POST", body={})["id"]
    for lang in ("en-US", "ko-KR"):
        images = m.call(tok, f"/edits/{edit}/listings/{lang}/phoneScreenshots").get("images", [])
        report("Play", lang,
               [(img["id"][:12], img["sha256"]) for img in images],
               SOURCES[('Play', lang)])
    m.call(tok, f"/edits/{edit}", method="DELETE")


def app_store():
    versions = get(f'/v1/apps/{APP_ID}/appStoreVersions?limit=5')['data']
    version = versions[0]
    print(f"\nApp Store 버전 {version['attributes']['versionString']} "
          f"({version['attributes']['appStoreState']})")
    locs = get(f"/v1/appStoreVersions/{version['id']}/appStoreVersionLocalizations")['data']
    for loc in locs:
        lang = loc['attributes']['locale']
        if ('App Store', lang) not in SOURCES:
            print(f"\nApp Store · {lang} — 대응하는 저장소 폴더가 정의돼 있지 않다")
            continue
        live = []
        for st in get(f"/v1/appStoreVersionLocalizations/{loc['id']}/appScreenshotSets")['data']:
            for shot in get(f"/v1/appScreenshotSets/{st['id']}/appScreenshots")['data']:
                a = shot['attributes']
                live.append((a['fileName'], a['sourceFileChecksum']))
        report("App Store", lang, live, SOURCES[('App Store', lang)])


if __name__ == '__main__':
    play()
    if os.environ.get('ASC_KEY_ID') or os.path.exists(os.path.expanduser('~/.apple')):
        try:
            app_store()
        except SystemExit as e:
            print(f"\nApp Store 조회 실패: {e}\n  `source proofport-app/.env.ios` 를 먼저 하십시오")
    else:
        print("\nApp Store 는 건너뜀 — `source proofport-app/.env.ios` 를 먼저 하십시오")

    print("\n올리는 데 쓰이지 않는 폴더 (여기를 보고 판단하지 말 것):")
    for folder, why in NOT_UPLOADED_FROM:
        # count into sub-folders: the backup keeps its shots one level down, and
        # a top-level count reported it as empty, which is its own small lie
        n = sum(len([f for f in files if f.lower().endswith('.png')])
                for _, _, files in os.walk(os.path.join(APP, folder)))
        print(f"  {folder}  ({n}장) — {why}")
