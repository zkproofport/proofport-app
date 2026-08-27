/**
 * Signing out has to reach the server, or the session never ends.
 *
 * THE DEFECT THIS CLOSES, found from a phone that could not open its own chat.
 * `logoutFromOpenStoa` cleared the token from AsyncStorage and stopped there.
 * The record stayed live in Redis, so the NEXT sign-in found it through
 * `liveDeviceSessions`, classified it as another device, and showed
 * "This will sign out your other phone" — naming a phone that does not exist and
 * warning that the chat keys went with it. Every logout/login cycle added one
 * more ghost.
 *
 * `/api/auth/logout` existed the whole time and revokes correctly. Nobody called
 * it. That is the shape worth remembering: not a wrong implementation, an
 * unreferenced one.
 *
 * WHY A SOURCE SCAN. `zkProofportHostApi.ts` pulls in React Native transitively
 * and cannot be imported under jest — the two neighbouring tests in this
 * directory are source scans for the same reason. So this asks the questions a
 * scan can answer honestly, and the CUMULATIVE question — three cycles leave one
 * live session — is asked where it can actually be run, against the real store,
 * in `openstoa/src/__tests__/logoutLeavesNoGhostSession.test.ts`.
 *
 * EDGE-CASE MATRIX (CLAUDE.md) → coverage
 *   contract  → the logout path calls `/api/auth/logout`
 *   contract  → it sends the Bearer, or the route cannot know whose session to end
 *   integrity → the call comes BEFORE the local clear, while the token is readable
 *   integrity → it goes through `fetchWithDeadline`, so a hung socket cannot
 *               prevent someone from signing out
 *   race      → the failure is swallowed, so an offline logout still signs out
 *   N/A       → boundary / hostile / UTF-8 / large: no user input on this path
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const HOST = readFileSync(join(dirname(__dirname), 'zkProofportHostApi.ts'), 'utf8');

/**
 * The body of `logoutFromOpenStoa` with COMMENTS REMOVED.
 *
 * Stripping them is not tidiness, it is the difference between a guard and a
 * decoration. The first version of this file scanned the raw text, and when the
 * server call was deleted outright, two cases still passed — they had matched
 * the words `/api/auth/logout` inside the comment that explains why the call is
 * there. A test that a comment can satisfy proves nothing about the code, which
 * is precisely the failure mode that let this defect ship.
 *
 * Caught by mutation, not by reading. Worth stating.
 */
function logoutBody(): string {
  const start = HOST.indexOf('logoutFromOpenStoa: async () => {');
  expect(start).toBeGreaterThan(-1);
  // Up to the next top-level member of the same object literal.
  const end = HOST.indexOf('\n    },', start);
  expect(end).toBeGreaterThan(start);
  return HOST.slice(start, end)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

describe('logout ends the session on the server, not only on the phone', () => {
  const body = logoutBody();

  it('CONTRACT: it calls /api/auth/logout', () => {
    expect(body).toContain('/api/auth/logout');
  });

  it('CONTRACT: it sends the Bearer, or the route cannot know whose session to end', () => {
    expect(body).toMatch(/Authorization:\s*`Bearer \$\{token\}`/);
    expect(body).toMatch(/method:\s*'POST'/);
  });

  it('INTEGRITY: the server call comes BEFORE the local clear', () => {
    /*
     * The ordering IS the fix. `clearAuth` removes the token, and the route
     * authenticates with it — reversed, the call goes out unauthenticated and
     * the session survives exactly as it did before.
     */
    const call = body.indexOf('/api/auth/logout');
    const clear = body.indexOf('clearAuth()');
    expect(call).toBeGreaterThan(-1);
    expect(clear).toBeGreaterThan(-1);
    expect(call).toBeLessThan(clear);
  });

  it('INTEGRITY: a hung socket must not be able to prevent signing out', () => {
    // Bare `fetch` has no deadline. A logout that waits forever is a person who
    // cannot leave — worse than the ghost session this removes.
    expect(body).toContain('fetchWithDeadline(');
    expect(body).not.toMatch(/[^h]\bfetch\(/);
  });

  it('RACE: the failure is swallowed, so an offline logout still signs out', () => {
    expect(body).toMatch(/catch\s*\{/);
    // And the local clear is outside that try, not inside it.
    const catchAt = body.indexOf('catch {');
    expect(body.indexOf('clearAuth()')).toBeGreaterThan(catchAt);
  });
});

/**
 * SIGNING OUT HAS TO STOP THE NOTIFICATIONS TOO.
 *
 * The same shape as the defect above, found the same way — by reading what the
 * logout actually does. It ended the session and left the push registration
 * behind. That row is keyed on (account, routing handle) and the fan-out finds
 * it by the ACCOUNT, so a phone whose owner had signed out kept being pinged
 * about new messages in every topic that account still belonged to.
 *
 * Nothing readable leaks — the payload is `OpenStoa` / `New message` and a
 * topic id, content-free by design. What leaks is that the account is active,
 * on a phone somebody said they were finished with. On a shared or handed-on
 * phone that is another person's activity appearing.
 *
 * Deleting is only possible from the client: `/api/push/register` scopes the
 * delete to the caller's own session, and the logout route does not touch the
 * table. So the ordering is the whole fix, exactly as above.
 *
 * EDGE-CASE MATRIX (CLAUDE.md) → coverage
 *   contract  → the logout path calls DELETE on `/api/push/register`
 *   contract  → it passes the routing handle, or the route has nothing to delete
 *   integrity → it runs BEFORE the session is revoked, while the Bearer works
 *   integrity → the handle is NOT deleted locally, so the next sign-in reuses it
 *   race      → the failure is swallowed; a dead network must not block signing out
 *   empty     → no handle means nothing was ever registered, so nothing is called
 */
describe('logout also stops the push notifications', () => {
  const body = logoutBody();

  it('CONTRACT: it deletes the push registration', () => {
    expect(body).toContain('/api/push/register');
    expect(body).toMatch(/method:\s*'DELETE'/);
  });

  it('CONTRACT: it names the routing handle, or the route deletes nothing', () => {
    expect(body).toMatch(/routingHandle=\$\{encodeURIComponent\(handle\)\}/);
    expect(body).toContain('PUSH_HANDLE_KEY');
  });

  it('INTEGRITY: it runs BEFORE the session is revoked', () => {
    /*
     * THE ORDERING IS THE FIX, twice over. The delete authenticates with the
     * Bearer and scopes itself to that session's account; run it after
     * `/api/auth/logout` and the session is already gone, so the row survives
     * exactly as it did before — a change that looks right and does nothing.
     */
    const unregister = body.indexOf('/api/push/register');
    const revoke = body.indexOf('/api/auth/logout');
    const clear = body.indexOf('clearAuth()');
    expect(unregister).toBeGreaterThan(-1);
    expect(unregister).toBeLessThan(revoke);
    expect(unregister).toBeLessThan(clear);
  });

  it('INTEGRITY: the handle itself is kept — it names the install, not the account', () => {
    /*
     * Deleting it would mint a new one on the next sign-in and leave a second
     * row that nothing ever cleans up. One install, one handle, for as long as
     * the app is installed.
     */
    expect(body).not.toMatch(/removeItem\(\s*PUSH_HANDLE_KEY/);
  });

  it('RACE: a dead network must not block signing out', () => {
    /*
     * BETWEEN the two calls, not merely somewhere after the first. The initial
     * version of this looked for a `catch` anywhere below the unregister and
     * kept passing when the unregister's own try/catch was deleted — it was
     * matching the LOGOUT's catch, further down. Caught by mutation.
     */
    const unregister = body.indexOf('/api/push/register');
    const revoke = body.indexOf('/api/auth/logout');
    expect(unregister).toBeGreaterThan(-1);
    expect(revoke).toBeGreaterThan(unregister);
    expect(body.slice(unregister, revoke)).toMatch(/catch\s*\{/);
    // And both later steps still happen.
    expect(body.slice(revoke)).toContain('clearAuth()');
  });

  it('EMPTY: with no handle stored it calls nothing, because nothing was registered', () => {
    expect(body).toMatch(/if\s*\(handle\)/);
  });

  it('INTEGRITY: it uses the deadline wrapper, like every other call here', () => {
    const unregister = body.indexOf('/api/push/register');
    const before = body.slice(Math.max(0, unregister - 200), unregister);
    expect(before).toContain('fetchWithDeadline(');
  });
});
