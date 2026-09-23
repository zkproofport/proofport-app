import React, {useEffect, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {useProofUiColors} from '../theme/proofUi';
import {ProofUiIcon} from './ProofUiIcon';

type Translate = (key: string, options?: Record<string, unknown>) => string;
const valueKey = (name: string) => `host.proofRequest.review.values.${name}`;

/** Visible control markers cannot reorder adjacent labels; the payload is untouched. */
export function formatReviewScalar(value: unknown, t: Translate = key => key): string {
  if (typeof value === 'string') {
    if (value === '') return t(valueKey('emptyString'));
    const readable = value.replace(
      // eslint-disable-next-line no-control-regex -- Controls must be visible in the signing review.
      /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/g,
      char => `⟦U+${char.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}⟧`,
    );
    return /^ +$/.test(readable) ? readable.replace(/ /g, '␠') : readable;
  }
  if (value === null) return t(valueKey('null'));
  if (value === undefined) return t(valueKey('missing'));
  // Malformed metadata may be an object with an own, non-callable toString.
  // A summary names the group; ReadonlyValue exposes every original child.
  if (typeof value === 'object') return t(valueKey(Array.isArray(value) ? 'list' : 'fields'));
  if (typeof value === 'number' && Object.is(value, -0)) return '-0';
  return String(value);
}

interface ReadonlyValueProps {
  value: unknown;
  label?: string;
  initiallyExpanded?: boolean;
  layout?: 'row' | 'stacked';
  showScalarType?: boolean;
  depth?: number;
  ancestors?: readonly object[];
}

/** Plain label/value rows with expandable groups, never a serialized JSON dump. */
export const ReadonlyValue: React.FC<ReadonlyValueProps> = ({
  value, label, initiallyExpanded = true, layout = 'row', showScalarType = true, depth = 0, ancestors = [],
}) => {
  const {t} = useTranslation();
  const colors = useProofUiColors();
  const [expanded, setExpanded] = useState(initiallyExpanded);
  useEffect(() => setExpanded(initiallyExpanded), [value, initiallyExpanded]);
  const isObject = typeof value === 'object' && value !== null;
  const circular = isObject && ancestors.includes(value);
  const entries = isObject && !circular ? Object.entries(value) : [];
  const array = Array.isArray(value);
  const keyText = label === undefined ? undefined : formatReviewScalar(label, t);
  const stacked = layout === 'stacked';

  if (!isObject || circular || entries.length === 0) {
    let text = formatReviewScalar(value, t);
    if (circular) text = t(valueKey('circular'));
    else if (isObject) text = t(valueKey(array ? 'emptyArray' : 'emptyObject'));
    // A text-type hint distinguishes string values from equally spelled
    // Booleans/numbers without adding JSON quotation to ordinary prose.
    const ambiguousString = typeof value === 'string' && /^(?:true|false|null|undefined|-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)$/i.test(value);
    return (
      <View style={[styles.row, {borderColor: colors.border}, stacked && styles.stackedRow]}>
        {keyText !== undefined && <Text selectable style={[styles.label, {color: colors.secondary}, stacked && styles.stackedLabel]}>{keyText}</Text>}
        <View style={[styles.valueColumn, keyText === undefined && styles.unlabelled, stacked && styles.stackedValue]}>
          <Text selectable lineBreakStrategyIOS="hangul-word"
            style={[styles.value, {color: colors.text}, (stacked || keyText === undefined) && styles.left]}>{text}</Text>
          {showScalarType && ambiguousString && <Text style={[styles.typeHint, {color: colors.muted}]}>{t(valueKey('text'))}</Text>}
        </View>
      </View>
    );
  }

  const showToggle = label !== undefined || !initiallyExpanded;
  return (
    <View style={styles.node}>
      {showToggle && <TouchableOpacity accessibilityRole="button"
        accessibilityState={{expanded}} onPress={() => setExpanded(open => !open)}
        style={[styles.groupHeader, {borderColor: colors.border}]}>
        <Text selectable style={[styles.groupLabel, {color: colors.text}]}>
          {keyText ?? t(valueKey(array ? 'list' : 'fields'))}
        </Text>
        <Text style={[styles.count, {color: colors.muted}]}>{t(valueKey(array ? 'items' : 'entries'), {count: entries.length})}</Text>
        <ProofUiIcon name={expanded ? 'chevron-down' : 'chevron-right'} size={16} color={colors.muted} />
      </TouchableOpacity>}
      {expanded && <View style={showToggle && depth < 3 ? styles.children : undefined}>
        {entries.map(([key, child]) => (
          <ReadonlyValue key={key} label={array ? t(valueKey('item'), {index: Number(key) + 1}) : key}
            value={child} depth={depth + 1} layout={layout} showScalarType={showScalarType}
            initiallyExpanded={depth < 1 && (!Array.isArray(child) || child.length <= 4)}
            ancestors={[...ancestors, value]} />
        ))}
      </View>}
    </View>
  );
};

const styles = StyleSheet.create({
  node: {minWidth: 0},
  row: {flexDirection: 'row', alignItems: 'flex-start', gap: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth},
  label: {fontSize: 14, lineHeight: 21, flex: 1, flexShrink: 1},
  valueColumn: {flex: 1.6, minWidth: 0, alignItems: 'flex-end'},
  unlabelled: {flex: 1, alignItems: 'flex-start'},
  value: {fontSize: 14, lineHeight: 21, textAlign: 'right', flexShrink: 1},
  left: {textAlign: 'left'},
  stackedRow: {flexDirection: 'column', gap: 3, paddingVertical: 5, borderBottomWidth: 0},
  stackedLabel: {flex: 0, fontSize: 11, lineHeight: 16},
  stackedValue: {flex: 0, alignItems: 'flex-start', alignSelf: 'stretch'},
  typeHint: {fontSize: 11, lineHeight: 16, marginTop: 2},
  groupHeader: {minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth},
  groupLabel: {fontSize: 14, lineHeight: 21, fontWeight: '600', flex: 1, flexShrink: 1},
  count: {fontSize: 12, lineHeight: 18},
  children: {paddingLeft: 12},
});
