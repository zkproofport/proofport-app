/**
 * Microsoft Entra ID (Azure AD) OIDC configuration for domain attestation.
 *
 * Uses react-native-app-auth with Authorization Code + PKCE flow.
 * Returns raw id_token (JWT) with tid, email, xms_edov claims.
 *
 * Azure AD App Registration (Masse Labs Inc. corporate tenant, 2026-05-24):
 * - Tenant: Default Directory under jaehyuk.hyun@masselabs.com
 * - Account type: All Entra ID tenants + personal Microsoft accounts (multitenant)
 * - Token configuration: optional claims email + xms_edov enabled
 * - Authentication: ID tokens implicit flow enabled, public client flows allowed
 */

export const MICROSOFT_CLIENT_ID = '8b09c842-d7a8-4d9c-a6ea-46c797412bac';

/**
 * Redirect URI for react-native-app-auth.
 * Must match the redirect URI registered in Azure AD App Registration.
 * Format: msal{clientId}://auth
 */
export const MICROSOFT_REDIRECT_URI = 'msal8b09c842-d7a8-4d9c-a6ea-46c797412bac://auth';

/**
 * Microsoft Entra ID v2.0 OIDC endpoints.
 * Using 'organizations' authority to support any organizational tenant
 * while excluding personal Microsoft accounts (which cause unauthorized_client).
 * The app validates tid at runtime to ensure organizational account.
 */
export const MICROSOFT_AUTHORITY = 'https://login.microsoftonline.com/organizations';
export const MICROSOFT_ISSUER = `${MICROSOFT_AUTHORITY}/v2.0`;
