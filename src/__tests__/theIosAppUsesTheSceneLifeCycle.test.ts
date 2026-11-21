/**
 * The iOS app must start through a scene, not through the app delegate.
 *
 * An app built with the iOS 27 SDK is stopped at launch on iOS 27 unless it
 * adopts the UIScene life cycle; the crash report names
 * `_UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption`. The KProof
 * app hit it on 2026-11-10 the first time it was built with Xcode 27. Builds
 * made with Xcode 26 run fine, so nothing shows until the first build on the
 * new Xcode reaches a phone on iOS 27.
 *
 * The fix has three parts that only work together: the scene manifest in
 * Info.plist, a SceneDelegate that creates the window and starts React Native,
 * and links arriving through the scene reaching the same handlers as before.
 *
 * This package runs jest, which takes no message argument on `expect`. Each
 * failure has to be readable from the test name alone.
 */
import fs from 'node:fs';
import path from 'node:path';

const iosDir = path.join(__dirname, '..', '..', 'ios', 'ProofportApp');
const plist = fs.readFileSync(path.join(iosDir, 'Info.plist'), 'utf8');
const delegate = fs.readFileSync(path.join(iosDir, 'AppDelegate.swift'), 'utf8');

const sceneDelegateBody = () => {
  const start = delegate.indexOf('class SceneDelegate');
  const end = delegate.indexOf('class ReactNativeDelegate');
  return start >= 0 && end > start ? delegate.slice(start, end) : '';
};
const appDelegateBody = () => {
  const start = delegate.indexOf('class AppDelegate');
  const end = delegate.indexOf('class SceneDelegate');
  return start >= 0 && end > start ? delegate.slice(start, end) : '';
};

describe('the iOS app uses the scene life cycle', () => {
  it('Info.plist declares one application scene backed by SceneDelegate', () => {
    expect(plist).toMatch(/<key>UIApplicationSceneManifest<\/key>/);
    expect(plist).toMatch(/<key>UIApplicationSupportsMultipleScenes<\/key>\s*<false\/>/);
    expect(plist).toMatch(/<key>UISceneDelegateClassName<\/key>\s*<string>\$\(PRODUCT_MODULE_NAME\)\.SceneDelegate<\/string>/);
  });

  it('SceneDelegate creates the window from the scene and starts React Native in it', () => {
    const body = sceneDelegateBody();
    expect(body).toMatch(/UIWindow\(windowScene:/);
    expect(body).toMatch(/startReactNative\(\s*withModuleName: "ZKProofport"/);
    expect(body).toMatch(/appDelegate\.window = window/);
  });

  it('the app delegate no longer creates a window or starts React Native itself', () => {
    const body = appDelegateBody();
    expect(body).not.toBe('');
    expect(body).not.toMatch(/UIWindow\(frame:/);
    expect(body).not.toMatch(/startReactNative\(/);
  });

  it('a cold-start link reaches Linking.getInitialURL, for both the URL scheme and universal links', () => {
    const body = sceneDelegateBody();
    expect(body).toMatch(/connectionOptions\.urlContexts/);
    expect(body).toMatch(/launchOptions\[\.url\]/);
    expect(body).toMatch(/connectionOptions\.userActivities/);
    expect(body).toMatch(/launchOptions\[\.userActivityDictionary\]/);
  });

  it('links that arrive while running go to the app delegate handlers', () => {
    const body = sceneDelegateBody();
    expect(body).toMatch(/openURLContexts[\s\S]*appDelegate\.application\(UIApplication\.shared, open:/);
    expect(body).toMatch(/continue userActivity[\s\S]*appDelegate\.application\(UIApplication\.shared, continue:/);
  });
});
