// Phase 0 on-device PoC screen — runs the ts-mls + 0x0001 round-trip on the
// real device (Hermes) using the quick-crypto `subtle` polyfill, reports
// per-step latency, and lets you copy the full result. Throwaway dev UI.
import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, SafeAreaView, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import { ensureSubtleCrypto, type PolyfillResult } from '../../poc/installCryptoPolyfill';
import { runMlsRoundTrip, type MlsPocResult } from '../../poc/mlsRoundTrip';
import { runPasskeyPrf, type PrfResult } from '../../poc/passkeyPrf';

const SUITE = 'MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519';

const MlsPocScreen: React.FC = () => {
  const [running, setRunning] = useState(false);
  const [polyfill, setPolyfill] = useState<PolyfillResult | null>(null);
  const [result, setResult] = useState<MlsPocResult | null>(null);
  const [prf, setPrf] = useState<PrfResult | null>(null);
  const [prfRunning, setPrfRunning] = useState(false);
  const [copied, setCopied] = useState(false);

  const run = useCallback(async () => {
    setRunning(true);
    setResult(null);
    setCopied(false);
    let p: PolyfillResult | null = null;
    try {
      p = ensureSubtleCrypto();
      setPolyfill(p);
      const r = await runMlsRoundTrip();
      console.log('[MLS_POC_RESULT]', JSON.stringify({ polyfill: p, ...r }));
      setResult(r);
    } catch (e) {
      const r: MlsPocResult = {
        ok: false, suite: SUITE, steps: [], totalMs: 0,
        error: e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e),
      };
      console.log('[MLS_POC_RESULT]', JSON.stringify({ polyfill: p, ...r }));
      setResult(r);
    } finally {
      setRunning(false);
    }
  }, []);

  const runPrf = useCallback(async () => {
    setPrfRunning(true);
    setPrf(null);
    setCopied(false);
    try {
      const r = await runPasskeyPrf();
      console.log('[PASSKEY_PRF_RESULT]', JSON.stringify(r));
      setPrf(r);
    } catch (e) {
      const r: PrfResult = { ok: false, rpId: 'stg-community.zkproofport.app', steps: [], error: e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e) };
      console.log('[PASSKEY_PRF_RESULT]', JSON.stringify(r));
      setPrf(r);
    } finally {
      setPrfRunning(false);
    }
  }, []);

  const fullText = useCallback(() => {
    return JSON.stringify({ polyfill, result, prf }, null, 2);
  }, [polyfill, result, prf]);

  const copy = useCallback(() => {
    Clipboard.setString(fullText());
    setCopied(true);
  }, [fullText]);

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>MLS PoC — ts-mls 0x0001 (Hermes)</Text>
        {polyfill && <Text style={styles.mono}>polyfill: {polyfill.source} (hadSubtle={String(polyfill.hadSubtle)} attached={String(polyfill.attached)})</Text>}
        {polyfill?.qcKeys && <Text style={styles.mono}>quick-crypto keys: {polyfill.qcKeys.join(', ')}</Text>}

        <View style={styles.row}>
          <TouchableOpacity style={[styles.btn, running && styles.btnDisabled]} onPress={run} disabled={running}>
            {running ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Run round-trip</Text>}
          </TouchableOpacity>
          {(result || polyfill || prf) && (
            <TouchableOpacity style={styles.copyBtn} onPress={copy}>
              <Text style={styles.btnText}>{copied ? 'Copied ✓' : 'Copy log'}</Text>
            </TouchableOpacity>
          )}
        </View>

        {result && (
          <View style={styles.card}>
            <Text style={[styles.verdict, { color: result.ok ? '#16a34a' : '#dc2626' }]}>
              {result.ok ? '✅ PASS' : '❌ FAIL'}  ({result.totalMs}ms total)
            </Text>
            <Text style={styles.mono}>suite: {result.suite}</Text>
            {result.decrypted != null && <Text style={styles.mono}>decrypted: "{result.decrypted}"</Text>}
            {result.aliceEpoch != null && (
              <Text style={styles.mono}>epoch alice={result.aliceEpoch} bob={result.bobEpoch}</Text>
            )}
            <View style={styles.steps}>
              {result.steps.map((s, i) => (
                <Text key={i} style={styles.mono}>· {s.label}: {s.ms}ms</Text>
              ))}
            </View>
            {result.error && <Text style={styles.err}>{result.error}</Text>}
          </View>
        )}

        <View style={styles.divider} />
        <Text style={styles.title}>Passkey PRF (D6 key recovery)</Text>
        <Text style={styles.mono}>rpId: stg-community.zkproofport.app (AASA live)</Text>
        <TouchableOpacity style={[styles.btn, prfRunning && styles.btnDisabled]} onPress={runPrf} disabled={prfRunning}>
          {prfRunning ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Run passkey PRF</Text>}
        </TouchableOpacity>
        {prf && (
          <View style={styles.card}>
            <Text style={[styles.verdict, { color: prf.ok ? '#16a34a' : '#dc2626' }]}>
              {prf.ok ? '✅ PRF deterministic' : '❌ PRF FAIL'}
            </Text>
            <Text style={styles.mono}>supported={String(prf.supported)} regPrfEnabled={String(prf.regPrfEnabled)}</Text>
            <Text style={styles.mono}>deterministic={String(prf.deterministic)}</Text>
            {prf.prf1 != null && <Text style={styles.mono}>prf1: {String(prf.prf1).slice(0, 24)}…</Text>}
            {prf.prf2 != null && <Text style={styles.mono}>prf2: {String(prf.prf2).slice(0, 24)}…</Text>}
            {prf.steps.map((s, i) => <Text key={i} style={styles.mono}>· {s.label}: {s.ms}ms</Text>)}
            {prf.error && <Text style={styles.err}>{prf.error}</Text>}
          </View>
        )}

        <Text style={styles.note}>
          MLS: validates ts-mls on Hermes. Passkey PRF: D6/D7/D8 key-recovery foundation —
          register then evaluate PRF twice, check identical 32B (determinism). For synced
          cross-device, run "Run passkey PRF" on a 2nd iCloud device with the same passkey.
          "Copy log" copies the full JSON (MLS + PRF).
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0b0b0f' },
  content: { padding: 16, gap: 12 },
  title: { color: '#fff', fontSize: 18, fontWeight: '700' },
  row: { flexDirection: 'row', gap: 10 },
  btn: { flex: 1, backgroundColor: '#2563eb', padding: 14, borderRadius: 10, alignItems: 'center' },
  btnDisabled: { opacity: 0.6 },
  copyBtn: { backgroundColor: '#3f3f46', paddingHorizontal: 16, justifyContent: 'center', borderRadius: 10 },
  btnText: { color: '#fff', fontWeight: '600' },
  card: { backgroundColor: '#16161d', borderRadius: 10, padding: 14, gap: 6 },
  verdict: { fontSize: 16, fontWeight: '700' },
  steps: { marginTop: 6, gap: 2 },
  mono: { color: '#cbd5e1', fontFamily: 'Courier', fontSize: 12 },
  err: { color: '#fca5a5', fontFamily: 'Courier', fontSize: 11, marginTop: 8 },
  note: { color: '#71717a', fontSize: 11, marginTop: 12 },
  divider: { height: 1, backgroundColor: '#27272a', marginVertical: 8 },
});

export default MlsPocScreen;
