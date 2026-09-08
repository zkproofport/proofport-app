#!/usr/bin/env python3
"""Talk to the Play Developer API with the local publisher key.

Why this exists: the key used to live only in a GitHub secret, which cannot be
read back, so every question about the console's state had to go through a CI
run. The same key is now on disk (see the path below) and this script is the
way to use it.

    scripts/play-api.py tracks           # what is on each track right now
    scripts/play-api.py bundles          # bundles uploaded INSIDE this edit —
                                         # NOT the app's bundle library. It
                                         # answers empty on an edit that has
                                         # uploaded nothing, which is every edit
                                         # this script opens, and that empty
                                         # reads as "the app has no bundles".
                                         # Google's own wording is "all current
                                         # Android App Bundles of the app and
                                         # edit"; the edit half is the operative
                                         # one. The library is console-only.
    scripts/play-api.py get <path>       # any read-only GET under the edit
    scripts/play-api.py app-get <path>   # a GET on the application, not an edit

Two reads that answer `{}` and mean nothing by it. Do not report either as
"there are none":

  /testers/<track>   holds Google GROUPS only. Google's own note: "while it is
                     possible in the Play Console UI to add testers via email
                     lists, email lists are not supported by this resource."
                     This app's testers ARE an email list, so this is always {}.
  /details           app-level contact fields, nothing about tracks.
    scripts/play-api.py put-track <track> <versionCode> [draft|completed]
    scripts/play-api.py try-track <track> <versionCode> [draft|completed]

    Both take an optional country flag. Production refuses a release that
    targets no countries ("Release in track targeting no countries"), and the
    countries picked for a TEST track do NOT carry over to production — they
    are stored per track. So the codes have to be said here:

        --countries-from=alpha   copy the country list off another track
        --countries=KR,US        an explicit list
        --countries=ALL          everywhere Play sells, including new countries

    Play only accepts a country list on a STAGED release — a full release takes
    its countries from the track's own setting, which the API cannot write and
    which is picked in the console. So a country flag needs a rollout share too:

        --rollout=0.2            release to 20% of users in those countries

    AND THAT DOES NOT HELP ON A TRACK'S FIRST RELEASE. Play refuses it with
    "The first release on a track cannot be staged". Measured 2026-09-07 on
    production, which held no release and no countries: a full release was
    refused for having no countries, and a staged one for being the first.
    Both roads are shut, so the FIRST production release needs its countries
    picked in the console (Production → Countries / regions) before any of
    these commands can do anything. After that, `put-track production <code>
    completed` creates the release and sends it to review.
                                         # what Play WOULD accept — validates
                                         # and throws the edit away, so nothing
                                         # changes. This is how to find out
                                         # whether the app is still a draft app,
                                         # a state no read endpoint reports.

The key is NOT in the repo and must never be. It is read from
~/.config/masselabs/play-publisher.json, or from the path in PLAY_KEY.
"""
import base64, json, os, subprocess, sys, tempfile, time, urllib.error, urllib.parse, urllib.request

KEY_PATH = os.environ.get("PLAY_KEY", os.path.expanduser("~/.config/masselabs/play-publisher.json"))
PACKAGE = os.environ.get("PLAY_PACKAGE", "com.masselabs.zkproofport")
BASE = "https://androidpublisher.googleapis.com/androidpublisher/v3/applications"


def _b64(raw: bytes) -> bytes:
    return base64.urlsafe_b64encode(raw).rstrip(b"=")


def access_token() -> str:
    if not os.path.exists(KEY_PATH):
        sys.exit(f"No Play key at {KEY_PATH}. Issue one with:\n"
                 f"  gcloud iam service-accounts keys create {KEY_PATH} \\\n"
                 f"    --iam-account=play-publisher@masselabs-zkproofport.iam.gserviceaccount.com \\\n"
                 f"    --project=masselabs-zkproofport")
    sa = json.load(open(KEY_PATH))
    now = int(time.time())
    header = _b64(json.dumps({"alg": "RS256", "typ": "JWT"}).encode())
    claims = _b64(json.dumps({
        "iss": sa["client_email"],
        "scope": "https://www.googleapis.com/auth/androidpublisher",
        "aud": "https://oauth2.googleapis.com/token",
        "iat": now,
        "exp": now + 3600,
    }).encode())
    signing_input = header + b"." + claims

    # openssl rather than google-auth, so the script has no dependency to install
    key_file = data_file = None
    try:
        with tempfile.NamedTemporaryFile(delete=False) as f:
            f.write(sa["private_key"].encode())
            key_file = f.name
        with tempfile.NamedTemporaryFile(delete=False) as f:
            f.write(signing_input)
            data_file = f.name
        done = subprocess.run(["openssl", "dgst", "-sha256", "-sign", key_file, data_file],
                              capture_output=True)
    finally:
        for path in (key_file, data_file):
            if path:
                os.unlink(path)
    if done.returncode != 0 or not done.stdout:
        sys.exit(f"Signing failed: {done.stderr.decode()}")

    jwt = (signing_input + b"." + _b64(done.stdout)).decode()
    body = urllib.parse.urlencode({
        "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
        "assertion": jwt,
    }).encode()
    try:
        return json.load(urllib.request.urlopen("https://oauth2.googleapis.com/token", body))["access_token"]
    except urllib.error.HTTPError as e:
        sys.exit(f"Token request refused: {e.read().decode()}")


def call(token, path, method="GET", body=None, allow_missing=False):
    req = urllib.request.Request(
        f"{BASE}/{PACKAGE}{path}",
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        method=method)
    try:
        raw = urllib.request.urlopen(req).read()
    except urllib.error.HTTPError as e:
        if allow_missing and e.code == 404:
            return None
        sys.exit(f"{method} {path} → {e.code}\n{e.read().decode()}")
    # DELETE answers with an empty body, which is not JSON
    return json.loads(raw) if raw.strip() else {}


def country_targeting(token, edit, spec):
    """The flag value → the release's countryTargeting, or None when unset.

    Read `/countryAvailability/<track>` rather than trusting a memory of what
    the console shows: on 2026-09-07 production answered `{}` while the closed
    test track held 177 countries, and the console's green check mark next to
    "Select countries and regions" belonged to the test track.
    """
    if spec is None:
        return None
    if spec.startswith("from:"):
        source = spec[len("from:"):]
        answer = call(token, f"/edits/{edit}/countryAvailability/{source}")
        codes = [c["countryCode"] for c in answer.get("countries", [])]
        if not codes:
            sys.exit(f"track '{source}' lists no countries, so there is nothing to copy")
        return {"countries": codes, "includeRestOfWorld": False}
    if spec.upper() == "ALL":
        return {"countries": [], "includeRestOfWorld": True}
    codes = [c.strip().upper() for c in spec.split(",") if c.strip()]
    if not codes:
        sys.exit("--countries was given without any country codes")
    return {"countries": codes, "includeRestOfWorld": False}


def staged(release, targeting, rollout):
    """Fold the country list and the rollout share into one release object.

    A share of users makes the release staged, which is the only shape Play
    accepts a country list on: `status: inProgress` plus `userFraction`. Asking
    for countries without a share is refused here rather than by Play, whose
    own wording ("Country targeting is only supported for staged releases")
    does not say what to do about it.
    """
    if rollout is not None:
        if not 0 < rollout < 1:
            sys.exit(f"--rollout must sit between 0 and 1, not {rollout}")
        release["status"] = "inProgress"
        release["userFraction"] = rollout
    if targeting:
        if rollout is None:
            sys.exit("a country list needs --rollout=<share> — Play only takes "
                     "countries on a staged release. For a full release, pick "
                     "the countries in the console instead.")
        release["countryTargeting"] = targeting
    return release


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    # Flags come out first so the positional arguments below sit in the same
    # places whether or not a flag was passed.
    words = [a for a in sys.argv[1:] if not a.startswith("--")]
    countries = None
    rollout = None
    for flag in [a for a in sys.argv[1:] if a.startswith("--")]:
        if flag.startswith("--countries-from="):
            countries = "from:" + flag.split("=", 1)[1]
        elif flag.startswith("--countries="):
            countries = flag.split("=", 1)[1]
        elif flag.startswith("--rollout="):
            rollout = float(flag.split("=", 1)[1])
        else:
            sys.exit(f"unknown flag: {flag}")
    if not words:
        sys.exit(__doc__)
    command = words[0]
    token = access_token()
    edit = call(token, "/edits", method="POST", body={})["id"]

    if command == "tracks":
        # Do NOT use the list endpoint. On this app it answers with an empty
        # array while alpha demonstrably holds a draft release, which reads as
        # "nothing was uploaded" and is wrong. Ask each track by name instead.
        for name in ("internal", "alpha", "beta", "production"):
            answer = call(token, f"/edits/{edit}/tracks/{name}", allow_missing=True)
            if answer is None:
                print(f"{name}: track does not exist")
                continue
            releases = answer.get("releases", [])
            if not releases:
                print(f"{name}: no release")
            for release in releases:
                print(f"{name}: status={release.get('status')} "
                      f"versionCodes={release.get('versionCodes')} name={release.get('name')}")

    elif command == "bundles":
        bundles = call(token, f"/edits/{edit}/bundles").get("bundle", [])
        if not bundles:
            print("Nothing was uploaded inside this edit — which says NOTHING "
                  "about what the app's bundle library holds. This endpoint is "
                  "edit-scoped. To see the library, open Play Console → "
                  "Test and release → App bundle explorer, or the 'Add from "
                  "library' picker on a release screen.")
        for bundle in bundles:
            print(f"versionCode={bundle['versionCode']} sha256={bundle.get('sha256')}")

    elif command == "put-track":
        # scripts/play-api.py put-track internal 39 [draft|completed]
        #
        # THIS REPLACES THE TRACK'S RELEASE LIST WHOLESALE. A release that
        # already carries release notes loses them, because the body below
        # names only versionCodes and status. Seen 2026-09-07: the production
        # release held en-US and ko-KR notes typed in the console, and running
        # this to lift it out of `draft` would have wiped both silently.
        # To promote a draft that has notes, press the button in the console,
        # or read the release first and send it back whole.
        track, version = words[1], words[2]
        status = words[3] if len(words) > 3 else "draft"
        release = staged(
            {"versionCodes": [version], "status": status},
            country_targeting(token, edit, countries), rollout)
        answer = call(token, f"/edits/{edit}/tracks/{track}", method="PUT",
                      body={"releases": [release]})
        call(token, f"/edits/{edit}:commit", method="POST")
        print(f"{track}: {json.dumps(answer.get('releases'), ensure_ascii=False)}")
        return  # the edit is spent by the commit; deleting it would fail

    elif command == "try-track":
        # scripts/play-api.py try-track production 44 completed
        #
        # Asks Play the question WITHOUT changing anything. An edit is a
        # transaction: `:validate` runs the same checks `:commit` does and then
        # throws the edit away, so a refusal comes back as the real error and a
        # pass changes nothing on the console.
        #
        # Written 2026-09-04 to settle "is this app still a draft app?", which
        # the read API does not expose anywhere. The upload lane had been
        # hardcoded to a draft release on the alpha track since 2026-08-30 on
        # the strength of one refusal ("Only releases with status draft may be
        # created on draft app"), and nothing since had re-asked. Guessing at it
        # from the outside is what this replaces.
        track, version = words[1], words[2]
        status = words[3] if len(words) > 3 else "completed"
        release = staged(
            {"versionCodes": [version], "status": status},
            country_targeting(token, edit, countries), rollout)
        call(token, f"/edits/{edit}/tracks/{track}", method="PUT",
             body={"releases": [release]})
        call(token, f"/edits/{edit}:validate", method="POST")
        print(f"Play accepts {track} ← versionCode {version} as '{status}'. "
              f"Nothing was changed — this was a validate, not a commit.")

    elif command == "app-get":
        # scripts/play-api.py app-get /dataSafety
        #
        # For the endpoints that hang off the APPLICATION, not off an edit.
        # Separate command because the edit-scoped `get` silently produces a
        # different URL and Play answers a 404 HTML page rather than an API
        # error, which reads as "the app has none of that" instead of "you
        # asked the wrong place".
        print(json.dumps(call(token, words[1]), indent=2, ensure_ascii=False))

    elif command == "get":
        print(json.dumps(call(token, f"/edits/{edit}{words[1]}"), indent=2, ensure_ascii=False))

    else:
        sys.exit(__doc__)

    call(token, f"/edits/{edit}", method="DELETE")


if __name__ == "__main__":
    main()
