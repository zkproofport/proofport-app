import React from 'react';
import {StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {useTranslation} from 'react-i18next';
import {ProofUiIcon} from '../../components/ProofUiIcon';
import {useProofUiColors} from '../../theme/proofUi';
import type {ProofCatalogEntry} from './proofCatalog';

type Props = {entry: ProofCatalogEntry; onPress: () => void; separated?: boolean};

/** One active row inside a catalog group. The group owns its outer border. */
export const ProofCatalogCard: React.FC<Props> = ({entry, onPress, separated = false}) => {
  const colors = useProofUiColors();
  const {t} = useTranslation();
  return (
    <TouchableOpacity
      testID={`proof-card-${entry.id}`}
      accessibilityRole="button"
      accessibilityLabel={`${t(entry.titleKey)}. ${t(entry.providerKey)}`}
      activeOpacity={0.7}
      onPress={onPress}
      style={[styles.row, separated && styles.separated, {borderColor: colors.border}]}>
      <View style={styles.icon}>
        <ProofUiIcon name={entry.icon} size={28} color={colors.secondary} />
      </View>
      <View style={styles.body}>
        <Text style={[styles.title, {color: colors.text}]}>{t(entry.titleKey)}</Text>
        <Text style={[styles.provider, {color: colors.secondary}]}>{t(entry.providerKey)}</Text>
      </View>
      {entry.badgeKey && (
        <View style={[styles.badge, {borderColor: colors.gold}]}>
          <Text style={[styles.badgeText, {color: colors.gold}]}>{t(entry.badgeKey)}</Text>
        </View>
      )}
      <ProofUiIcon name="chevron-right" size={18} color={colors.muted} />
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  row: {flexDirection: 'row', alignItems: 'center', minHeight: 72, paddingHorizontal: 17, paddingVertical: 13, gap: 14},
  separated: {borderTopWidth: StyleSheet.hairlineWidth},
  icon: {width: 30, alignItems: 'center', justifyContent: 'center'},
  body: {flex: 1, minWidth: 0},
  title: {fontSize: 16, fontWeight: '600', lineHeight: 23},
  provider: {fontSize: 12, lineHeight: 18, marginTop: 3},
  badge: {paddingHorizontal: 10, paddingVertical: 3, borderRadius: 14, borderWidth: 1},
  badgeText: {fontSize: 11, fontWeight: '500', lineHeight: 16},
});
