/**
 * Both native halves of `NativeModules.GoogleIdToken` pass the nonce and the
 * web client id to the provider, are registered, and the library that could
 * not pass a nonce is gone. Read from source: the modules cannot run under
 * jest, and a device run needs a person (checklist in app-dev.md).
 */
import * as fs from 'fs';
import * as path from 'path';

const APP = path.resolve(__dirname, '..', '..', '..');
const read = (...p: string[]) => fs.readFileSync(path.join(APP, ...p), 'utf8');
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const KOTLIN = ['android', 'app', 'src', 'main', 'java', 'com', 'masselabs', 'zkproofport'];

describe('Android GoogleIdTokenModule', () => {
  const src = strip(read(...KOTLIN, 'GoogleIdTokenModule.kt'));

  it('is the GoogleIdToken module and is registered', () => {
    expect(src).toMatch(/override fun getName\(\): String = "GoogleIdToken"/);
    expect(strip(read(...KOTLIN, 'AppEnvPackage.kt'))).toContain('GoogleIdTokenModule(reactContext)');
  });

  it('asks Credential Manager for a Google ID token with the caller nonce and server client id', () => {
    expect(src).toMatch(/GetSignInWithGoogleOption\.Builder\(serverClientId\)\s*\.setNonce\(nonce\)/);
    expect(src).toContain('stringOption(options, "nonce")');
    expect(src).toContain('stringOption(options, "serverClientId")');
  });

  it('rejects with the codes the JS side knows', () => {
    for (const code of ['INVALID_INPUT', 'NO_ACTIVITY', 'IN_PROGRESS', 'CANCELLED', 'NO_CREDENTIAL', 'NO_ID_TOKEN', 'SIGN_IN_FAILED']) {
      expect(src).toContain(`"${code}"`);
    }
  });

  it('depends on the Credential Manager and googleid libraries', () => {
    const gradle = read('android', 'app', 'build.gradle');
    expect(gradle).toContain('implementation("androidx.credentials:credentials:1.6.0")');
    expect(gradle).toContain('implementation("androidx.credentials:credentials-play-services-auth:1.6.0")');
    expect(gradle).toContain('implementation("com.google.android.libraries.identity.googleid:googleid:1.2.0")');
  });
});

describe('iOS GoogleIdTokenModule', () => {
  const src = strip(read('ios', 'ProofportApp', 'GoogleIdTokenModule.m'));

  it('is the GoogleIdToken module and is compiled into the app', () => {
    expect(src).toContain('RCT_EXPORT_MODULE(GoogleIdToken)');
    const pbx = read('ios', 'ProofportApp.xcodeproj', 'project.pbxproj');
    expect(pbx).toMatch(/\/\* GoogleIdTokenModule\.m in Sources \*\/,/);
  });

  it('signs in with the caller nonce, web client id as server client id', () => {
    expect(src).toMatch(/initWithClientID:iosClientId\s+serverClientID:serverClientId/);
    expect(src).toMatch(/additionalScopes:nil\s+nonce:nonce\s+completion:/);
  });

  it('rejects with the codes the JS side knows', () => {
    for (const code of ['INVALID_INPUT', 'NO_ACTIVITY', 'IN_PROGRESS', 'CANCELLED', 'KEYCHAIN', 'NO_ID_TOKEN', 'SIGN_IN_FAILED']) {
      expect(src).toContain(`@"${code}"`);
    }
  });

  it('gets GoogleSignIn 9.1.0 directly, not through the removed library', () => {
    expect(read('ios', 'Podfile')).toMatch(/^\s*pod 'GoogleSignIn', '9\.1\.0'/m);
    const lock = read('ios', 'Podfile.lock');
    expect(lock).toContain('  - GoogleSignIn (9.1.0):');
    expect(lock).not.toContain('RNGoogleSignin');
  });
});

describe('the library that could not pass a nonce', () => {
  it('is not a dependency and nothing in src imports it', () => {
    const pkg = JSON.parse(read('package.json'));
    expect({...pkg.dependencies, ...pkg.devDependencies}).not.toHaveProperty('@react-native-google-signin/google-signin');
    const walk = (dir: string): string[] =>
      fs.readdirSync(dir, {withFileTypes: true}).flatMap(e =>
        e.isDirectory() ? walk(path.join(dir, e.name)) : /\.(ts|tsx)$/.test(e.name) ? [path.join(dir, e.name)] : []);
    const importers = walk(path.join(APP, 'src')).filter(f =>
      /from ['"]@react-native-google-signin|require\(['"]@react-native-google-signin/.test(fs.readFileSync(f, 'utf8')));
    expect(importers).toEqual([]);
  });

  it('Microsoft no longer sends Math.random() as its nonce', () => {
    const ms = strip(read('src', 'hooks', 'useMicrosoftAuth.ts'));
    expect(ms).not.toMatch(/Math\.random/);
    expect(ms).toMatch(/extraParams:\s*\{\s*nonce,/);
  });
});
