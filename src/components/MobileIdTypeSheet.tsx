/**
 * MobileIdTypeSheet — bottom sheet that lets the user pick which OmniOne CX
 * mobile-ID document to authenticate with. Shared by the manual proof flow
 * (Ownership / Age / Region) and the OpenStoa mDL login flow: in both cases
 * the user picks an input first, then this sheet selects the document type
 * and proof generation starts immediately on selection.
 */
import React from 'react';
import {Modal, View, Text, Pressable, StyleSheet} from 'react-native';
import {useTranslation} from 'react-i18next';
import {useThemeColors} from '../context';

export type MdlProvider =
  | 'comdl_v1.5'
  | 'comrc_v1.5'
  | 'comnh_v1.5'
  | 'coresidence_v1.5';

interface MobileIdTypeSheetProps {
  visible: boolean;
  onSelect: (provider: MdlProvider) => void;
  onCancel: () => void;
}

const OPTIONS: ReadonlyArray<{value: MdlProvider; labelKey: string}> = [
  {value: 'comdl_v1.5', labelKey: 'host.proof.mdlKrInput.docDriver'},
  {value: 'comrc_v1.5', labelKey: 'host.proof.mdlKrInput.docResident'},
  {value: 'comnh_v1.5', labelKey: 'host.proof.mdlKrInput.docVeteran'},
  {value: 'coresidence_v1.5', labelKey: 'host.proof.mdlKrInput.docAlien'},
];

export const MobileIdTypeSheet: React.FC<MobileIdTypeSheetProps> = ({
  visible,
  onSelect,
  onCancel,
}) => {
  const {t} = useTranslation();
  const {colors} = useThemeColors();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onCancel}
      statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onCancel}>
        <Pressable
          style={[styles.sheet, {backgroundColor: colors.background.primary}]}
          onPress={(e) => e.stopPropagation()}>
          <View style={[styles.handle, {backgroundColor: colors.border.primary}]} />
          <Text style={[styles.title, {color: colors.text.primary}]}>
            {t('host.proof.mdlKrInput.docTypeLabel')}
          </Text>
          {OPTIONS.map((o) => (
            <Pressable
              key={o.value}
              onPress={() => onSelect(o.value)}
              style={({pressed}) => [
                styles.row,
                {
                  borderColor: colors.border.primary,
                  backgroundColor: colors.background.secondary,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}>
              <Text style={{fontSize: 16, fontWeight: '600', color: colors.text.primary}}>
                {t(o.labelKey)}
              </Text>
            </Pressable>
          ))}
          <Pressable onPress={onCancel} style={styles.cancel}>
            <Text style={{fontSize: 15, color: colors.text.secondary}}>
              {t('host.proof.mdlKrInput.docCancel')}
            </Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 36,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    marginBottom: 16,
  },
  title: {fontSize: 18, fontWeight: '700', marginBottom: 16},
  row: {padding: 16, borderWidth: 1, borderRadius: 12, marginBottom: 10},
  cancel: {alignItems: 'center', paddingVertical: 12, marginTop: 4},
});
