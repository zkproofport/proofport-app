import React, {useState} from 'react';
import {ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useNavigation} from '@react-navigation/native';
import {useTranslation} from 'react-i18next';
import {ProofUiIcon} from '../../components/ProofUiIcon';
import {useProofUiColors} from '../../theme/proofUi';
import type {ProofTabScreenProps} from '../../navigation/types';
import {filterProofCatalog, PROOF_PURPOSES, type ProofPurpose} from './proofCatalog';
import {ProofCatalogCard} from './ProofCatalogCard';

type NavigationProp = ProofTabScreenProps<'CircuitSelection'>['navigation'];

export const CircuitSelectionScreen: React.FC = () => {
  const colors = useProofUiColors();
  const navigation = useNavigation<NavigationProp>();
  const {t} = useTranslation();
  const [query, setQuery] = useState('');
  const [purpose, setPurpose] = useState<ProofPurpose>('all');
  const entries = filterProofCatalog('home', purpose, query, t);

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.screen, {backgroundColor: colors.background}]}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={[styles.brand, {color: colors.secondary}]}>{t('host.proof.home.brand')}</Text>
          <Text style={[styles.heading, {color: colors.text}]}>{t('host.proof.home.title')}</Text>
          <Text style={[styles.subtitle, {color: colors.secondary}]}>{t('host.proof.home.subtitle')}</Text>
        </View>

        <TouchableOpacity
          testID="proof-scan"
          accessibilityRole="button"
          onPress={() => navigation.navigate('ScanTab', {screen: 'ScanMain'})}
          activeOpacity={0.7}
          style={[styles.scanBanner, {backgroundColor: colors.card, borderColor: colors.blue}]}>
          <ProofUiIcon name="qr" size={32} color={colors.blue} />
          <View style={styles.flex}>
            <Text style={[styles.bannerTitle, {color: colors.text}]}>{t('host.proof.home.scanTitle')}</Text>
            <Text style={[styles.bannerDescription, {color: colors.secondary}]}>{t('host.proof.home.scanDescription')}</Text>
          </View>
          <ProofUiIcon name="chevron-right" size={18} color={colors.secondary} />
        </TouchableOpacity>

        <View style={[styles.search, {backgroundColor: colors.inset, borderColor: colors.border}]}>
          <ProofUiIcon name="search" size={20} color={colors.secondary} />
          <TextInput
            testID="proof-search"
            accessibilityLabel={t('host.proof.home.searchPlaceholder')}
            placeholder={t('host.proof.home.searchPlaceholder')}
            placeholderTextColor={colors.secondary}
            style={[styles.searchInput, {color: colors.text}]}
            value={query}
            onChangeText={setQuery}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
          />
          {query.length > 0 && (
            <TouchableOpacity
              testID="proof-clear-search"
              accessibilityRole="button"
              accessibilityLabel={t('host.proof.home.clearSearch')}
              style={styles.clearSearch}
              onPress={() => setQuery('')}>
              <Text style={[styles.clearLabel, {color: colors.secondary}]}>×</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.purposes}>
          {PROOF_PURPOSES.map(item => {
            const selected = purpose === item;
            return (
              <TouchableOpacity
                key={item}
                testID={`proof-purpose-${item}`}
                accessibilityRole="button"
                accessibilityState={{selected}}
                onPress={() => setPurpose(item)}
                hitSlop={{top: 5, bottom: 5}}
                style={[styles.purpose, {
                  backgroundColor: selected ? colors.blue : colors.inset,
                  borderColor: selected ? colors.blue : colors.border,
                }]}>
                <Text style={[styles.purposeLabel, {color: colors.secondary}, selected && styles.selectedPurposeLabel]}>
                  {t(`host.proof.home.purposes.${item}`)}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={[styles.sectionHeading, {color: colors.text}]}>{t('host.proof.home.available')}</Text>
        {entries.length > 0 && (
          <View style={[styles.catalog, {backgroundColor: colors.card, borderColor: colors.border}]}>
            {entries.map((entry, index) => (
              <ProofCatalogCard key={entry.id} entry={entry} separated={index > 0} onPress={() => entry.open(navigation)} />
            ))}
          </View>
        )}
        {entries.length === 0 && (
          <View testID="proof-empty" accessibilityLiveRegion="polite" style={styles.empty}>
            <ProofUiIcon name="search" size={27} color={colors.muted} />
            <Text style={[styles.emptyTitle, {color: colors.text}]}>{t('host.proof.home.emptyTitle')}</Text>
            <Text style={[styles.emptyDescription, {color: colors.secondary}]}>{t('host.proof.home.emptyDescription')}</Text>
          </View>
        )}

        <TouchableOpacity
          testID="proof-laboratory"
          accessibilityRole="button"
          onPress={() => navigation.navigate('Laboratory')}
          activeOpacity={0.7}
          style={[styles.laboratory, {backgroundColor: colors.card, borderColor: colors.border}]}>
          <ProofUiIcon name="laboratory" size={30} color={colors.gold} />
          <View style={styles.flex}>
            <Text style={[styles.bannerTitle, {color: colors.text}]}>{t('host.proof.home.laboratoryTitle')}</Text>
            <Text style={[styles.bannerDescription, {color: colors.secondary}]}>{t('host.proof.home.laboratoryDescription')}</Text>
          </View>
          <View style={[styles.badge, {borderColor: colors.gold}]}>
            <Text style={[styles.badgeText, {color: colors.gold}]}>{t('host.proof.home.laboratoryBadge')}</Text>
          </View>
          <ProofUiIcon name="chevron-right" size={18} color={colors.muted} />
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  screen: {flex: 1},
  content: {paddingHorizontal: 20, paddingBottom: 20},
  header: {paddingTop: 18, paddingBottom: 17},
  brand: {fontSize: 18, fontWeight: '600', lineHeight: 23, letterSpacing: -0.4, marginBottom: 20},
  heading: {fontSize: 27, fontWeight: '700', lineHeight: 34, letterSpacing: -0.7},
  subtitle: {fontSize: 15, lineHeight: 21, marginTop: 5},
  flex: {flex: 1, minWidth: 0},
  scanBanner: {flexDirection: 'row', alignItems: 'center', gap: 15, borderWidth: 1.3, borderRadius: 13, paddingHorizontal: 17, paddingVertical: 14, minHeight: 70, marginBottom: 18},
  bannerTitle: {fontSize: 15, fontWeight: '600', lineHeight: 21},
  bannerDescription: {fontSize: 11, lineHeight: 17, marginTop: 3},
  search: {flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 13, paddingLeft: 14, minHeight: 44, gap: 10},
  searchInput: {flex: 1, minWidth: 0, fontSize: 14, paddingVertical: 10, paddingRight: 10},
  clearSearch: {width: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center'},
  clearLabel: {fontSize: 24},
  purposes: {flexDirection: 'row', gap: 8, paddingTop: 14, paddingBottom: 23},
  purpose: {flex: 1, minHeight: 36, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8, paddingVertical: 7, borderRadius: 20, borderWidth: 1},
  purposeLabel: {fontSize: 12, fontWeight: '500', textAlign: 'center'},
  selectedPurposeLabel: {color: '#FFFFFF'},
  sectionHeading: {fontSize: 14, fontWeight: '600', lineHeight: 20, marginBottom: 10},
  catalog: {borderWidth: 1, borderRadius: 13, overflow: 'hidden'},
  empty: {alignItems: 'center', paddingVertical: 30, paddingHorizontal: 12},
  emptyTitle: {fontSize: 16, fontWeight: '600', marginTop: 12},
  emptyDescription: {fontSize: 13, lineHeight: 20, textAlign: 'center', marginTop: 6},
  laboratory: {flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 17, paddingVertical: 13, minHeight: 72, borderWidth: 1, borderRadius: 13, marginTop: 10},
  badge: {paddingHorizontal: 12, paddingVertical: 3, borderRadius: 14, borderWidth: 1},
  badgeText: {fontSize: 11, fontWeight: '500', lineHeight: 16},
});
