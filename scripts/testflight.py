#!/usr/bin/env python3
"""Read and manage TestFlight groups and testers from here.

    source .env.ios && python3 scripts/testflight.py groups
    source .env.ios && python3 scripts/testflight.py testers [<groupId>]
    source .env.ios && python3 scripts/testflight.py invite <email>

    source .env.ios && python3 scripts/testflight.py add <email> [<groupName>]
    source .env.ios && python3 scripts/testflight.py open-beta <buildNumber> [<groupName>]

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

BUNDLE_ID = 'com.masselabs.zkproofport'


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

    elif command == 'open-beta':
        open_beta(app, sys.argv[2:])

    else:
        sys.exit(__doc__)


REVIEW_NOTES = (
    "ZKProofport generates zero-knowledge proofs on the phone. This is a testnet "
    "build: no account and no payment are needed. To try it: connect a wallet in "
    "the app, issue yourself a Dojang on the GIWA Playground faucet with that "
    "wallet, then open https://stg-demo.zkproofport.app (Ssiat tab) and follow the "
    "steps; the app opens to generate the proof."
)

WHAT_TO_TEST = {
    'en-US': "Generate a proof with the Dojang Playground (GIWA Sepolia testnet) and "
             "use it on https://stg-demo.zkproofport.app. Testnet only; nothing has value.",
    'ko': "Dojang Playground(GIWA Sepolia 테스트넷) 증명을 만들어 "
          "https://stg-demo.zkproofport.app 에서 사용해 보세요. 테스트넷 전용이며 가치가 없습니다.",
}


def open_beta(app: str, args: list):
    """Open a public TestFlight link for one build, and send that build to Beta App Review.

        testflight.py open-beta <buildNumber> [<groupName>]   (group default: 'Public beta')

    Steps, each idempotent so a re-run after a failure continues:
      1. Beta review contact: copied from the App Store review contact already on
         file (the newest version's appStoreReviewDetail), so nothing personal is
         typed here. Apple refuses a beta submission without it.
      2. An external group with a public link (created, or switched on).
      3. The build added to that group, with "What to Test" in en-US and ko.
      4. The build submitted to Beta App Review (an existing submission is kept).
    Export compliance is NOT answered here: a build that has not answered it
    stops the command, naming it, because that answer is a legal statement.
    """
    if not args:
        sys.exit('usage: testflight.py open-beta <buildNumber> [<groupName>]')
    number, group_name = args[0], (args[1] if len(args) > 1 else 'Public beta')

    builds = call(f'/v1/builds?filter[app]={app}&filter[version]={number}&limit=5')['data']
    if len(builds) != 1:
        sys.exit(f'build {number}: {len(builds)} builds answer that number; expected exactly one')
    build = builds[0]
    battrs = build['attributes']
    if battrs.get('processingState') != 'VALID':
        sys.exit(f"build {number} is {battrs.get('processingState')}, not VALID")
    if battrs.get('usesNonExemptEncryption') is None:
        sys.exit(f'build {number} has not answered export compliance; answer it in App Store Connect first')
    print(f"build {number}: id={build['id']} VALID, usesNonExemptEncryption={battrs['usesNonExemptEncryption']}")

    versions = call(f'/v1/apps/{app}/appStoreVersions?limit=1&include=appStoreReviewDetail')
    detail = next((i for i in versions.get('included', []) if i['type'] == 'appStoreReviewDetails'), None)
    if detail is None:
        sys.exit('no App Store review contact on file to copy into the beta review contact')
    d = detail['attributes']
    missing = [k for k in ('contactFirstName', 'contactLastName', 'contactPhone', 'contactEmail') if not d.get(k)]
    if missing:
        sys.exit(f"the App Store review contact lacks {', '.join(missing)}")
    request('PATCH', f'/v1/betaAppReviewDetails/{app}', {
        'data': {
            'type': 'betaAppReviewDetails', 'id': app,
            'attributes': {
                'contactFirstName': d['contactFirstName'], 'contactLastName': d['contactLastName'],
                'contactPhone': d['contactPhone'], 'contactEmail': d['contactEmail'],
                'demoAccountRequired': False, 'notes': REVIEW_NOTES,
            },
        },
    })
    print('beta review contact: copied from the App Store review contact; demo account not required')

    group = next((g for g in groups(app) if g['attributes'].get('name') == group_name), None)
    if group is None:
        group = call('/v1/betaGroups', {
            'data': {
                'type': 'betaGroups',
                'attributes': {'name': group_name, 'publicLinkEnabled': True,
                               'publicLinkLimitEnabled': False, 'feedbackEnabled': True},
                'relationships': {'app': {'data': {'type': 'apps', 'id': app}}},
            },
        })['data']
        print(f'group {group_name!r}: created')
    elif group['attributes'].get('isInternalGroup'):
        sys.exit(f'group {group_name!r} is internal; a public link needs an external group')
    elif not group['attributes'].get('publicLinkEnabled'):
        group = request('PATCH', f"/v1/betaGroups/{group['id']}", {
            'data': {'type': 'betaGroups', 'id': group['id'],
                     'attributes': {'publicLinkEnabled': True, 'publicLinkLimitEnabled': False}},
        })['data']
        print(f'group {group_name!r}: public link switched on')

    request('POST', f"/v1/betaGroups/{group['id']}/relationships/builds",
            {'data': [{'type': 'builds', 'id': build['id']}]})
    print(f'group {group_name!r}: build {number} added')

    existing = {loc['attributes']['locale']: loc for loc in
                call(f"/v1/builds/{build['id']}/betaBuildLocalizations")['data']}
    for locale, text in WHAT_TO_TEST.items():
        if locale in existing:
            request('PATCH', f"/v1/betaBuildLocalizations/{existing[locale]['id']}", {
                'data': {'type': 'betaBuildLocalizations', 'id': existing[locale]['id'],
                         'attributes': {'whatsNew': text}},
            })
        else:
            call('/v1/betaBuildLocalizations', {
                'data': {'type': 'betaBuildLocalizations',
                         'attributes': {'locale': locale, 'whatsNew': text},
                         'relationships': {'build': {'data': {'type': 'builds', 'id': build['id']}}}},
            })
    print(f"what to test: {', '.join(WHAT_TO_TEST)}")

    state = call(f"/v1/builds/{build['id']}/buildBetaDetail")['data']['attributes']
    if state.get('externalBuildState') in ('WAITING_FOR_BETA_REVIEW', 'IN_BETA_REVIEW', 'BETA_APPROVED', 'IN_BETA_TESTING'):
        print(f"beta review: already {state['externalBuildState']}")
    else:
        call('/v1/betaAppReviewSubmissions', {
            'data': {'type': 'betaAppReviewSubmissions',
                     'relationships': {'build': {'data': {'type': 'builds', 'id': build['id']}}}},
        })
        state = call(f"/v1/builds/{build['id']}/buildBetaDetail")['data']['attributes']
        print(f"beta review: submitted, now {state.get('externalBuildState')}")

    group = call(f"/v1/betaGroups/{group['id']}")['data']
    print(f"public link: {group['attributes'].get('publicLink')} "
          '(testers can join once the build passes Beta App Review)')


if __name__ == '__main__':
    main()
