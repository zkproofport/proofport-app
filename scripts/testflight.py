#!/usr/bin/env python3
"""Read and manage TestFlight groups and testers from here.

    source .env.ios && python3 scripts/testflight.py groups
    source .env.ios && python3 scripts/testflight.py testers [<groupId>]
    source .env.ios && python3 scripts/testflight.py invite <email>

    source .env.ios && python3 scripts/testflight.py add <email> [<groupName>]

`invite` re-sends the invitation email to somebody who is ALREADY a tester.
`add` puts a new person in a group, which emails them for the first time; the
group defaults to 'Internal'.

Internal testers must be App Store Connect users on this team, holding one of
Account Holder, Admin, App Manager, Developer or Marketing. **They do NOT need
their own paid Apple Developer Program membership** — the membership belongs to
the organisation, and a user added under Users and Access is covered by it.
Checked 2026-09-04 against Apple's "Add internal testers" help page after the
question came up. Two of the three people already testing hold the plain
Developer role, which is the same evidence from this side.

Needs ASC_KEY_ID, ASC_ISSUER_ID, ASC_API_KEY_PATH — the same three fastlane and
`asc-read.py` use.

The ES256 signing below is a second copy of the one in `scripts/asc-read.py`.
That file is read-only by name and by promise, and this one writes, so they are
kept apart rather than one importing the other. If a third script ever needs the
same block, extract it instead of making a third copy.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from asc_api import request  # noqa: E402



def call(path: str, body=None):
    """POST when there is a body, GET otherwise — the shape this script uses."""
    return request('POST' if body is not None else 'GET', path, body)


def app_id() -> str:
    apps = call('/v1/apps?limit=50')['data']
    app = next((a for a in apps if a['attributes']['bundleId'] == BUNDLE_ID), None)
    if app is None:
        sys.exit(f"{BUNDLE_ID} is not in this key's app list — wrong Apple account")
    return app['id']


def groups(app: str) -> list:
    return call(f'/v1/apps/{app}/betaGroups?limit=50')['data']


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    command = sys.argv[1]
    app = app_id()

    if command == 'groups':
        for g in groups(app):
            a = g['attributes']
            kind = 'internal' if a.get('isInternalGroup') else 'external'
            link = a.get('publicLink') or ('public link off' if not a.get('publicLinkEnabled') else '?')
            print(f"{a.get('name')!r}  {kind}  {link}  id={g['id']}")

    elif command == 'testers':
        wanted = sys.argv[2] if len(sys.argv) > 2 else None
        for g in groups(app):
            if wanted and g['id'] != wanted:
                continue
            a = g['attributes']
            kind = 'internal' if a.get('isInternalGroup') else 'external'
            print(f"\n{a.get('name')!r} ({kind})")
            people = call(f"/v1/betaGroups/{g['id']}/betaTesters?limit=200")['data']
            if not people:
                print('  no testers')
            for t in people:
                ta = t['attributes']
                name = f"{ta.get('firstName') or ''} {ta.get('lastName') or ''}".strip()
                print(f"  {ta.get('email'):<40} {name:<20} state={ta.get('state') or ta.get('inviteType')}")

    elif command == 'add':
        # Adding somebody emails them, so the address and the group are both
        # spelled out rather than guessed at.
        email = sys.argv[2].strip().lower()
        want = sys.argv[3] if len(sys.argv) > 3 else 'Internal'
        group = next((g for g in groups(app) if g['attributes'].get('name') == want), None)
        if group is None:
            sys.exit(f"no group named {want!r} — run `groups` to see what exists")
        already = [t for t in call(f"/v1/betaGroups/{group['id']}/betaTesters?limit=200")['data']
                   if (t['attributes'].get('email') or '').lower() == email]
        if already:
            sys.exit(f"{email} is already in {want!r} "
                     f"(state={already[0]['attributes'].get('state')}). "
                     f"Use `invite` to re-send the email.")
        call('/v1/betaTesters', {
            'data': {
                'type': 'betaTesters',
                'attributes': {'email': email},
                'relationships': {
                    'betaGroups': {'data': [{'type': 'betaGroups', 'id': group['id']}]},
                },
            },
        })
        print(f"{email} added to {want!r}. Apple has emailed them.")

    elif command == 'invite':
        # Re-sends the invitation email. The tester has to exist already; this
        # is on purpose — see the module docstring.
        email = sys.argv[2].strip().lower()
        found = None
        for g in groups(app):
            for t in call(f"/v1/betaGroups/{g['id']}/betaTesters?limit=200")['data']:
                if (t['attributes'].get('email') or '').lower() == email:
                    found = (t, g)
                    break
            if found:
                break
        if not found:
            sys.exit(f'{email} is not a tester on this app yet. Add them to a group first '
                     f'(App Store Connect -> TestFlight), then re-run this.')
        tester, group = found
        call('/v1/betaTesterInvitations', {
            'data': {
                'type': 'betaTesterInvitations',
                'relationships': {
                    'app': {'data': {'type': 'apps', 'id': app}},
                    'betaTester': {'data': {'type': 'betaTesters', 'id': tester['id']}},
                },
            },
        })
        print(f"Invitation re-sent to {email} "
              f"(group {group['attributes'].get('name')!r}).")
        print("Apple sends the email; there is no link to copy from here — the "
              "person opens it on the device and redeems it in TestFlight.")

    else:
        sys.exit(__doc__)


if __name__ == '__main__':
    main()
