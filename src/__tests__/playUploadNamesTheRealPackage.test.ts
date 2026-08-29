/**
 * The Play upload must name the package it actually built.
 *
 * On 2026-08-29 it did not. The Android upload lane worked out the package name
 * to hand to Play from an `APP_ID_SUFFIX` environment variable, falling back to
 * appending `.staging` for the staging flavor. Both branches were wrong:
 *
 *   - nothing applied a suffix to the build. `app/build.gradle` sets one
 *     `applicationId` and no `applicationIdSuffix` anywhere, and says so in a
 *     comment: every flavor ships as `com.masselabs.zkproofport`, one Play
 *     listing, one Google OAuth client. So the variable changed only what
 *     fastlane SAID, never what was built.
 *   - the release workflow set the variable the wrong way round —
 *     `inputs.environment == 'production' && '.staging' || ''` — so choosing
 *     production sent `.staging` and choosing staging sent nothing.
 *
 * The first real upload would have been told about a listing that does not
 * exist. Nothing had ever run it, because the Play service-account credential
 * is still missing, so the mistake sat there unseen.
 *
 * These tests read the release files as text. That is deliberate: the defect
 * lived in the agreement BETWEEN three files, and no amount of testing any one
 * of them in isolation would have found it.
 *
 * This package runs jest, which takes no message argument on `expect`. Each
 * failure has to be readable from the test name alone.
 */
import fs from 'node:fs';
import path from 'node:path';

const repo = path.join(__dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(repo, rel), 'utf8');

const GRADLE = 'android/app/build.gradle';
const FASTFILE = 'android/fastlane/Fastfile';
const RELEASE_WORKFLOW = '.github/workflows/release-app.yml';

/** Strips whole-line `#` and `//` comments so prose cannot satisfy a check. */
const withoutComments = (body: string) => body.replace(/^[ \t]*(#|\/\/).*$/gm, '');

describe('the Android release names one package, everywhere', () => {
  it('build.gradle declares exactly one applicationId', () => {
    const ids = [...read(GRADLE).matchAll(/^\s*applicationId\s+"([^"]+)"/gm)].map((m) => m[1]);
    expect(ids).toEqual(['com.masselabs.zkproofport']);
  });

  it('build.gradle applies no suffix, so every flavor is the same package', () => {
    // If a suffix is ever introduced, the upload lane has to learn to follow it,
    // and the next test — which compares the two — is what will say so.
    expect(withoutComments(read(GRADLE))).not.toMatch(/applicationIdSuffix/);
  });

  it('the upload lane hands Play exactly the applicationId that was built', () => {
    const appId = read(GRADLE).match(/^\s*applicationId\s+"([^"]+)"/m)?.[1];
    const pkg = read(FASTFILE).match(/^\s*pkg\s*=\s*"([^"]+)"/m)?.[1];
    expect(appId).toBeTruthy();
    expect(pkg).toBe(appId);
  });

  it('no .staging package name survives in build.gradle, the lane, or the workflow', () => {
    for (const file of [GRADLE, FASTFILE, RELEASE_WORKFLOW]) {
      expect(withoutComments(read(file))).not.toMatch(/com\.masselabs\.zkproofport\.staging/);
    }
  });

  it('the suffix variable is gone from both the lane and the workflow', () => {
    expect(withoutComments(read(FASTFILE))).not.toMatch(/APP_ID_SUFFIX/);
    expect(withoutComments(read(RELEASE_WORKFLOW))).not.toMatch(/APP_ID_SUFFIX/);
  });
});

describe('the upload still refuses to skip quietly', () => {
  it('keeps the branch that reports a missing Play credential out loud', () => {
    /*
     * Guarding an earlier fix in the same file: both upload lanes used to fall
     * off the end when no credential was present, printing nothing and exiting
     * 0, so a green run meant nothing had been uploaded.
     */
    const fastfile = read(FASTFILE);
    expect(/elsif credential\('SUPPLY_JSON_KEY'\)[\s\S]*?\belse\b/.test(fastfile)).toBe(true);
    expect(fastfile).toMatch(/NO CREDENTIAL/i);
  });

  it('treats a credential set to nothing as not set', () => {
    /*
     * GitHub Actions writes an empty string for a secret that does not exist,
     * and an empty string is truthy in Ruby. Branching on the bare variable
     * would walk into the upload with no credential and fail somewhere far from
     * the cause, instead of taking the branch above that says what is missing.
     */
    for (const file of [FASTFILE, 'ios/fastlane/Fastfile']) {
      const body = withoutComments(read(file));
      expect(body).toMatch(/def credential\(name\)/);
      // No decision about a credential may read the raw variable.
      expect(body).not.toMatch(
        /(if|elsif|\?)\s*ENV\['(ASC_[A-Z_]+|MATCH_PASSWORD|GOOGLE_APPLICATION_CREDENTIALS|SUPPLY_JSON_KEY)'\]/,
      );
    }
  });
});

describe('the release workflow can actually reach Play', () => {
  /*
   * Found 2026-08-29. The lane knew how to upload and refused loudly without a
   * credential — but no workflow ever gave it one. Neither the release workflow
   * nor the staging beta workflow put a Play variable in the lane's environment,
   * so every run took the "nothing was uploaded" branch by construction. The
   * missing piece was described as "a secret nobody created"; it was also a
   * wire nobody ran.
   *
   * And the wire has a shape. `json_key` is a path on disk, `json_key_data` is
   * the JSON itself, and fastlane treats them as conflicting options. A CI
   * secret holds the JSON itself, so handing it to the path-shaped variable
   * fails with a file-not-found deep inside the upload tool.
   */
  const aabStep = () => {
    const body = read(RELEASE_WORKFLOW);
    const start = body.indexOf('- name: Build AAB');
    expect(start).toBeGreaterThan(-1);
    const next = body.indexOf('\n      - name:', start + 1);
    return body.slice(start, next === -1 ? undefined : next);
  };

  it('hands the AAB step a Play credential from a repository secret', () => {
    expect(aabStep()).toMatch(/SUPPLY_JSON_KEY_DATA:\s*\$\{\{\s*secrets\.[A-Z0-9_]+\s*\}\}/);
  });

  it('passes the JSON itself, never the path-shaped variable, from CI', () => {
    // A GitHub secret cannot be a path. If this ever flips to the path form the
    // upload fails with a file-not-found that names nothing useful.
    const step = aabStep();
    expect(step).not.toMatch(/GOOGLE_APPLICATION_CREDENTIALS:\s*\$\{\{\s*secrets\./);
    expect(step).not.toMatch(/SUPPLY_JSON_KEY:\s*\$\{\{\s*secrets\./);
  });

  it('the lane reads that variable and forwards it as the content option', () => {
    const fastfile = withoutComments(read(FASTFILE));
    expect(fastfile).toMatch(/credential\('SUPPLY_JSON_KEY_DATA'\)/);
    expect(fastfile).toMatch(/json_key_data:\s*credential\('SUPPLY_JSON_KEY_DATA'\)/);
  });

  it('never passes the path and the content options in the same upload call', () => {
    // fastlane declares json_key and json_key_data as conflicting options, so a
    // call carrying both aborts before it reaches Play.
    //
    // The calls are found by counting brackets, not by looking for a closing
    // bracket on its own line. The line-shaped version broke the moment a lane
    // was written with its call on ONE line: the search ran past the end of it
    // and swallowed the next two calls as well, so three separate branches —
    // each passing exactly one credential — read as a single call passing
    // both. A guard that depends on how the code is laid out is a guard that
    // reports on formatting.
    const src = read(FASTFILE);
    const calls: string[] = [];
    for (let i = src.indexOf('supply('); i !== -1; i = src.indexOf('supply(', i + 1)) {
      let depth = 0;
      let j = i + 'supply'.length;
      for (; j < src.length; j++) {
        if (src[j] === '(') depth++;
        else if (src[j] === ')') {
          depth--;
          if (depth === 0) break;
        }
      }
      calls.push(src.slice(i, j + 1));
    }

    // If the scan found nothing, every check below would pass vacuously.
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(/json_key:/.test(call) && /json_key_data:/.test(call)).toBe(false);
    }
  });
});
