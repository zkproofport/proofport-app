/**
 * Every Play API path we send is one Google actually serves.
 *
 * Two paths were written from memory tonight and both 404'd:
 *
 *   Abandoning an edit was sent as `POST .../edits/{id}:delete`. The real call
 *   is a plain `DELETE .../edits/{id}`. It failed AFTER the check had already
 *   printed its answer, so the run went red while reporting success one line
 *   above.
 *
 *   Screenshots were sent to `.../edits/{id}/images/{language}/{type}`. There
 *   is no `images` collection: they live under `listings`, and delete, list and
 *   upload all use `.../edits/{id}/listings/{language}/{type}`. Google answers
 *   the wrong path with an HTML 404 page rather than a JSON API error — that
 *   HTML is the tell that the path itself is not an API route.
 *
 *   The list path being wrong was the worse half: the check reported "no
 *   images" for an app whose images had never been asked about, and that
 *   reading was passed on as fact.
 *
 * Verified against developers.google.com/android-publisher/api-ref/rest/v3 on
 * 2026-08-30 (edits.images deleteall / list / upload).
 */
import fs from 'node:fs';
import path from 'node:path';

const repo = path.join(__dirname, '..', '..');
const uploader = fs.readFileSync(path.join(repo, 'android', 'play', 'upload-listing.py'), 'utf8');
const check = fs.readFileSync(
  path.join(repo, '.github', 'workflows', 'check-play-access.yml'), 'utf8');

/** Everything that talks to Play, so a new caller cannot be forgotten here. */
const callers: Array<[string, string]> = [
  ['the listing uploader', uploader],
  ['the read-only access check', check],
];

describe('the Play paths are the documented ones', () => {
  it.each(callers)('%s puts images under listings, never an images collection', (_name, src) => {
    // `images/{something}/{something}` as a PATH segment. The word appears in
    // prose and in variable names, so match the shape of a URL, not the word.
    expect(src).not.toMatch(/\/images\/\{[^}]+\}\/\{[^}]+\}/);
    expect(src).not.toMatch(/["'`]images\/\{[^}]+\}\/\{[^}]+\}/);
  });

  it.each(callers)('%s asks for listings/{language}/{imageType} somewhere', (_name, src) => {
    // The positive half: without it the check above passes on a file that
    // simply stopped touching images at all.
    expect(src).toMatch(/listings\/\{?[a-zA-Z_.'"\[\]()]*(language|row)[^}]*\}?\/\{?[a-zA-Z_]*image_type/);
  });

  it.each(callers)('%s abandons an edit with DELETE, not a :delete suffix', (_name, src) => {
    // Comment lines are dropped first. The note explaining why the suffix is
    // wrong contains the suffix, and a check that forbade the string outright
    // would make the explanation unwritable — which is how a guard ends up
    // deleted rather than obeyed.
    const code = src
      .split('\n')
      .filter((line) => !/^\s*(#|\/\/|\*)/.test(line))
      .join('\n');
    expect(code).not.toContain(':delete');
    expect(code).toMatch(/'DELETE'|method='DELETE'|method="DELETE"/);
  });

  it('the uploader uses the separate upload host for sending bytes', () => {
    // Media goes to /upload/androidpublisher/..., metadata to the plain host.
    // Sending bytes to the plain host fails in a way that reads like a
    // permission problem.
    expect(uploader).toMatch(/upload\/androidpublisher\/v3\/applications/);
    expect(uploader).toMatch(/uploadType=media/);
  });
});
