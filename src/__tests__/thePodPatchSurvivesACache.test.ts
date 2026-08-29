/**
 * The Podfile's header patch must survive a restored Pods cache.
 *
 * The app is built with Xcode 26, whose clang rejects the `consteval` path in
 * fmt 11.0.2. The Podfile works around it by rewriting one line of
 * `fmt/include/fmt/base.h` after `pod install`. That worked on the run that
 * populated the CI cache, and then killed the very next release build:
 *
 *     [!] An error occurred while processing the post-install hook of the Podfile.
 *     Permission denied @ rb_sysopen - .../ios/Pods/fmt/include/fmt/base.h
 *
 * A file that comes back from the cache can be read-only. The message points at
 * CocoaPods and says nothing about file modes, and the build dies ninety seconds
 * in — before anything that looks like a real build step.
 *
 * This package runs jest, which takes no message argument on `expect`. Each
 * failure has to be readable from the test name alone.
 */
import fs from 'node:fs';
import path from 'node:path';

const podfile = fs.readFileSync(
  path.join(__dirname, '..', '..', 'ios', 'Podfile'),
  'utf8',
);

describe('the Xcode 26 header patch cannot be blocked by a file mode', () => {
  it('the patch still exists', () => {
    // If fmt or Xcode ever stops needing it, this whole file should go with it —
    // failing here is the reminder to check rather than to restore blindly.
    expect(podfile).toMatch(/fmt\/include\/fmt\/base\.h/);
    expect(podfile).toMatch(/FMT_USE_CONSTEVAL/);
  });

  it('makes the header writable before writing to it', () => {
    expect(podfile).toMatch(/File\.chmod\([^)]*fmt_header\)/);
  });

  it('the chmod comes before the write, not after', () => {
    const chmod = podfile.indexOf('File.chmod');
    const write = podfile.indexOf('File.write(fmt_header');
    expect(chmod).toBeGreaterThan(-1);
    expect(write).toBeGreaterThan(-1);
    expect(chmod).toBeLessThan(write);
  });

  it('only rewrites when the content actually differs', () => {
    // Running on every `pod install` is intended; rewriting an already-patched
    // file every time would churn the cache and hide whether it worked.
    expect(podfile).toMatch(/if content != patched/);
  });
});
