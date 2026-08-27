/**
 * A finished sign-in puts the person back in OpenStoa.
 *
 * THE DEFECT, reported on iOS and reproduced on Android on 2026-08-27. Signing
 * in from the mini-app deep-links the app to its OWN proof screen, which lives
 * on the Verify tab. When the proof finished the person stayed there and had to
 * find the OpenStoa tab by hand — every single time.
 *
 * WHY IT WAS INVISIBLE. The code to return already existed:
 *
 *     const nav = getNavigation();
 *     try { nav?.navigate('OpenStoaTab'); } catch { }
 *
 * `getNavigation` is published by `OpenStoaRootScreen`, so it exists only while
 * the OpenStoa tab is MOUNTED — and the tab is lazy, so at that exact moment it
 * is not. `nav` was null, the optional chain did nothing, and because nothing
 * threw, the `catch` never ran either. A silent no-op that reads like a working
 * feature. `pushTapBridge` had already learned this for notification taps and
 * says so in its own comment; the sign-in path had never been moved over.
 *
 * NOT `returnScheme`, and the distinction is the reason this file says so out
 * loud: `returnScheme` names another APP to bring forward, is implemented, and
 * is documented in the SDK README for external integrators. OpenStoa is a tab in
 * this same binary — asking the OS to open our own scheme is a no-op on iOS and
 * selects no tab regardless.
 *
 * EDGE-CASE MATRIX (CLAUDE.md) → coverage
 *   contract  → the jump uses the HOST navigator, which exists while the
 *               mini-app is unmounted
 *   contract  → it reports whether it actually jumped, so a caller can tell
 *               "done" from "no navigator"
 *   boundary  → before any navigator is published it answers false, not a throw
 *   failure   → a navigator that throws is reported, never propagated: the
 *               sign-in has already succeeded
 *   race      → N sign-ins in a row each jump; the handle is not consumed
 *   integrity → the sign-in path calls the BRIDGE, not `getNavigation()` — the
 *               regression that produced this file
 */
import {
  __resetPushTapBridge,
  jumpToOpenStoaTab,
  setOpenStoaTabNavigation,
  type HostTabNavigation,
} from '../pushTapBridge';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

function navigator(onNavigate?: (route: string) => void): HostTabNavigation {
  return {
    navigate: ((route: string) => {
      onNavigate?.(route);
    }) as HostTabNavigation['navigate'],
  } as HostTabNavigation;
}

describe('returning to OpenStoa after a sign-in', () => {
  beforeEach(() => {
    __resetPushTapBridge();
  });

  it('BOUNDARY: with no navigator published it answers false rather than throwing', () => {
    /*
     * The state the old code was actually in. It must be DISTINGUISHABLE from
     * success — that is the whole point of returning a boolean — because a
     * silent no-op is exactly how this shipped.
     */
    expect(jumpToOpenStoaTab()).toBe(false);
  });

  it('CONTRACT: with the host navigator published it navigates to OpenStoaTab', () => {
    const seen: string[] = [];
    setOpenStoaTabNavigation(navigator((r) => seen.push(r)));

    expect(jumpToOpenStoaTab()).toBe(true);
    expect(seen).toEqual(['OpenStoaTab']);
  });

  it('CONTRACT: the handle comes from the HOST, so it works with the mini-app unmounted', () => {
    /*
     * The mini-app is never involved here — nothing in this test mounts it, and
     * the jump still lands. That is the difference from `getNavigation()`, which
     * only existed while the OpenStoa tab was on screen: the one moment it is
     * needed is the moment it was absent.
     */
    const seen: string[] = [];
    setOpenStoaTabNavigation(navigator((r) => seen.push(r)));
    expect(jumpToOpenStoaTab()).toBe(true);
    expect(seen).toHaveLength(1);
  });

  it('RACE: five sign-ins in a row each return to the tab', () => {
    /*
     * The accumulating axis. A single jump proves the call is wired; it does not
     * prove the handle survives being used — a latch or a one-shot consume would
     * pass the first case and strand every sign-in after it, which on a phone
     * reads as "it works sometimes".
     */
    const seen: string[] = [];
    setOpenStoaTabNavigation(navigator((r) => seen.push(r)));

    const results = [0, 1, 2, 3, 4].map(() => jumpToOpenStoaTab());

    expect(results).toEqual([true, true, true, true, true]);
    expect(seen).toEqual(Array(5).fill('OpenStoaTab'));
  });

  it('FAILURE: a navigator that throws is reported, not propagated', () => {
    /*
     * The caller is a sign-in that has ALREADY succeeded and written a token.
     * Letting a mid-transition navigation error escape would turn a completed
     * sign-in into a failed one.
     */
    setOpenStoaTabNavigation(
      navigator(() => {
        throw new Error('navigator is mid-transition');
      }),
    );

    expect(() => jumpToOpenStoaTab()).not.toThrow();
    expect(jumpToOpenStoaTab()).toBe(false);
  });

  it('INTEGRITY: a later navigator replaces an earlier one', () => {
    // The host navigator republishes on every screen listener call. The most
    // recent one is the live one; holding the first would go stale on a remount.
    const first: string[] = [];
    const second: string[] = [];
    setOpenStoaTabNavigation(navigator((r) => first.push(r)));
    setOpenStoaTabNavigation(navigator((r) => second.push(r)));

    jumpToOpenStoaTab();

    expect(first).toEqual([]);
    expect(second).toEqual(['OpenStoaTab']);
  });

  it('INTEGRITY: the sign-in path calls the bridge, not the mini-app handle', () => {
    /*
     * THE REGRESSION GUARD, and the only case that would catch a revert.
     *
     * Comments are stripped before anything is matched. This file's own prose
     * quotes `getNavigation()` several times, and so does the source it reads —
     * a scan that saw comments would fail against correct code, which is exactly
     * how two other source scans in this repo misbehaved on 2026-08-26.
     */
    const raw = readFileSync(join(dirname(__dirname), 'zkProofportHostApi.ts'), 'utf8');
    const code = raw
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

    /*
     * EVERY branch that writes a session, not just the proof one. Writing this
     * test found that `dev-login` had no return at all — a second way to sign in
     * that left the person somewhere else, which is how "it works on my build"
     * happens.
     *
     * `removeItem(LOGGED_OUT_KEY)` marks a completed sign-in — and `clearAuth`'s
     * mirror image, which is why the setter is excluded below rather than by a
     * narrower search string.
     *
     * NOT EVERY OCCURRENCE. `setOpenStoaToken` is a SETTER the mini-app calls
     * when it already holds a token, from inside OpenStoa. Jumping there would
     * move somebody who is already where the jump would take them. Only the two
     * branches the HOST drives — `dev-login` and the proof poll — return.
     */
    const marks: number[] = [];
    for (let at = code.indexOf('removeItem(LOGGED_OUT_KEY)'); at !== -1; ) {
      marks.push(at);
      at = code.indexOf('removeItem(LOGGED_OUT_KEY)', at + 1);
    }
    // If this reads fewer than three the scan has drifted and the assertions
    // below are checking less than they claim.
    expect(marks.length).toBeGreaterThanOrEqual(3);

    const driven = marks.filter((at) => {
      // The setter is the one whose enclosing function is `setOpenStoaToken`.
      const before = code.slice(Math.max(0, at - 400), at);
      return !before.includes('setOpenStoaToken');
    });
    expect(driven).toHaveLength(2);

    for (const at of driven) {
      const window = code.slice(at, at + 700);
      expect(window).toContain('jumpToOpenStoaTab()');
      expect(window).not.toContain('getNavigation()');
    }
  });
});
