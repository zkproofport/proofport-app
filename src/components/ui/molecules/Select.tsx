import React, {useState} from 'react';
import {Modal, Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useTranslation} from 'react-i18next';
import {ProofUiIcon, type ProofUiIconName} from '../../ProofUiIcon';
import {useProofUiColors} from '../../../theme/proofUi';

export interface SelectOption<T extends string> {value: T; label: string; description?: string;}
interface SelectProps<T extends string> {
  label?: string; value: T; options: ReadonlyArray<SelectOption<T>>; onChange: (next: T) => void;
  placeholder?: string; disabled?: boolean; pickerTitle?: string; testID?: string; icon?: ProofUiIconName;
}

/** Shared radio rows used by the language screen and bottom-sheet pickers. */
export function SelectOptionList<T extends string>({value, options, onChange, testID}: Pick<SelectProps<T>, 'value' | 'options' | 'onChange' | 'testID'>) {
  const colors = useProofUiColors();
  return <View>
    {options.map((option, index) => {
      const selected = option.value === value;
      return <Pressable key={option.value} testID={testID ? `${testID}-option-${option.value}` : undefined}
        accessibilityRole="radio" accessibilityLabel={option.label} accessibilityHint={option.description}
        accessibilityState={{selected}} onPress={() => onChange(option.value)}
        style={({pressed}) => [styles.optionRow, index > 0 && styles.divider, {borderColor: colors.border}, pressed && styles.pressed]}>
        <View style={styles.optionBody}>
          <Text style={[styles.optionLabel, {color: selected ? colors.blue : colors.text}]}>{option.label}</Text>
          {option.description ? <Text style={[styles.optionDescription, {color: colors.secondary}]}>{option.description}</Text> : null}
        </View>
        <View style={[styles.selection, {borderColor: selected ? colors.blue : colors.border, backgroundColor: selected ? colors.blue : colors.card}]}>
          {selected && <ProofUiIcon name="check" size={14} color="#FFFFFF" />}
        </View>
      </Pressable>;
    })}
  </View>;
}

export function Select<T extends string>({label, value, options, onChange, placeholder, disabled, pickerTitle, testID, icon}: SelectProps<T>) {
  const colors = useProofUiColors();
  const {t} = useTranslation();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const current = options.find(option => option.value === value);
  const close = () => setOpen(false);
  const pick = (next: T) => {close(); if (next !== value) onChange(next);};

  return <>
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={[label, current?.label ?? placeholder].filter(Boolean).join(', ')}
      accessibilityState={{disabled: !!disabled, expanded: open}} disabled={disabled} onPress={() => setOpen(true)}
      style={({pressed}) => [styles.row, (pressed || disabled) && styles.pressed]}>
      {icon && <ProofUiIcon name={icon} size={21} color={colors.secondary} />}
      {label ? <Text style={[styles.label, {color: colors.text}]}>{label}</Text> : null}
      <View style={styles.valueRow}>
        <Text style={[styles.value, {color: colors.secondary}]}>{current?.label ?? placeholder ?? value}</Text>
        <ProofUiIcon name="chevron-right" size={18} color={colors.muted} />
      </View>
    </Pressable>
    <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
      <View style={styles.backdrop}>
        <Pressable testID={testID ? `${testID}-dismiss` : undefined} accessibilityRole="button" accessibilityLabel={t('common.cancel')}
          style={StyleSheet.absoluteFillObject} onPress={close} />
        <View accessibilityViewIsModal style={[styles.sheet, {backgroundColor: colors.card, borderColor: colors.border, paddingBottom: Math.max(insets.bottom, 16)}]}>
          <View style={styles.sheetHeader}>
            <Text accessibilityRole="header" style={[styles.sheetTitle, {color: colors.text}]}>{pickerTitle ?? label ?? ''}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={t('common.cancel')} onPress={close} style={styles.close}>
              <ProofUiIcon name="close" size={20} color={colors.secondary} />
            </Pressable>
          </View>
          <ScrollView style={styles.sheetList} keyboardShouldPersistTaps="handled">
            <SelectOptionList value={value} options={options} onChange={pick} testID={testID} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  </>;
}

const styles = StyleSheet.create({
  row: {minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 13, paddingVertical: 16, paddingHorizontal: 16},
  label: {fontSize: 15, lineHeight: 21, fontWeight: '500', flex: 1},
  valueRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 10, flexShrink: 1},
  value: {fontSize: 13, lineHeight: 19, flexShrink: 1}, pressed: {opacity: 0.55},
  backdrop: {flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end'},
  sheet: {borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, paddingHorizontal: 16, maxHeight: '75%'},
  sheetHeader: {flexDirection: 'row', alignItems: 'center', paddingTop: 8, paddingBottom: 4},
  sheetTitle: {flex: 1, fontSize: 17, lineHeight: 24, fontWeight: '600'}, close: {padding: 12, minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center'},
  sheetList: {flexGrow: 0}, optionRow: {flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 64, paddingVertical: 18, paddingHorizontal: 16},
  divider: {borderTopWidth: StyleSheet.hairlineWidth}, optionBody: {flex: 1, gap: 4}, optionLabel: {fontSize: 15, lineHeight: 21, fontWeight: '500'},
  optionDescription: {fontSize: 12, lineHeight: 18}, selection: {width: 23, height: 23, borderRadius: 12, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center'},
});
