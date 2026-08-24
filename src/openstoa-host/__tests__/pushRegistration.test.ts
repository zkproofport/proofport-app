/**
 * OpenStoa push REGISTRATION diagnostics + control flow.
 *
 * The defect under test is not a wrong answer, it is SILENCE: `registerForPush`
 * used to return `null` from five places and swallow every throw without one log
 * line, so "this device never registered" and "this device registered fine and
 * nothing was sent to it" produced byte-identical evidence. These tests pin that
 * every exit names itself exactly once, and that adding the naming did not move
 * any of the exits.
 *
 * Edge-case matrix rows covered here:
 *   authz      — granted / provisional / denied / undetermined, plus a
 *                permission that was already gone before we prompted
 *   boundary   — no token, EMPTY token string, a 1-char token, a huge token
 *   empty/null — readHandle returning null vs '' (both mint), as SEPARATE cases
 *   hostile    — a thrown Error, a thrown string, a thrown null, and an error
 *                message full of UTF-8 / control chars, none of which may throw
 *                out of the function or lose the diagnostic
 *   large      — a 4 KB token is never logged whole (only prefix + length)
 *   race       — permission granted on the FIRST read must not re-prompt
 *   contract   — EXACTLY ONE diagnostic per call; the greppable prefix and
 *                `outcome=` marker; `null` on every non-success; writeHandle
 *                called only when a handle is actually minted
 *   integrity  — the outcome named in the log matches the branch actually taken
 *   ext-failure— a console that throws cannot fail a registration
 */
import {
  PUSH_LOG_PREFIX,
  registerForPushWithDeps,
  reportPushRegistration,
  type PushRegistrationDeps,
} from '../pushRegistration';

const PROVISIONAL = 3; // Notifications.IosAuthorizationStatus.PROVISIONAL

interface Spies {
  log: jest.SpyInstance;
  warn: jest.SpyInstance;
}
let spies: Spies;

function freshSpies(): void {
  jest.restoreAllMocks();
  spies = {
    log: jest.spyOn(console, 'log').mockImplementation(() => {}),
    warn: jest.spyOn(console, 'warn').mockImplementation(() => {}),
  };
}

beforeEach(freshSpies);
afterEach(() => {
  jest.restoreAllMocks();
});

/** Every diagnostic line emitted, whatever level it went out at. */
function lines(): string[] {
  return [...spies.log.mock.calls, ...spies.warn.mock.calls].map((c) => String(c[0]));
}
/** The structured detail of the single diagnostic emitted. */
function detail(): Record<string, unknown> {
  const calls = [...spies.log.mock.calls, ...spies.warn.mock.calls];
  expect(calls).toHaveLength(1);
  return calls[0][1] as Record<string, unknown>;
}
/** The one `outcome=` value logged. Fails if zero or more than one line went out. */
function outcome(): string {
  const all = lines();
  expect(all).toHaveLength(1);
  expect(all[0]).toContain(PUSH_LOG_PREFIX);
  const m = /outcome=([a-z-]+)/.exec(all[0]);
  expect(m).not.toBeNull();
  return (m as RegExpExecArray)[1];
}

const handleStore: { value: string | null } = { value: null };

function deps(over: Partial<PushRegistrationDeps> = {}): PushRegistrationDeps {
  handleStore.value = null;
  return {
    isDevice: true,
    getPermissions: async () => ({ granted: true, status: 'granted' }),
    requestPermissions: async () => ({ granted: true, status: 'granted' }),
    provisionalIosStatus: PROVISIONAL,
    projectId: 'proj-123',
    getExpoPushToken: async () => ({ data: 'ExponentPushToken[abcdefghijklmnop]' }),
    readHandle: async () => handleStore.value,
    writeHandle: async (h: string) => {
      handleStore.value = h;
    },
    newUuid: () => '11111111-2222-4333-8444-555555555555',
    platform: 'ios',
    ...over,
  };
}

describe('a non-device: iOS skips, Android tries anyway', () => {
  /*
   * THE CORRECTION, and why it is worth a block of its own.
   *
   * This used to return `skipped-no-device` for anything `expo-device` calls a
   * non-device, on the stated grounds that "a real APNs/FCM token only exists on
   * a physical device". That holds for APNs — an iOS simulator has no APNs
   * registration to give — and does not hold for FCM: an Android emulator with
   * Google Play services mints an ordinary registration token.
   *
   * Verified, not reasoned about. On a Play-enabled Android 16 emulator the
   * real flow produced `outcome=registered` with a 142-byte raw FCM token —
   * the same length the physical device registers — and a push sent to it
   * arrived and was dismissed by room.
   *
   * The old guard had a real cost: per-room dismissal could only be exercised
   * on physical hardware, so an unreachable phone stopped the work outright.
   * And nothing downstream needed it — the token paths already end in
   * `skipped-empty-token` when nothing comes back, which is the honest answer
   * for a simulator without having to predict in advance which devices can
   * mint one.
   */
  it('ANDROID: an emulator that CAN mint a token registers', async () => {
    const out = await registerForPushWithDeps(
      deps({
        isDevice: false,
        platform: 'android',
        getDevicePushToken: async () => ({ data: 'd'.repeat(142) }),
      }),
    );
    expect(out?.pushToken).toBe('d'.repeat(142));
    expect(outcome()).toBe('registered');
  });

  it('ANDROID: an emulator that cannot mint one ends as empty-token, not as no-device', async () => {
    // The honest outcome for a simulator: it was asked, and it had nothing.
    const out = await registerForPushWithDeps(
      deps({
        isDevice: false,
        platform: 'android',
        getDevicePushToken: async () => ({ data: '' }),
        getExpoPushToken: async () => ({ data: '' }) as never,
      }),
    );
    expect(out).toBeNull();
    expect(outcome()).toBe('skipped-empty-token');
  });

  it('iOS: a simulator still skips before asking — there is no APNs registration to get', async () => {
    const getPermissions = jest.fn(async () => ({ granted: true, status: 'granted' }));
    const out = await registerForPushWithDeps(deps({ isDevice: false, platform: 'ios', getPermissions }));
    expect(out).toBeNull();
    expect(outcome()).toBe('skipped-no-device');
    // Skipped EARLY: a simulator must not be prompted for a permission that
    // cannot lead anywhere.
    expect(getPermissions).not.toHaveBeenCalled();
  });

  it('a real device is unaffected on both platforms', async () => {
    const out = await registerForPushWithDeps(
      deps({ isDevice: true, platform: 'android', getDevicePushToken: async () => ({ data: 'raw-fcm' }) }),
    );
    expect(out?.pushToken).toBe('raw-fcm');
    expect(outcome()).toBe('registered');
  });
});

describe('registerForPushWithDeps — the happy path still works', () => {
  it('returns the registration and logs outcome=registered exactly once', async () => {
    const out = await registerForPushWithDeps(deps());
    expect(out).toEqual({
      routingHandle: '11111111-2222-4333-8444-555555555555',
      pushToken: 'ExponentPushToken[abcdefghijklmnop]',
      platform: 'ios',
    });
    expect(outcome()).toBe('registered');
    // Success goes to log, not warn, so a warnings-only filter shows problems.
    expect(spies.log).toHaveBeenCalledTimes(1);
    expect(spies.warn).not.toHaveBeenCalled();
    expect(detail()).toMatchObject({ minted: true, platform: 'ios' });
  });

  it('reuses a persisted handle and reports minted=false (handle churn is visible)', async () => {
    const writeHandle = jest.fn();
    const out = await registerForPushWithDeps(
      deps({ readHandle: async () => 'existing-handle', writeHandle }),
    );
    expect(out?.routingHandle).toBe('existing-handle');
    expect(writeHandle).not.toHaveBeenCalled(); // contract: no needless rotation
    expect(detail().minted).toBe(false);
  });

  it('empty/null are SEPARATE stored-handle cases and BOTH mint', async () => {
    for (const stored of [null, '']) {
      freshSpies();
      const writeHandle = jest.fn();
      const out = await registerForPushWithDeps(
        deps({ readHandle: async () => stored as string | null, writeHandle }),
      );
      expect(out?.routingHandle).toBe('11111111-2222-4333-8444-555555555555');
      expect(writeHandle).toHaveBeenCalledTimes(1);
      expect(detail().minted).toBe(true);
    }
  });

  it('LARGE: a 4 KB token is summarised, never logged whole', async () => {
    const huge = `ExponentPushToken[${'x'.repeat(4096)}]`;
    await registerForPushWithDeps(deps({ getExpoPushToken: async () => ({ data: huge }) }));
    const d = detail();
    expect(d.tokenLength).toBe(huge.length);
    expect(String(d.tokenPrefix).length).toBeLessThanOrEqual(18);
    expect(JSON.stringify(d).length).toBeLessThan(400);
  });

  it('boundary: a 1-character token is still a valid registration', async () => {
    const out = await registerForPushWithDeps(
      deps({ getExpoPushToken: async () => ({ data: 'x' }) }),
    );
    expect(out?.pushToken).toBe('x');
    expect(outcome()).toBe('registered');
  });

  it('carries the android platform through unchanged', async () => {
    const out = await registerForPushWithDeps(deps({ platform: 'android' }));
    expect(out?.platform).toBe('android');
    expect(detail().platform).toBe('android');
  });
});

describe('registerForPushWithDeps — every silent exit now names itself', () => {
  it('simulator: outcome=skipped-no-device', async () => {
    const getPermissions = jest.fn();
    expect(await registerForPushWithDeps(deps({ isDevice: false, getPermissions }))).toBeNull();
    expect(outcome()).toBe('skipped-no-device');
    // Control flow unchanged: it still short-circuits before touching the OS.
    expect(getPermissions).not.toHaveBeenCalled();
  });

  it('AUTHZ declined at the prompt: outcome=skipped-permission-denied, prompted=true', async () => {
    const out = await registerForPushWithDeps(
      deps({
        getPermissions: async () => ({ granted: false, status: 'undetermined' }),
        requestPermissions: async () => ({ granted: false, status: 'denied' }),
      }),
    );
    expect(out).toBeNull();
    expect(outcome()).toBe('skipped-permission-denied');
    expect(detail()).toMatchObject({ prompted: true, status: 'denied' });
  });

  it('AUTHZ revoked in Settings reports the OS status that names it', async () => {
    // Same exit as a fresh decline, but the fix differs (deep link to Settings
    // vs. show a rationale), so the log must carry enough to tell them apart.
    await registerForPushWithDeps(
      deps({
        getPermissions: async () => ({ granted: false, status: 'denied' }),
        requestPermissions: async () => ({ granted: false, status: 'denied' }),
      }),
    );
    expect(detail()).toMatchObject({ status: 'denied' });
  });

  it('AUTHZ provisional counts as granted (quiet delivery is still delivery)', async () => {
    const out = await registerForPushWithDeps(
      deps({
        getPermissions: async () => ({ granted: false, ios: { status: PROVISIONAL } }),
      }),
    );
    expect(out).not.toBeNull();
    expect(outcome()).toBe('registered');
  });

  it('AUTHZ an expo-notifications with no PROVISIONAL enum does not mis-grant', async () => {
    const out = await registerForPushWithDeps(
      deps({
        provisionalIosStatus: undefined,
        getPermissions: async () => ({ granted: false, ios: { status: PROVISIONAL } }),
        requestPermissions: async () => ({ granted: false, ios: { status: PROVISIONAL } }),
      }),
    );
    expect(out).toBeNull();
    expect(outcome()).toBe('skipped-permission-denied');
  });

  it('RACE: already-granted must NOT re-prompt the user', async () => {
    const requestPermissions = jest.fn(async () => ({ granted: true }));
    await registerForPushWithDeps(deps({ requestPermissions }));
    expect(requestPermissions).not.toHaveBeenCalled();
    expect(detail().prompted).toBeUndefined(); // success detail has no prompt field
  });

  it('no EAS projectId: outcome=skipped-no-project-id', async () => {
    const getExpoPushToken = jest.fn();
    expect(
      await registerForPushWithDeps(deps({ projectId: undefined, getExpoPushToken })),
    ).toBeNull();
    expect(outcome()).toBe('skipped-no-project-id');
    expect(getExpoPushToken).not.toHaveBeenCalled();
  });

  it('boundary: an EMPTY token string is a skip, not a registration', async () => {
    expect(
      await registerForPushWithDeps(deps({ getExpoPushToken: async () => ({ data: '' }) })),
    ).toBeNull();
    expect(outcome()).toBe('skipped-empty-token');
  });

  it('boundary: a response with no `data` at all is the same skip', async () => {
    expect(await registerForPushWithDeps(deps({ getExpoPushToken: async () => ({}) }))).toBeNull();
    expect(outcome()).toBe('skipped-empty-token');
  });
});

describe('registerForPushWithDeps — thrown failures are reported, not swallowed', () => {
  it('THE REGRESSION: an Expo credential rejection now surfaces in the log', async () => {
    // ERR_NOTIFICATIONS_SERVER_ERROR is what Expo raises when the project's APNs
    // key is missing/revoked. Nothing on the server can see it, so this line is
    // the ONLY artefact that can ever name it.
    const err = new Error('Expo push notification credentials are not set up');
    err.name = 'ERR_NOTIFICATIONS_SERVER_ERROR';
    const out = await registerForPushWithDeps(
      deps({
        getExpoPushToken: async () => {
          throw err;
        },
      }),
    );
    expect(out).toBeNull();
    expect(outcome()).toBe('failed');
    expect(String(detail().error)).toContain('ERR_NOTIFICATIONS_SERVER_ERROR');
    expect(String(detail().error)).toContain('credentials are not set up');
  });

  it('a throw from ANY dependency is reported, and never propagates', async () => {
    const boom = async (): Promise<never> => {
      throw new Error('native module missing');
    };
    const cases: Array<Partial<PushRegistrationDeps>> = [
      { getPermissions: boom },
      { requestPermissions: boom, getPermissions: async () => ({ granted: false }) },
      { getExpoPushToken: boom },
      { readHandle: boom },
      { writeHandle: boom },
    ];
    for (const over of cases) {
      freshSpies();
      await expect(registerForPushWithDeps(deps(over))).resolves.toBeNull();
      expect(outcome()).toBe('failed');
    }
  });

  it('HOSTILE: a thrown non-Error (string, null, object, UTF-8/control chars) still reports', async () => {
    const thrownValues: unknown[] = [
      'plain string failure',
      null,
      { code: 'weird' },
      new Error('실패 \u{1f525} [31m\t '),
    ];
    for (const thrown of thrownValues) {
      freshSpies();
      await expect(
        registerForPushWithDeps(
          deps({
            getExpoPushToken: async () => {
              throw thrown;
            },
          }),
        ),
      ).resolves.toBeNull();
      expect(outcome()).toBe('failed');
      expect(detail().error).toBeDefined();
    }
  });
});

describe('reportPushRegistration — the diagnostic itself', () => {
  it('EXTERNAL FAILURE: a console that throws cannot break a registration', async () => {
    jest.restoreAllMocks();
    const explode = (): never => {
      throw new Error('console is gone');
    };
    jest.spyOn(console, 'log').mockImplementation(explode);
    jest.spyOn(console, 'warn').mockImplementation(explode);
    // Success path and failure path both keep their result.
    await expect(registerForPushWithDeps(deps())).resolves.not.toBeNull();
    await expect(registerForPushWithDeps(deps({ isDevice: false }))).resolves.toBeNull();
    expect(() => reportPushRegistration('failed')).not.toThrow();
  });

  it('every line is greppable by one prefix and carries outcome=', () => {
    reportPushRegistration('skipped-no-device');
    reportPushRegistration('failed', { error: 'x' });
    expect(spies.warn.mock.calls).toHaveLength(2);
    for (const call of spies.warn.mock.calls) {
      expect(String(call[0])).toMatch(/^\[openstoa-push] registerForPush outcome=[a-z-]+$/);
    }
    expect(PUSH_LOG_PREFIX).toBe('[openstoa-push]');
  });
});
