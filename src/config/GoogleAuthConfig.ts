/**
 * Google OAuth configuration for OIDC domain attestation.
 *
 * Used by the app's own native sign-in (src/oidc/googleIdToken.ts): Credential
 * Manager on Android, GoogleSignIn 9 on iOS. No client_secret, no redirect URI.
 *
 * GOOGLE_WEB_CLIENT_ID must be a "Web application" OAuth 2.0 client. Both
 * platforms pass it as the server client id, so it should be the ID token's
 * `aud` (to be confirmed on a real token: device checklist in app-dev.md).
 * GOOGLE_IOS_CLIENT_ID is the iOS client GoogleSignIn signs in as; its reversed
 * form is the URL scheme in Info.plist.
 */
export const GOOGLE_WEB_CLIENT_ID = '491923400813-5bb3up7dhejns2unvbrt6mku520hrr5g.apps.googleusercontent.com';
export const GOOGLE_IOS_CLIENT_ID = '491923400813-ei78mtmkjppvueb577lqai14e4jvbmqk.apps.googleusercontent.com';
