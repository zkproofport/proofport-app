import React from 'react';
import {ScrollView, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {useTranslation} from 'react-i18next';
import {ProofUiIcon} from '../../components/ProofUiIcon';
import {useProofUiColors} from '../../theme/proofUi';
import type {ProofStackParamList} from '../../navigation/types';
import {filterProofCatalog, type ProofCatalogEntry} from './proofCatalog';
import {ProofCatalogCard} from './ProofCatalogCard';

export const LaboratoryScreen: React.FC = () => {
  const colors = useProofUiColors();
  const {t} = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<ProofStackParamList>>();
  const entries = filterProofCatalog('laboratory', 'all', '', t);
  const sections: {titleKey: string; entries: ProofCatalogEntry[]}[] = [];
  for (const entry of entries) {
    if (!entry.groupKey) throw new Error(`Laboratory group missing for '${entry.id}'.`);
    const section = sections.find(item => item.titleKey === entry.groupKey);
    if (section) section.entries.push(entry);
    else sections.push({titleKey: entry.groupKey, entries: [entry]});
  }

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.screen, {backgroundColor: colors.background}]}>
      <View style={styles.header}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={t('host.proofRequest.review.back')}
          onPress={() => navigation.goBack()}
          style={styles.backButton}>
          <ProofUiIcon name="arrow-left" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text accessibilityRole="header" style={[styles.headerTitle, {color: colors.text}]}>
          {t('host.proof.laboratory.title')}
        </Text>
      </View>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <ProofUiIcon name="laboratory" size={43} color={colors.gold} />
          <Text style={[styles.heroTitle, {color: colors.text}]}>{t('host.proof.laboratory.heroTitle')}</Text>
        </View>
        <View style={[styles.notice, {backgroundColor: colors.inset, borderColor: colors.border}]}>
          <ProofUiIcon name="info" size={19} color={colors.secondary} />
          <Text style={[styles.description, {color: colors.secondary}]}>{t('host.proof.laboratory.description')}</Text>
        </View>
        {sections.map(section => (
          <View key={section.titleKey} style={styles.section}>
            <Text style={[styles.group, {color: colors.text}]}>{t(section.titleKey)}</Text>
            <View style={[styles.catalog, {backgroundColor: colors.card, borderColor: colors.border}]}>
              {section.entries.map((entry, index) => (
                <ProofCatalogCard key={entry.id} entry={entry} separated={index > 0} onPress={() => entry.open(navigation)} />
              ))}
            </View>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  screen: {flex: 1},
  header: {flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, minHeight: 56, gap: 4},
  backButton: {width: 44, height: 44, alignItems: 'center', justifyContent: 'center'},
  headerTitle: {flex: 1, fontSize: 20, fontWeight: '600', lineHeight: 27},
  content: {paddingHorizontal: 20, paddingBottom: 24},
  hero: {alignItems: 'center', paddingTop: 13, paddingBottom: 15},
  heroTitle: {fontSize: 19, fontWeight: '600', lineHeight: 27, marginTop: 14, textAlign: 'center'},
  notice: {flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 13, borderWidth: 1},
  description: {flex: 1, fontSize: 12, lineHeight: 18},
  section: {marginTop: 25},
  group: {fontSize: 14, fontWeight: '500', lineHeight: 20, marginBottom: 10},
  catalog: {borderWidth: 1, borderRadius: 13, overflow: 'hidden'},
});
