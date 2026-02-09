package com.zkproofport.app

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule

class AppEnvModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
    override fun getName(): String = "AppEnv"

    override fun getConstants(): MutableMap<String, Any> {
        return mutableMapOf(
            "APP_ENV" to reactApplicationContext.getString(R.string.app_env)
        )
    }
}
