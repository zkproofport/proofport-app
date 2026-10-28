/**
 * The honest part of the proving screen: what is happening now, how long it
 * has taken, and how long it took last time on this phone.
 *
 * Shown while a proof attempt runs (the store in utils/proofProgress.ts is
 * written by the download and the prover). The clock ticks every second from
 * the JavaScript thread, which proving no longer blocks.
 */
import React, {useEffect, useState} from 'react';
import {Text, View, StyleSheet} from 'react-native';
import {useTranslation} from 'react-i18next';
import {useThemeColors} from '../context';
import {useProofProgress, type ProofProgress} from '../utils/proofProgress';

/** `2:05`, `0:42`. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** `12.3 MB`, `134 MB`. */
export function formatBytes(bytes: number): string {
  const mb = bytes / 1_000_000;
  return `${mb < 100 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

const PHASE_KEYS = ['read circuit', 'load srs', 'solve witness', 'serialize witness', 'prove'] as const;

/** The i18n key for the prover's phase; an unknown phase shows the stage line only. */
export function phaseKey(phase: string | null): string | null {
  return phase !== null && (PHASE_KEYS as readonly string[]).includes(phase)
    ? `host.proof.generation.progress.phase.${phase}`
    : null;
}

export function progressLines(
  p: ProofProgress,
  now: number,
  t: (key: string, opts?: Record<string, string>) => string,
): {title: string; detail: string[]} {
  const detail: string[] = [];
  if (p.stage === 'download') {
    return {title: t('host.proof.generation.progress.download', {received: formatBytes(p.downloadedBytes)}), detail};
  }
  if (p.stage === 'prove') {
    const key = phaseKey(p.proverPhase);
    if (key) detail.push(t(key));
    if (p.proveStartedAt !== null) {
      detail.push(t('host.proof.generation.progress.elapsed', {elapsed: formatDuration(now - p.proveStartedAt)}));
    }
    detail.push(
      p.estimateMs !== null
        ? t('host.proof.generation.progress.estimate', {time: formatDuration(p.estimateMs)})
        : t('host.proof.generation.progress.firstTime'),
    );
    if (p.wasInBackground) detail.push(t('host.proof.generation.progress.backgrounded'));
    detail.push(t('host.proof.generation.progress.keepOpen'));
    return {title: t('host.proof.generation.progress.prove'), detail};
  }
  return {title: t('host.proof.generation.progress.prepare'), detail};
}

export const ProofProgressCard: React.FC = () => {
  const {t} = useTranslation();
  const {colors} = useThemeColors();
  const progress = useProofProgress();
  const [now, setNow] = useState(Date.now());
  const running = progress.stage === 'download' || progress.stage === 'prepare' || progress.stage === 'prove';

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running]);

  if (!running) return null;
  const {title, detail} = progressLines(progress, now, (k, o) => t(k, o) as string);
  return (
    <View
      testID="proof-progress"
      style={[styles.card, {backgroundColor: colors.background.secondary, borderColor: colors.info[500]}]}>
      <Text style={[styles.title, {color: colors.text.primary}]}>{title}</Text>
      {detail.map(line => (
        <Text key={line} style={[styles.detail, {color: colors.text.secondary}]}>
          {line}
        </Text>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {borderWidth: 1, borderRadius: 12, padding: 16, marginBottom: 16},
  title: {fontSize: 16, fontWeight: '600', marginBottom: 6},
  detail: {fontSize: 14, lineHeight: 20},
});
