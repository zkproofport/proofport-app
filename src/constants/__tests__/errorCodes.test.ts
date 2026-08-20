/**
 * Every code the OpenStoa mini-app can raise has a modal to show.
 *
 * The mini-app is a separate package. It reaches the host through
 * `HostApi.showError(code: string, …)`, so nothing in the type system connects
 * the codes it passes to the registry that gives them a title and a
 * description. Six codes had drifted out of that registry entirely — E9000,
 * E9001, E9003, E9004, E9005, E9006 — and because `createAppError` spread
 * `ErrorCodes[code]` blindly, `undefined` spread to nothing and the modal
 * opened with no text at all. Combined with the host's `showError` being a
 * `console.warn` at the time, a failed profile write produced complete silence
 * on a real device.
 *
 * The scan below is the part a person cannot forget to run: it reads the
 * mini-app's source for the codes it actually passes, so adding a call site
 * without a registry entry fails here rather than on someone's phone.
 *
 * EDGE-CASE MATRIX (CLAUDE.md) → coverage here
 *   contract   → every code raised by the mini-app is registered
 *   integrity  → each entry's `code` field matches its key, and no entry is
 *                blank (a registered-but-empty entry is the same defect)
 *   hostile    → an unregistered code still yields a titled modal, and keeps
 *                the original code in the details so it stays diagnosable
 *   empty      → an unregistered code with no details still has a title
 *   boundary   → the scan finds at least one code, so a broken regex cannot
 *                make this pass by matching nothing
 *   authz / UTF-8 / very large / race → N/A: a static registry with no caller
 *                identity, no free-text input and no async state.
 */
import {readdirSync, readFileSync, statSync} from 'fs';
import {join} from 'path';
import {ErrorCodes, createAppError} from '../errorCodes';

const MINI_APP_SRC = join(__dirname, '../../../../openstoa/packages/mobile/src');

/**
 * Every error-code literal the mini-app contains.
 *
 * Deliberately looks for the LITERAL rather than for `showError('EXXXX'`. The
 * call sites moved behind a `reportFailure(host, e, 'E9006')` helper while this
 * test was being written, and a scan pinned to the old call shape silently
 * found nothing — which is why the count is asserted below before the contents
 * are. A code the mini-app mentions at all is a code it can raise.
 */
function codesRaisedByMiniApp(): string[] {
  const found = new Set<string>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry === '__tests__' || entry === 'node_modules') continue;
        walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(entry)) continue;
      const src = readFileSync(full, 'utf8');
      for (const m of src.matchAll(/'(E\d{4})'/g)) found.add(m[1]);
    }
  };
  walk(MINI_APP_SRC);
  return [...found].sort();
}

describe('error code registry', () => {
  it('CONTRACT: every code the mini-app raises is registered here', () => {
    const raised = codesRaisedByMiniApp();

    // Guard the guard: a regex that matched nothing would make this vacuous.
    expect(raised.length).toBeGreaterThan(0);

    const missing = raised.filter(code => !(code in ErrorCodes));
    expect(missing).toEqual([]);
  });

  it('CONTRACT: the shared network code the mini-app falls back to is registered', () => {
    // `api/failure.ts` names this one directly rather than at a `showError`
    // call site, so the scan above cannot see it.
    expect(ErrorCodes).toHaveProperty('E9998');
    expect(ErrorCodes).toHaveProperty('E9999');
  });

  it('INTEGRITY: no entry is blank, and each carries its own key as its code', () => {
    for (const [key, entry] of Object.entries(ErrorCodes)) {
      expect(entry.code).toBe(key);
      expect(entry.title.trim().length).toBeGreaterThan(0);
      expect(entry.description.trim().length).toBeGreaterThan(0);
    }
  });

  it('HOSTILE: an unregistered code still produces a modal with words in it', () => {
    const error = createAppError('E7777', 'something happened');

    expect(error.title.trim()).not.toBe('');
    expect(error.description.trim()).not.toBe('');
    // The code that was actually raised must survive into the details, or the
    // fallback would hide which call site failed.
    expect(error.details).toContain('E7777');
    expect(error.details).toContain('something happened');
  });

  it('EMPTY: an unregistered code with no details is still titled', () => {
    const error = createAppError('E7777');

    expect(error.title.trim()).not.toBe('');
    expect(error.details).toBe('E7777');
  });

  it('a registered code keeps its own copy and its details verbatim', () => {
    const error = createAppError('E9003', 'That name is reserved.');

    expect(error.code).toBe('E9003');
    expect(error.title).toBe(ErrorCodes.E9003.title);
    expect(error.details).toBe('That name is reserved.');
  });
});
