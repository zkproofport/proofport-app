import en from '../i18n/locales/en.json';
import ko from '../i18n/locales/ko.json';

type StatusTone = 'blue' | 'green' | 'red' | 'gold';
const STATUS_TONES: Readonly<Record<string, StatusTone>> = Object.freeze({
  started: 'gold', generating: 'blue', pending: 'gold', generated: 'blue',
  verified: 'green', failed: 'red', verified_failed: 'red',
});
export function historyStatus(status: string): {labelKey: string; tone: StatusTone} {
  if (!Object.prototype.hasOwnProperty.call(STATUS_TONES, status)) throw new Error(`Unknown proof history status '${status}'.`);
  return {labelKey: `host.history.states.${status}`, tone: STATUS_TONES[status]};
}
const LOCALES = Object.freeze({en: {tag: 'en-US', text: en}, ko: {tag: 'ko-KR', text: ko}});
function historyLocale(language: string) {
  const key = language.split('-')[0];
  if (!Object.prototype.hasOwnProperty.call(LOCALES, key)) throw new Error(`Unknown history locale '${language}'.`);
  return LOCALES[key as keyof typeof LOCALES];
}
export function formatHistoryDate(timestamp: unknown, language: string): string {
  const locale = historyLocale(language);
  if (typeof timestamp !== 'string' || timestamp.trim().length === 0) return locale.text.host.history.dateUnavailable;
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return locale.text.host.history.dateUnavailable;
  return date.toLocaleString(locale.tag, {year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'});
}
export function historyMonth(timestamp: unknown, language: string): string {
  const locale = historyLocale(language);
  if (typeof timestamp !== 'string' || timestamp.trim().length === 0) return locale.text.host.history.dateUnavailable;
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return locale.text.host.history.dateUnavailable;
  return date.toLocaleDateString(locale.tag, {year: 'numeric', month: 'long'});
}
