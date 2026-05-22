/**
 * Google OAuth configuration for OIDC domain attestation.
 *
 * Uses @react-native-google-signin/google-signin with native platform sign-in.
 * Only webClientId is needed — no client_secret, no redirect URI.
 *
 * webClientId must be a "Web application" type OAuth 2.0 Client ID from Google Cloud Console.
 * This is what causes Google to include id_token (JWT) in the sign-in response.
 */
export const GOOGLE_WEB_CLIENT_ID = '491923400813-5bb3up7dhejns2unvbrt6mku520hrr5g.apps.googleusercontent.com';
export const GOOGLE_IOS_CLIENT_ID = '491923400813-ei78mtmkjppvueb577lqai14e4jvbmqk.apps.googleusercontent.com';
