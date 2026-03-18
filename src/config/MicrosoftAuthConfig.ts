/**
 * Microsoft Entra ID (Azure AD) OIDC configuration for domain attestation.
 *
 * Uses react-native-app-auth with Authorization Code + PKCE flow.
 * Returns raw id_token (JWT) with tid, email, xms_edov claims.
 *
 * Azure AD App Registration:
 * - Tenant: hyuki0130gmail.onmicrosoft.com
 * - Token configuration: optional claims email + xms_edov enabled
 * - Authentication: ID tokens implicit flow enabled
 *
 * For production: register a new Azure AD app with mobile redirect URI
 * and update CLIENT_ID + REDIRECT_URI below.
 */

export const MICROSOFT_CLIENT_ID = 'cd5404cc-d313-431c-8112-725e629dad28';

/**
 * Redirect URI for react-native-app-auth.
 * Must match the redirect URI registered in Azure AD App Registration.
 * Format: msauth.{bundleId}://auth
 */
export const MICROSOFT_REDIRECT_URI = 'msalcd5404cc-d313-431c-8112-725e629dad28://auth';

/**
 * Microsoft Entra ID v2.0 OIDC endpoints.
 * Using 'organizations' authority to support any organizational tenant
 * while excluding personal Microsoft accounts (which cause unauthorized_client).
 * The app validates tid at runtime to ensure organizational account.
 */
export const MICROSOFT_AUTHORITY = 'https://login.microsoftonline.com/organizations';
export const MICROSOFT_ISSUER = `${MICROSOFT_AUTHORITY}/v2.0`;
