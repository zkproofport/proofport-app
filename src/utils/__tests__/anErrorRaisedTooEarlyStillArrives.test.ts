/**
 * An error raised before the modal exists must still reach a person.
 *
 * `ErrorProvider` wraps the main tree. The loading screen returns before it, so
 * for the first seconds of every launch there is no handler at all — and that is
 * exactly when the circuit downloads fail on a phone with no signal. The old
 * shape wrote a console line and returned, which is indistinguishable from
 * working.
 *
 * The repetition cases matter more than the single one here: the question is
 * not "does one error survive" but "after N of them, does a person see one and
 * learn that there were more".
 */
import {
  registerErrorHandler,
  resetErrorBridge,
  showGlobalError,
} from '../errorBridge';

describe('an error raised before the modal exists still arrives', () => {
  beforeEach(() => resetErrorBridge());

  it('THE DEFECT: an error raised with no handler is delivered when one appears', () => {
    showGlobalError('E3005', 'offline');
    const seen: Array<[string, string | undefined]> = [];
    registerErrorHandler((code, details) => seen.push([code, details]));
    expect(seen).toEqual([['E3005', 'offline']]);
  });

  it('with a handler already there it goes straight through', () => {
    const seen: Array<[string, string | undefined]> = [];
    registerErrorHandler((code, details) => seen.push([code, details]));
    showGlobalError('E3001', 'later');
    expect(seen).toEqual([['E3001', 'later']]);
  });

  it('REPETITION: ten early errors show ONE modal, and say how many more', () => {
    for (let i = 0; i < 10; i += 1) showGlobalError('E3005', `fail ${i}`);
    const seen: Array<[string, string | undefined]> = [];
    registerErrorHandler((code, details) => seen.push([code, details]));
    expect(seen).toHaveLength(1);
    expect(seen[0][0]).toBe('E3005');
    // The first is kept — it is the one that explains the rest.
    expect(seen[0][1]).toContain('fail 0');
    expect(seen[0][1]).toContain('+9 more');
  });

  it('INTEGRITY: registering twice does not replay an error already delivered', () => {
    showGlobalError('E3005', 'once');
    const first: string[] = [];
    registerErrorHandler((code) => first.push(code));
    const second: string[] = [];
    registerErrorHandler((code) => second.push(code));
    expect(first).toEqual(['E3005']);
    expect(second).toEqual([]);
  });

  it('a launch with no error delivers nothing on registration', () => {
    const seen: string[] = [];
    registerErrorHandler((code) => seen.push(code));
    expect(seen).toEqual([]);
  });

  it('REPETITION: twenty clean launches never invent an error', () => {
    let total = 0;
    for (let i = 0; i < 20; i += 1) {
      resetErrorBridge();
      registerErrorHandler(() => {
        total += 1;
      });
    }
    expect(total).toBe(0);
  });

  it('BOUNDARY: an early error with no detail still arrives', () => {
    showGlobalError('E3005');
    const seen: Array<[string, string | undefined]> = [];
    registerErrorHandler((code, details) => seen.push([code, details]));
    expect(seen).toHaveLength(1);
    expect(seen[0][0]).toBe('E3005');
  });

  it('after delivery the bridge is live again for the next error', () => {
    showGlobalError('E3005', 'early');
    const seen: string[] = [];
    registerErrorHandler((code) => seen.push(code));
    showGlobalError('E3001', 'after');
    expect(seen).toEqual(['E3005', 'E3001']);
  });
});
