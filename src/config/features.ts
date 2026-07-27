/**
 * Build-time feature flags.
 *
 * These are compile-time constants baked into the JS bundle: flip a value and
 * rebuild the app to change behavior. There is no runtime toggle.
 */

/**
 * When true (default), the embedded OpenStoa mini-app is available:
 *   - the 4th bottom tab is the OpenStoa tab
 *   - proof History lives under the "More" menu
 *
 * When false, OpenStoa is fully removed:
 *   - the 4th bottom tab is the History (proof log) tab, as it was originally
 *   - the History row is removed from "More" (it is now a top-level tab)
 */
export const OPENSTOA_ENABLED = true;
