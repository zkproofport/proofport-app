package com.masselabs.zkproofport

import android.app.ActivityManager
import android.content.Context
import android.os.Debug
import android.view.WindowManager
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.UiThreadUtil
import java.io.File

/**
 * What a proof needs from the OS while it runs: how much memory the app holds
 * (for the `[ProofTiming]` log), and the screen kept on so a phone left on the
 * table does not lock, stop the activity and let Android freeze the prover.
 */
class ProofRuntimeModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
    override fun getName(): String = "ProofRuntime"

    override fun getConstants(): MutableMap<String, Any> {
        val am = reactApplicationContext.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        val info = ActivityManager.MemoryInfo()
        am.getMemoryInfo(info)
        return mutableMapOf(
            "totalMemKb" to (info.totalMem / 1024).toDouble(),
            "cpuCount" to Runtime.getRuntime().availableProcessors(),
        )
    }

    /**
     * pssKb from Debug.getPss() (walks the process's maps: tens of ms on a
     * large process, so it is taken at step boundaries, not in a loop);
     * rssKb / swapKb from /proc/self/status; availMemKb / lowMemory from
     * ActivityManager (the whole phone).
     */
    @ReactMethod
    fun memorySnapshot(promise: Promise) {
        try {
            val am = reactApplicationContext.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
            val info = ActivityManager.MemoryInfo()
            am.getMemoryInfo(info)
            val status = try { File("/proc/self/status").readLines() } catch (e: Exception) { emptyList() }
            fun field(name: String): Double =
                status.firstOrNull { it.startsWith(name) }?.split(Regex("\\s+"))?.getOrNull(1)?.toDoubleOrNull() ?: -1.0
            val map = Arguments.createMap()
            map.putDouble("pssKb", Debug.getPss().toDouble())
            map.putDouble("rssKb", field("VmRSS:"))
            map.putDouble("swapKb", field("VmSwap:"))
            map.putDouble("availMemKb", (info.availMem / 1024).toDouble())
            map.putBoolean("lowMemory", info.lowMemory)
            promise.resolve(map)
        } catch (e: Exception) {
            promise.reject("E_MEMORY", e.message, e)
        }
    }

    @ReactMethod
    fun setKeepScreenOn(on: Boolean) {
        UiThreadUtil.runOnUiThread {
            val window = reactApplicationContext.currentActivity?.window ?: return@runOnUiThread
            if (on) {
                window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            } else {
                window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            }
        }
    }
}
