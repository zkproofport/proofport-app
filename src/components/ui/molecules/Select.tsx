import React, {useState} from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {Icon} from '../atoms/Icon';
import {useThemeColors} from '../../../context';

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  description?: string;
}

interface SelectProps<T extends string> {
  /** Optional row label rendered above / inline with the picker. */
  label?: string;
  value: T;
  options: ReadonlyArray<SelectOption<T>>;
  onChange: (next: T) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Modal title shown when the picker sheet opens. Falls back to `label`. */
  pickerTitle?: string;
}

// Generic Select picker — opens a modal bottom-sheet with the option list
// and a check next to the current value. Scales cleanly when networks
// (or any other enumerable setting) grow past 2-3 entries, which the
// previous pill-toggle did not.
export function Select<T extends string>({
  label,
  value,
  options,
  onChange,
  placeholder,
  disabled,
  pickerTitle,
}: SelectProps<T>) {
  const {colors} = useThemeColors();
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);

  const close = () => setOpen(false);
  const pick = (next: T) => {
    onChange(next);
    close();
  };

  return (
    <>
      <TouchableOpacity
        activeOpacity={0.7}
        disabled={disabled}
        onPress={() => setOpen(true)}
        style={[styles.row, disabled && styles.disabled]}>
        {label ? (
          <Text style={[styles.label, {color: colors.text.primary}]}>{label}</Text>
        ) : null}
        <View style={styles.valueRow}>
          <Text style={[styles.value, {color: colors.text.secondary}]}>
            {current?.label ?? placeholder ?? ''}
          </Text>
          <Icon name="chevron-right" size="md" color={colors.text.tertiary} />
        </View>
      </TouchableOpacity>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={close}>
        <Pressable style={styles.backdrop} onPress={close}>
          <Pressable
            style={[styles.sheet, {backgroundColor: colors.background.secondary, borderColor: colors.border.primary}]}
            onPress={(e) => e.stopPropagation()}>
            <Text style={[styles.sheetTitle, {color: colors.text.primary}]}>
              {pickerTitle ?? label ?? ''}
            </Text>
            <ScrollView style={styles.sheetList}>
              {options.map((opt) => {
                const active = opt.value === value;
                return (
                  <TouchableOpacity
                    key={opt.value}
                    activeOpacity={0.7}
                    onPress={() => pick(opt.value)}
                    style={[styles.optionRow, {borderColor: colors.border.primary}]}>
                    <View style={{flex: 1}}>
                      <Text
                        style={[
                          styles.optionLabel,
                          {color: active ? '#3B82F6' : colors.text.primary},
                        ]}>
                        {opt.label}
                      </Text>
                      {opt.description ? (
                        <Text
                          style={[
                            styles.optionDesc,
                            {color: colors.text.secondary},
                          ]}>
                          {opt.description}
                        </Text>
                      ) : null}
                    </View>
                    {active ? <Text style={styles.checkmark}>✓</Text> : null}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  disabled: {opacity: 0.5},
  label: {fontSize: 15, fontWeight: '500'},
  valueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  value: {fontSize: 15},
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingTop: 14,
    paddingBottom: 28,
    maxHeight: '70%',
  },
  sheetTitle: {
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center',
    paddingBottom: 12,
  },
  sheetList: {
    maxHeight: 360,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  optionLabel: {fontSize: 16, fontWeight: '500'},
  optionDesc: {fontSize: 12, marginTop: 2},
  checkmark: {color: '#3B82F6', fontSize: 18, fontWeight: '700'},
});
