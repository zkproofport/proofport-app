package com.masselabs.zkproofport

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Base64
import android.util.Log
import java.io.File

/**
 * DEBUG BUILDS ONLY (src/debug): captures what AndroidKeyAttestationCore
 * produces on a real phone, for scripts/capture-android-attestation.sh.
 *
 *   am broadcast -n com.masselabs.zkproofport/.AttestationProbeReceiver \
 *     --es action attest --es statement <base64>
 *       -> files/attestation-probe/attest.json {chain: [base64 DER], signature: base64 DER, strongBox}
 *   am broadcast ... --es action integrity --es nonce <unpadded base64url>
 *       -> files/attestation-probe/integrity.json {token}   (the encrypted JWE)
 *
 * Each run first deletes its output file and writes `<name>.error` on a
 * refusal, so a stale file is never read as a result. Nothing is logged but
 * sizes and codes.
 */
class AttestationProbeReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val dir = File(context.filesDir, "attestation-probe").apply { mkdirs() }
        val pending = goAsync()
        when (val action = intent.getStringExtra("action")) {
            "attest" -> {
                val out = File(dir, "attest.json")
                val err = File(dir, "attest.error")
                out.delete(); err.delete()
                Thread {
                    try {
                        val statement = Base64.decode(intent.getStringExtra("statement") ?: "", Base64.NO_WRAP)
                        val r = AndroidKeyAttestationCore.attestAndSign(context, statement)
                        val chain = r.chain.joinToString(",") { "\"" + Base64.encodeToString(it, Base64.NO_WRAP) + "\"" }
                        out.writeText(
                            "{\"chain\":[$chain],\"signature\":\"${Base64.encodeToString(r.signature, Base64.NO_WRAP)}\",\"strongBox\":${r.strongBox}}",
                        )
                        Log.i(TAG, "attest: ${r.chain.size} certificates written")
                    } catch (e: AttestationException) {
                        err.writeText("${e.code}: ${e.message}")
                    } catch (e: Exception) {
                        err.writeText("${e.javaClass.name}: ${e.message}")
                    } finally {
                        pending.finish()
                    }
                }.start()
            }
            "integrity" -> {
                val out = File(dir, "integrity.json")
                val err = File(dir, "integrity.error")
                out.delete(); err.delete()
                AndroidKeyAttestationCore.requestIntegrityToken(
                    context,
                    intent.getStringExtra("nonce") ?: "",
                    { token ->
                        out.writeText("{\"token\":\"$token\"}")
                        pending.finish()
                    },
                    { e ->
                        err.writeText("${e.code}: ${e.message}")
                        pending.finish()
                    },
                )
            }
            else -> {
                File(dir, "probe.error").writeText("Unknown action '$action'. Known: attest, integrity.")
                pending.finish()
            }
        }
    }

    companion object {
        private const val TAG = "AttestationProbe"
    }
}
