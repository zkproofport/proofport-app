import React from 'react';
import {ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useNavigation, useNavigationState} from '@react-navigation/native';
import {useTranslation} from 'react-i18next';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import type {HistoryStackParamList} from '../../navigation/types';
import {ProofHistoryCard} from '../../components/ui/organisms/ProofHistoryCard';
import {ProofUiIcon} from '../../components/ProofUiIcon';
import {formatReviewScalar} from '../../components/ReadonlyValue';
import {canonicalCircuitId} from '../../config/circuitIds';
import {useProofUiColors} from '../../theme/proofUi';
import {getProofRequestPresentation} from '../../utils/proofRequestPresentation';
import {formatHistoryDate, historyMonth} from '../../utils/historyPresentation';
import type {ProofHistoryItem} from '../../stores';
import {useHistoryRecords} from './useHistoryRecords';

const ProofHistoryScreen: React.FC = () => {
  const {t, i18n} = useTranslation();
  const colors = useProofUiColors();
  const navigation = useNavigation<NativeStackNavigationProp<HistoryStackParamList>>();
  const nested = useNavigationState(state => state.index > 0);
  const {items, loading, failed, refresh} = useHistoryRecords();
  const grouped = new Map<string, ProofHistoryItem[]>();
  // Newest first, with undated legacy records after dated records.
  const ordered = [...items].sort((a, b) => {
    const aTime = typeof a.timestamp === 'string' ? Date.parse(a.timestamp) : NaN;
    const bTime = typeof b.timestamp === 'string' ? Date.parse(b.timestamp) : NaN;
    if (Number.isNaN(aTime)) return Number.isNaN(bTime) ? 0 : 1;
    if (Number.isNaN(bTime)) return -1;
    return bTime - aTime;
  });
  for (const item of ordered) {
    const month = historyMonth(item.timestamp, i18n.language);
    const group = grouped.get(month);
    if (group) group.push(item);
    else grouped.set(month, [item]);
  }
  return <SafeAreaView edges={nested ? ['left', 'right'] : ['top', 'left', 'right']}
    style={[styles.screen, {backgroundColor: colors.background}]}>
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        {!nested && <>
          <Text style={[styles.brand, {color: colors.secondary}]}>{t('host.proof.home.brand')}</Text>
          <Text style={[styles.title, {color: colors.text}]}>{t('host.history.home.title')}</Text>
        </>}
        <Text style={[styles.subtitle, {color: colors.secondary}]}>{t('host.history.home.subtitle')}</Text>
      </View>
      {loading && <View style={styles.state}>
        <ActivityIndicator color={colors.blue} />
        <Text style={[styles.stateText, {color: colors.secondary}]}>{t('host.history.loadingText')}</Text>
      </View>}
      {!loading && failed && <View testID="history-load-error" style={[styles.state, {backgroundColor: colors.card, borderColor: colors.border}]}>
        <ProofUiIcon name="info" size={30} color={colors.gold} />
        <Text style={[styles.stateTitle, {color: colors.text}]}>{t('host.history.home.errorText')}</Text>
        <TouchableOpacity testID="history-retry" accessibilityRole="button" onPress={refresh}
          style={[styles.button, {backgroundColor: colors.blue}]}>
          <Text style={styles.buttonText}>{t('host.history.home.retry')}</Text>
        </TouchableOpacity>
      </View>}
      {!loading && !failed && items.length === 0 && <View testID="history-empty" style={[styles.state, {backgroundColor: colors.card, borderColor: colors.border}]}>
        <ProofUiIcon name="shield" size={34} color={colors.blue} />
        <Text style={[styles.stateTitle, {color: colors.text}]}>{t('host.history.emptyTitle')}</Text>
        <Text style={[styles.stateText, {color: colors.secondary}]}>{t('host.history.home.emptyText')}</Text>
      </View>}
      {!loading && !failed && items.length > 0 && <>
        <Text style={[styles.count, {color: colors.muted}]}>{t('host.history.home.count', {count: items.length})}</Text>
        {[...grouped].map(([month, records]) => <View key={month} style={styles.group}>
          <Text style={[styles.month, {color: colors.secondary}]}>{month}</Text>
          {records.map(item => {
            const circuit = canonicalCircuitId(item.circuitId);
            if (!circuit) throw new Error(`Unknown history circuit '${item.circuitId}'.`);
            const presentation = getProofRequestPresentation({circuit, inputs: {}}, t);
            const requester = item.dappName ? formatReviewScalar(item.dappName, t)
              : t(item.source === 'deeplink' ? 'host.history.home.unknownRequester' : 'host.history.home.manual');
            return <ProofHistoryCard key={item.id} id={item.id} circuitIcon={presentation.icon}
              circuitName={presentation.title} requester={requester} status={item.overallStatus}
              date={formatHistoryDate(item.timestamp, i18n.language)}
              onPress={() => navigation.navigate('HistoryDetail', {proofId: item.id})} />;
          })}
        </View>)}
      </>}
    </ScrollView>
  </SafeAreaView>;
};
const styles = StyleSheet.create({
  screen: {flex: 1},
  content: {paddingHorizontal: 20, paddingTop: 16, paddingBottom: 40, gap: 22},
  header: {gap: 8},
  brand: {fontSize: 17, fontWeight: '600', marginBottom: 12},
  title: {fontSize: 27, lineHeight: 35, fontWeight: '700'},
  subtitle: {fontSize: 14, lineHeight: 21},
  count: {fontSize: 12, lineHeight: 18},
  group: {gap: 10},
  month: {fontSize: 13, lineHeight: 19, fontWeight: '600', marginBottom: 2},
  state: {padding: 25, paddingVertical: 34, alignItems: 'center', gap: 14, borderRadius: 14, borderWidth: 1, borderColor: 'transparent'},
  stateTitle: {fontSize: 17, fontWeight: '600', lineHeight: 24, textAlign: 'center'},
  stateText: {fontSize: 14, lineHeight: 21, textAlign: 'center'},
  button: {minHeight: 44, borderRadius: 10, justifyContent: 'center', paddingHorizontal: 22},
  buttonText: {fontSize: 14, fontWeight: '600', color: '#FFFFFF'},
});
export default ProofHistoryScreen;
