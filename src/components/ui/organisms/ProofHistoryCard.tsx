import React from 'react';
import {StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {useProofUiColors} from '../../../theme/proofUi';
import {ProofUiIcon, type ProofUiIconName} from '../../ProofUiIcon';
import {HistoryStatusBadge} from '../../../screens/history/HistoryStatusBadge';

interface ProofHistoryCardProps {
  id: string;
  circuitIcon: ProofUiIconName;
  circuitName: string;
  requester: string;
  status: string;
  date: string;
  onPress: () => void;
}

export function ProofHistoryCard({id, circuitIcon, circuitName, requester, status, date, onPress}: ProofHistoryCardProps) {
  const colors = useProofUiColors();
  return <TouchableOpacity testID={`history-record-${id}`} accessibilityRole="button"
    onPress={onPress} activeOpacity={0.75}
    style={[styles.card, {backgroundColor: colors.card, borderColor: colors.border}]}>
    <View style={styles.top}>
      <View style={[styles.icon, {backgroundColor: colors.inset}]}>
        <ProofUiIcon name={circuitIcon} size={25} color={colors.blue} />
      </View>
      <View style={styles.body}>
        <Text style={[styles.title, {color: colors.text}]}>{circuitName}</Text>
        <Text numberOfLines={2} style={[styles.requester, {color: colors.secondary}]}>{requester}</Text>
      </View>
      <ProofUiIcon name="chevron-right" size={18} color={colors.muted} />
    </View>
    <View style={[styles.bottom, {borderColor: colors.border}]}>
      <Text style={[styles.date, {color: colors.muted}]}>{date}</Text>
      <HistoryStatusBadge status={status} />
    </View>
  </TouchableOpacity>;
}
const styles = StyleSheet.create({
  card: {borderRadius: 14, borderWidth: 1, padding: 16, gap: 14},
  top: {flexDirection: 'row', alignItems: 'center', gap: 13},
  icon: {width: 44, height: 44, borderRadius: 11, alignItems: 'center', justifyContent: 'center'},
  body: {flex: 1, minWidth: 0, gap: 4},
  title: {fontSize: 16, lineHeight: 23, fontWeight: '600'},
  requester: {fontSize: 13, lineHeight: 19},
  bottom: {borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap'},
  date: {fontSize: 12, lineHeight: 18, flexShrink: 1},
});
