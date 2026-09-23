import React from 'react';
import {Pressable, StyleSheet, Switch, Text, View} from 'react-native';
import {ProofUiIcon, type ProofUiIconName} from '../../components/ProofUiIcon';
import {useProofUiColors} from '../../theme/proofUi';

export function SettingsGroup({title, children}: {title: string; children: React.ReactNode}) {
  const colors = useProofUiColors();
  return <View style={styles.group}>
    <Text accessibilityRole="header" style={[styles.sectionTitle, {color: colors.secondary}]}>{title}</Text>
    <View style={[styles.card, {backgroundColor: colors.card, borderColor: colors.border}]}>{children}</View>
  </View>;
}

export function SettingsRow({testID, icon, title, description, value, onPress, destructive = false, disabled = false, separated = false}: {
  testID: string; icon: ProofUiIconName; title: string; description?: string; value?: string;
  onPress: () => void; destructive?: boolean; disabled?: boolean; separated?: boolean;
}) {
  const colors = useProofUiColors();
  const foreground = destructive ? colors.red : colors.text;
  return <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={[title, value, description].filter(Boolean).join(', ')}
    accessibilityState={{disabled}} disabled={disabled} onPress={onPress}
    style={({pressed}) => [styles.row, separated && styles.divider, {borderColor: colors.border}, (pressed || disabled) && styles.dim]}>
    <ProofUiIcon name={icon} size={21} color={destructive ? foreground : colors.secondary} />
    <View style={styles.body}>
      <Text style={[styles.label, {color: foreground}]}>{title}</Text>
      {description ? <Text style={[styles.description, {color: colors.secondary}]}>{description}</Text> : null}
    </View>
    {value ? <Text style={[styles.value, {color: colors.secondary}]}>{value}</Text> : null}
    <ProofUiIcon name="chevron-right" size={18} color={colors.muted} />
  </Pressable>;
}

export function SettingsToggle({testID, label, value, onValueChange, description, separated = false}: {
  testID: string; label: string; value: boolean; onValueChange: (value: boolean) => void;
  description?: string; separated?: boolean;
}) {
  const colors = useProofUiColors();
  return <View style={[styles.row, separated && styles.divider, {borderColor: colors.border}]}>
    <View style={styles.body}>
      <Text style={[styles.label, {color: colors.text}]}>{label}</Text>
      {description ? <Text style={[styles.description, {color: colors.secondary}]}>{description}</Text> : null}
    </View>
    <Switch testID={testID} accessibilityLabel={label} accessibilityHint={description} value={value} onValueChange={onValueChange}
      trackColor={{false: colors.border, true: colors.blue}} thumbColor="#FFFFFF" ios_backgroundColor={colors.border} />
  </View>;
}

const styles = StyleSheet.create({
  group: {gap: 10}, sectionTitle: {fontSize: 12, fontWeight: '600', letterSpacing: 0.8, paddingHorizontal: 2},
  card: {borderWidth: 1, borderRadius: 14, overflow: 'hidden'},
  row: {minHeight: 60, paddingHorizontal: 16, paddingVertical: 16, flexDirection: 'row', alignItems: 'center', gap: 13},
  body: {flex: 1, minWidth: 0, gap: 5}, label: {fontSize: 15, lineHeight: 21, fontWeight: '500'},
  description: {fontSize: 12, lineHeight: 18}, value: {fontSize: 13, lineHeight: 19, flexShrink: 1},
  divider: {borderTopWidth: StyleSheet.hairlineWidth}, dim: {opacity: 0.55},
});
