/**
 * A History record, read as plain text.
 *
 * History is a record of what this phone did. It does not check anything and
 * must not depend on the app's circuit tables: on 2026-10-23 a phone holding
 * an old `arc_eligibility` proof (Arc was removed from every repository on
 * 2026-10-13) showed E5002 "Unknown history circuit" instead of its whole
 * History list, because the list looked every record's circuit up in a table
 * that no longer had it.
 *
 * So the text a record needs is written INTO the record when it is saved
 * (`display`: title, icon key, condition rows -- see `historyDisplay` below),
 * and this reader only ever reads stored fields. A record saved before
 * `display` existed, or a damaged one, is shown with its raw stored values:
 * the circuit id string as the title, a plain document icon. No lookup, no
 * migration, nothing here throws.
 */
import type {ProofUiIconName} from '../../components/ProofUiIcon';
import {formatReviewScalar} from '../../components/ReadonlyValue';
import type {ProofHistoryItem} from '../../stores/proofHistoryStore';

type Translate = (key: string, options?: Record<string, unknown>) => string;

export interface HistoryConditionRow {
  label?: string;
  value: unknown;
}

/** What a record carries for display, written when it is saved. */
export type HistoryDisplay = NonNullable<ProofHistoryItem['display']>;

/** The icon keys a record may name. Anything else draws the plain document. */
const RECORD_ICONS: ReadonlySet<string> = new Set<ProofUiIconName>([
  'organization', 'identity', 'country', 'document', 'id-card', 'age', 'region', 'shield',
]);

const RAW_ROWS_SHOWN_ELSEWHERE: ReadonlySet<string> = new Set(['action', 'scope', 'scopeString']);

export interface HistoryRecordText {
  /** Stable React key and navigation id; '' when the record has none. */
  id: string;
  title: string;
  icon: ProofUiIconName;
  requester: string;
  timestamp: unknown;
  overallStatus: unknown;
  offChainStatus: unknown;
  onChainStatus: unknown;
  /** Stored condition rows, or the saved review inputs as raw key/value rows. */
  conditions: HistoryConditionRow[] | null;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const text = (v: unknown): string => (typeof v === 'string' ? v : v === undefined ? '' : formatReviewScalar(v));

function storedDisplay(record: Record<string, unknown>): Partial<HistoryDisplay> {
  const d = record.display;
  if (!isObject(d)) return {};
  return {
    title: typeof d.title === 'string' && d.title.trim() !== '' ? d.title : undefined,
    icon: typeof d.icon === 'string' ? d.icon : undefined,
    conditions: Array.isArray(d.conditions)
      ? d.conditions.filter(isObject).map(c => ({
          label: typeof c.label === 'string' ? c.label : undefined,
          value: c.value,
        }))
      : undefined,
  };
}

export function historyRecordText(record: unknown, t: Translate): HistoryRecordText {
  if (!isObject(record)) {
    return {
      id: '', title: text(record), icon: 'document', requester: '', timestamp: undefined,
      overallStatus: undefined, offChainStatus: undefined, onChainStatus: undefined, conditions: null,
    };
  }
  const display = storedDisplay(record);
  // Older records: the raw circuit id is the title. A saved display name from
  // before `display` existed is just as plain, but the id is what the user
  // asked to see for these.
  const title = display.title ?? (text(record.circuitId) || t('host.history.untitledRecord'));
  const icon = (display.icon && RECORD_ICONS.has(display.icon) ? display.icon : 'document') as ProofUiIconName;
  const requester = typeof record.dappName === 'string' && record.dappName !== ''
    ? formatReviewScalar(record.dappName, t)
    : t(record.source === 'deeplink' ? 'host.history.home.unknownRequester' : 'host.history.home.manual');
  // Only a version-1 snapshot is a saved review (utils/historyReview.ts).
  const review = record.review;
  const inputs = isObject(review) && review.version === 1 && isObject(review.inputs) ? review.inputs : null;
  // Raw rows for a record saved without `display`. The scope fields and the
  // action already have their own places on the detail screen.
  const conditions = display.conditions
    ?? (inputs ? Object.keys(inputs).filter(k => !RAW_ROWS_SHOWN_ELSEWHERE.has(k)).map(k => ({label: k, value: inputs[k]})) : null);
  return {
    id: typeof record.id === 'string' ? record.id : '',
    title,
    icon,
    requester,
    timestamp: record.timestamp,
    overallStatus: record.overallStatus,
    offChainStatus: record.offChainStatus,
    onChainStatus: record.onChainStatus,
    conditions,
  };
}
