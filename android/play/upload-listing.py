#!/usr/bin/env python3
"""Upload the Play store listing text. No build, no release, no track.

Why this is not `fastlane supply`
---------------------------------
supply cannot upload listing text for an app that has no release. Its
`perform_upload_meta` fetches a track release before it will write any
listing, and errors out with

    Could not find release for version code '' to update changelog

when the track has none — which is the state of every app that has never had
a build uploaded, including this one. `skip_upload_changelogs: true` does not
help: the guard around that block is an OR across four skip flags, so leaving
metadata enabled is enough to enter it, and the release lookup inside is
unconditional.

Worse, the loop it happens in is only reached by accident. supply 2.238.0 has

    version_codes = version_codes.reject do |version_code|
      version_codes.to_s == ""      # the ARRAY, not the element
    end

which never rejects anything. Fix that typo and the array of one empty version
code becomes empty, the `each` body never runs, and the listing is silently not
uploaded at all. Either way there is no version of supply that writes a listing
for a release-less app, so the listing talks to the Play API directly.

The API is a three-step edit session: open an edit, write each localized
listing into it, then commit (or validate and throw it away, for a dry run).
No track and no release are involved at any point, which is the whole reason
this path works where supply does not.

Screenshots go up the same way. They are not part of a Listing resource --
each one is a separate media upload into the SAME edit
(`edits/{id}/listings/{language}/{imageType}`), so they commit together with the
text and a dry run throws both away as one. Still no track, release, bundle or
apk anywhere.

Length limits are deliberately NOT enforced here. Neither the Android Publisher
reference nor supply states them, and a guard built on a half-remembered number
would reject good text or pass bad. Play itself is the authority: over-long
text is rejected by the API, and the character counts printed below plus the
read-back at the end show what actually landed.
"""

import base64
import json
import os
import struct
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

API = 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications'
# Media uploads go through a different host path than the JSON API. Same
# edit id, same session -- only the prefix differs.
UPLOAD_API = 'https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications'

# The three files that make up one localized listing. `video` is a fourth
# Listing field but there is no promo video, and sending an empty string for it
# is not the same as leaving it alone.
FIELDS = {
    'title': 'title.txt',
    'shortDescription': 'short_description.txt',
    'fullDescription': 'full_description.txt',
}


# Images live where `fastlane supply` puts them, so the tree is readable to
# anyone who has seen an Android metadata folder before:
#
#   <metadata>/<language>/images/phoneScreenshots/01_verify.png
#   <metadata>/<language>/images/icon.png
#   <metadata>/<language>/images/featureGraphic.png
#
# For the multi-image kinds the FOLDER name is the Play imageType; for the
# single-image kinds one file is named after the type. Both names are taken
# verbatim from the AppImageType enum, so a typo here is a 400 from Play rather
# than a silent no-op.
MULTI_IMAGE_TYPES = (
    'phoneScreenshots',
    'sevenInchScreenshots',
    'tenInchScreenshots',
    'tvScreenshots',
    'wearScreenshots',
)
SINGLE_IMAGE_TYPES = ('icon', 'featureGraphic', 'tvBanner')

# Play accepts JPEG and PNG. The suffix decides the Content-Type because the
# media upload has no other way to say what it is sending.
IMAGE_SUFFIXES = {'.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg'}


def die(message):
    print(f'::error::{message}')
    sys.exit(1)


def read_listings(metadata_path):
    """Read every language folder, or refuse to run.

    Every failure here is one that would otherwise reach Play as a successful
    upload of the wrong thing: a missing file drops a field, and a file holding
    only whitespace blanks the store page while reporting success.
    """
    if not os.path.isdir(metadata_path):
        die(f'No metadata folder at {metadata_path}')

    languages = sorted(
        name for name in os.listdir(metadata_path)
        if not name.startswith('.') and os.path.isdir(os.path.join(metadata_path, name))
    )
    if not languages:
        die(f'No language folders under {metadata_path}')

    listings = {}
    for language in languages:
        listing = {'language': language}
        for field, filename in FIELDS.items():
            path = os.path.join(metadata_path, language, filename)
            if not os.path.isfile(path):
                die(f'{language}: {filename} is missing. Play needs all of '
                    f'{", ".join(sorted(FIELDS.values()))}.')
            try:
                text = open(path, encoding='utf-8').read()
            except UnicodeDecodeError as e:
                die(f'{language}: {filename} is not valid UTF-8 ({e}).')
            # Trailing newlines are an artefact of editing a text file, not
            # content — Play would keep them. Whitespace-only means the file
            # exists but says nothing, which must not upload as an empty page.
            text = text.strip()
            if not text:
                die(f'{language}: {filename} is empty. Uploading it would blank '
                    f'that field on the live store page.')
            listing[field] = text
        listings[language] = listing

    print('About to send:')
    for language, listing in listings.items():
        for field in FIELDS:
            # len() over decoded text, so Korean counts as characters and not
            # as the three bytes each of them takes in UTF-8.
            print(f'  {language:6} {field:16} {len(listing[field]):5} chars')
    return listings


def png_size(path):
    """(width, height) from a PNG header, or None for anything else.

    Printed next to each file so the run itself shows whether the asset is the
    shape Play wants, instead of that being something a reader has to take on
    trust. Play remains the authority on what it will accept -- nothing here
    rejects a file for its dimensions.
    """
    with open(path, 'rb') as f:
        head = f.read(24)
    if head[:8] != b'\x89PNG\r\n\x1a\n':
        return None
    width, height = struct.unpack('>II', head[16:24])
    return width, height


def read_images(metadata_path, languages):
    """Collect the image files for each language.

    A type with no local files is LEFT ALONE on Play -- absence here means "not
    managed from this repo", never "delete what is up there". Only a type that
    is present locally is replaced, and it is replaced wholesale, because Play
    appends on upload and a second run would otherwise double the screenshots.
    """
    images = {}
    for language in languages:
        root = os.path.join(metadata_path, language, 'images')
        if not os.path.isdir(root):
            continue
        found = {}

        for image_type in MULTI_IMAGE_TYPES:
            folder = os.path.join(root, image_type)
            if not os.path.isdir(folder):
                continue
            files = sorted(
                os.path.join(folder, name) for name in os.listdir(folder)
                if os.path.splitext(name)[1].lower() in IMAGE_SUFFIXES
            )
            if not files:
                # An empty folder is a mistake, not an instruction. Uploading
                # nothing after clearing the type would wipe the screenshots.
                die(f'{language}: {image_type}/ exists but holds no PNG or JPEG. '
                    f'Remove the folder to leave Play alone, or put the images in it.')
            found[image_type] = files

        for image_type in SINGLE_IMAGE_TYPES:
            matches = [
                os.path.join(root, image_type + suffix) for suffix in IMAGE_SUFFIXES
                if os.path.isfile(os.path.join(root, image_type + suffix))
            ]
            if len(matches) > 1:
                die(f'{language}: {image_type} is there more than once '
                    f'({", ".join(os.path.basename(m) for m in matches)}). '
                    f'Which one is meant cannot be guessed.')
            if matches:
                found[image_type] = matches

        if found:
            images[language] = found

    if not images:
        print('\nNo images/ folder under any language — the text goes up alone '
              'and whatever images Play holds stay as they are.')
        return images

    print('\nImages to send (each type is replaced wholesale):')
    for language, by_type in images.items():
        for image_type, files in by_type.items():
            for path in files:
                size = png_size(path)
                shape = f'{size[0]}x{size[1]}' if size else 'jpeg'
                print(f'  {language:6} {image_type:20} {os.path.basename(path):20} '
                      f'{shape:>10} {os.path.getsize(path):8} bytes')
    return images


# Contact details, kept beside the listing because they are part of the same
# edit and the same submission checklist. Play requires an email before a first
# release; the website is optional but it is the same one the App Store already
# shows, so leaving it empty would make the two stores disagree.
#
# The PHONE NUMBER is deliberately absent. Play publishes whatever is put here
# on the store page, it is not required, and whose number goes on a public page
# is not a decision this script gets to make.
CONTACT = {
    'contactEmail': 'support@masselabs.com',
    'contactWebsite': 'https://zkproofport.app',
}


def send_contact(token, edits, edit_id):
    """Merge the contact fields into the app details, leaving the rest alone."""
    # PATCH, not PUT: a PUT replaces the whole details resource, and the one
    # field this script must never touch — defaultLanguage — lives in it.
    # Sending a partial PUT would blank it.
    current = call(token, 'GET', f'{edits}/{edit_id}/details') or {}
    missing = {k: v for k, v in CONTACT.items() if not current.get(k)}
    if not missing:
        print('contact details: already set, left alone')
        return
    call(token, 'PATCH', f'{edits}/{edit_id}/details', missing)
    print('contact details set:', ', '.join(sorted(missing)))


def send_images(token, edits, edit_id, language, by_type):
    """Clear each managed type, then upload its files in name order."""
    for image_type, files in by_type.items():
        # Images live UNDER `listings`, not under an `images` collection —
        # `edits/{id}/listings/{language}/{imageType}` for delete, list and
        # upload alike. The `images/...` form was written from memory and is
        # not an API path at all: Google answers it with an HTML 404 page
        # rather than a JSON API error, which is the tell. Verified against
        # developers.google.com/android-publisher/api-ref/rest/v3/edits.images
        # on 2026-08-30 for deleteall, list and upload.
        target = f'{edits}/{edit_id}/listings/{language}/{image_type}'
        try:
            call(token, 'DELETE', target)
        except urllib.error.HTTPError as e:
            die(f'{language}: Play refused to clear {image_type} ({e.code}): {api_error(e)}')
        for path in files:
            content_type = IMAGE_SUFFIXES[os.path.splitext(path)[1].lower()]
            upload = (f'{UPLOAD_API}/{os.environ["PACKAGE_NAME"]}/edits/{edit_id}'
                      f'/listings/{language}/{image_type}?uploadType=media')
            request = urllib.request.Request(
                upload, data=open(path, 'rb').read(), method='POST',
                headers={'Authorization': f'Bearer {token}', 'Content-Type': content_type})
            try:
                with urllib.request.urlopen(request) as response:
                    response.read()
            except urllib.error.HTTPError as e:
                die(f'{language}: Play rejected {os.path.basename(path)} as '
                    f'{image_type} ({e.code}): {api_error(e)}')
            print(f'  sent  {language} {image_type}/{os.path.basename(path)}')


def access_token(key):
    """Sign a JWT with the service-account key and trade it for a token."""
    def b64(raw):
        return base64.urlsafe_b64encode(raw).decode().rstrip('=')

    now = int(time.time())
    header = b64(json.dumps({'alg': 'RS256', 'typ': 'JWT'}).encode())
    claims = b64(json.dumps({
        'iss': key['client_email'],
        'scope': 'https://www.googleapis.com/auth/androidpublisher',
        'aud': 'https://oauth2.googleapis.com/token',
        'iat': now, 'exp': now + 3600,
    }).encode())
    with open('/tmp/play-pk.pem', 'w') as pem:
        pem.write(key['private_key'])
    signature = subprocess.run(
        ['openssl', 'dgst', '-sha256', '-sign', '/tmp/play-pk.pem'],
        input=f'{header}.{claims}'.encode(), capture_output=True, check=True).stdout
    assertion = f'{header}.{claims}.{b64(signature)}'

    body = urllib.parse.urlencode({
        'grant_type': 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        'assertion': assertion,
    }).encode()
    try:
        with urllib.request.urlopen(urllib.request.Request(
                'https://oauth2.googleapis.com/token', data=body)) as response:
            return json.load(response)['access_token']
    except urllib.error.HTTPError as e:
        print(e.read().decode('utf-8', 'replace')[:400])
        die('Could not exchange the key for a token — the key is wrong or revoked.')


def call(token, method, url, body=None):
    data = json.dumps(body).encode() if body is not None else None
    headers = {'Authorization': f'Bearer {token}'}
    if data is not None:
        headers['Content-Type'] = 'application/json'
    request = urllib.request.Request(url, data=data, method=method, headers=headers)
    with urllib.request.urlopen(request) as response:
        raw = response.read()
    return json.loads(raw) if raw else {}


def api_error(e):
    detail = e.read().decode('utf-8', 'replace')
    try:
        return json.loads(detail)['error']['message']
    except Exception:
        return detail[:600]


def main():
    package = os.environ['PACKAGE_NAME']
    metadata_path = os.environ['METADATA_PATH']
    dry_run = os.environ.get('DRY_RUN', 'true') == 'true'

    raw_key = os.environ.get('PLAY_SERVICE_ACCOUNT_JSON', '').strip()
    if not raw_key:
        die('PLAY_SERVICE_ACCOUNT_JSON is not set in this repository.')
    try:
        key = json.loads(raw_key)
    except json.JSONDecodeError as e:
        die(f'PLAY_SERVICE_ACCOUNT_JSON is not valid JSON ({e}).')

    # Read and check the text BEFORE opening an edit, so a bad file cannot
    # leave a half-written session on the app.
    listings = read_listings(metadata_path)
    images = read_images(metadata_path, list(listings))

    print(f'\nservice account: {key["client_email"]}')
    print(f'package:         {package}')
    print(f'mode:            {"dry run — validate and discard" if dry_run else "REAL — commit to Play"}')

    token = access_token(key)
    edits = f'{API}/{package}/edits'

    try:
        edit = call(token, 'POST', edits, {})
    except urllib.error.HTTPError as e:
        message = api_error(e)
        print(f'::error::Play refused to open an edit ({e.code}): {message}')
        if e.code == 404:
            print('::error::Either the app does not exist in Play Console, or this '
                  'service account cannot see it. Google returns 404 for both.')
        sys.exit(1)

    edit_id = edit['id']
    print(f'\nedit session {edit_id} opened')

    committed = False
    try:
        for language, listing in listings.items():
            try:
                call(token, 'PUT', f'{edits}/{edit_id}/listings/{language}', listing)
            except urllib.error.HTTPError as e:
                die(f'{language}: Play rejected the listing ({e.code}): {api_error(e)}')
            print(f'  wrote {language}')
            if language in images:
                send_images(token, edits, edit_id, language, images[language])

        send_contact(token, edits, edit_id)

        if dry_run:
            try:
                call(token, 'POST', f'{edits}/{edit_id}:validate')
            except urllib.error.HTTPError as e:
                die(f'Play rejected the edit on validate ({e.code}): {api_error(e)}')
            print('\nvalidated. Nothing was committed — this was a dry run.')
        else:
            # Commit plainly first. An app that cannot send changes for review
            # automatically answers with a message naming the parameter it
            # wants; both strings below are the ones fastlane 2.238.0 matches on
            # in supply/lib/supply/client.rb, not invented ones.
            try:
                call(token, 'POST', f'{edits}/{edit_id}:commit')
            except urllib.error.HTTPError as e:
                message = api_error(e)
                if 'changesNotSentForReview to true' in message:
                    print('Play asked for changesNotSentForReview=true — retrying.')
                    call(token, 'POST',
                         f'{edits}/{edit_id}:commit?changesNotSentForReview=true')
                else:
                    die(f'Play rejected the commit ({e.code}): {message}')
            committed = True
            print('\ncommitted to Play.')
    finally:
        # Abandon the session unless it was committed — a committed edit no
        # longer exists to delete, and an abandoned one leaves the app clean
        # for the next run whatever went wrong above.
        if not committed:
            try:
                call(token, 'DELETE', f'{edits}/{edit_id}')
                print('edit session abandoned — nothing was changed')
            except Exception as e:
                print(f'::warning::could not abandon the edit session ({e}). '
                      'Nothing was committed; the session expires on its own.')

    # Read Play back rather than trusting the calls above. A fresh edit is used
    # because the one written to is gone by now either way.
    print('\nWhat Play holds now:')
    try:
        check = call(token, 'POST', edits, {})
        rows = (call(token, 'GET', f'{edits}/{check["id"]}/listings') or {}).get('listings') or []
        print(f'  listings present: {len(rows)}')
        for row in sorted(rows, key=lambda r: r.get('language') or ''):
            print(f'  {row.get("language")}: title={row.get("title")!r}, '
                  f'short={len(row.get("shortDescription") or "")} chars, '
                  f'full={len(row.get("fullDescription") or "")} chars')
            # Ask per type: Play has no "list every image" call, and a count of
            # zero here is the difference between "the upload worked" and "the
            # upload said it worked".
            for image_type in MULTI_IMAGE_TYPES + SINGLE_IMAGE_TYPES:
                shots = (call(token, 'GET',
                              f'{edits}/{check["id"]}/listings/{row.get("language")}/{image_type}')
                         or {}).get('images') or []
                if shots:
                    print(f'      {image_type}: {len(shots)}')
        call(token, 'DELETE', f'{edits}/{check["id"]}')
    except Exception as e:
        # Never fail the run on the read-back: the upload above already
        # succeeded or exited, and a broken report must not be readable as a
        # broken upload.
        print(f'::warning::could not read the listings back ({e}).')


if __name__ == '__main__':
    main()
