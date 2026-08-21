package com.masselabs.zkproofport

import android.content.Context
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * Build-time config, plus the one developer override that has to survive into
 * the NEXT launch.
 *
 * The override is stored natively rather than in AsyncStorage on purpose. JS
 * reads `OPENSTOA_ENABLED` at module load — the push-tap bridge starts at import
 * time, before any React state exists — so an async JS read would arrive too
 * late and leave the app half-switched. Resolving it here means that by the time
 * the first line of JS runs, the value is already the right one, and "restart to
 * apply" is the whole mechanism instead of a caveat.
 */
class AppEnvModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
    override fun getName(): String = "AppEnv"

    private fun prefs() =
        reactApplicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    override fun getConstants(): MutableMap<String, Any> {
        // Flavor value unless a developer has overridden it (see build.gradle).
        val fromBuild = reactApplicationContext.getString(R.string.openstoa_enabled)
        val enabled = prefs().getBoolean(KEY_OPENSTOA, fromBuild != "false")
        return mutableMapOf(
            "APP_ENV" to reactApplicationContext.getString(R.string.app_env),
            "OPENSTOA_ENABLED" to if (enabled) "true" else "false"
        )
    }

    /** Takes effect on the next launch — constants are read once, at bridge setup. */
    @ReactMethod
    fun setOpenStoaOverride(enabled: Boolean) {
        prefs().edit().putBoolean(KEY_OPENSTOA, enabled).apply()
    }

    /** Drop the override and go back to whatever the build says. */
    @ReactMethod
    fun clearOpenStoaOverride() {
        prefs().edit().remove(KEY_OPENSTOA).apply()
    }

    companion object {
        private const val PREFS = "zkproofport.devoverrides"
        private const val KEY_OPENSTOA = "openstoa_enabled"
    }
}
