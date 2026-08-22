package com.masselabs.zkproofport

import android.app.Activity
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * Sends this app to the back so whatever launched it resumes.
 *
 * This is the Android answer to "return the user to where they came from" after
 * a proof, and it is strictly better than opening a URL. `moveTaskToBack(true)`
 * brings the task behind us forward exactly as the user left it — same browser,
 * same tab, same scroll position, same JavaScript state, no reload and no new
 * tab. It needs no `returnScheme`, no referrer, and no package-visibility
 * `<queries>` entry, because it never names the other app at all.
 *
 * Public API since API level 1 (`Activity.moveTaskToBack`), and the same thing
 * MetaMask, Rainbow and Kraken ship on Android.
 *
 * iOS has no counterpart. Apple provides no public API for an app to background
 * itself (Technical Q&A QA1561), and the private `_systemNavigationAction`
 * trick that wallets used for years both violates App Review guideline 2.5.1
 * and has done nothing at all since iOS 17. On iOS the app therefore either
 * opens a scheme the requester named or tells the user to switch back.
 *
 * `nonRoot = true` means "move the whole task back even if this activity is the
 * root", which is what makes it work when the proof request was the reason the
 * app launched in the first place.
 */
class AppSwitcherModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "AppSwitcher"

    /**
     * Resolves true when the task was moved, false when it could not be.
     *
     * Never rejects. This runs after the proof has already been generated and
     * delivered, so a failure here is cosmetic — the JS side treats false as
     * "tell the user to switch back themselves" and carries on.
     */
    @ReactMethod
    fun moveTaskToBack(promise: Promise) {
        // `reactApplicationContext.currentActivity`, not the inherited
        // `getCurrentActivity()`: that one is deprecated as of React Native
        // 0.80 and is a Kotlin function rather than a Java getter, so it has no
        // property form. This is the replacement its @Deprecated annotation
        // names. Explicitly typed so the module's own `moveTaskToBack` cannot
        // shadow Activity's.
        val activity: Activity? = reactApplicationContext.currentActivity
        if (activity == null) {
            // No activity attached — the app is already backgrounded, or is
            // being torn down. Nothing to move.
            promise.resolve(false)
            return
        }
        try {
            promise.resolve(activity.moveTaskToBack(true))
        } catch (e: Exception) {
            promise.resolve(false)
        }
    }
}
