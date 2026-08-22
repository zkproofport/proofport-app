import React, {useCallback, useEffect, useState} from 'react';
import {Modal, View, Text, StyleSheet, TouchableOpacity} from 'react-native';
import {useTranslation} from 'react-i18next';
import {useThemeColors} from '../context';
import {Icon} from './ui';
import {
  registerReturnNoticeHandler,
  type ReturnNoticeKind,
} from '../utils/returnNoticeBridge';

/**
 * "Your proof was delivered — now switch back yourself."
 *
 * Shown only when the app could not hand the user back automatically, which on
 * iOS is most of the time: `returnScheme` names an app to open, a web page has
 * no app to name, and outside Chrome there is no scheme that merely brings a
 * browser forward. See `returnToRequester()` in `src/utils/deeplink.ts` for the
 * full decision.
 *
 * Deliberately NOT the ErrorModal. Nothing failed here — the proof was
 * generated and delivered successfully, and the only open question is where the
 * user goes next. Dressing that up in a red icon and an "Error Code: E…" line
 * would tell them something untrue. This is the success-side counterpart of
 * that modal and follows the same shape: a bottom sheet, registered through a
 * bridge so the utility layer can raise it without React in scope, rendered
 * once at the App root next to `<ErrorModal />`.
 */
export const ReturnNoticeModal: React.FC = () => {
  const [kind, setKind] = useState<ReturnNoticeKind | null>(null);
  const {colors} = useThemeColors();
  const {t} = useTranslation();

  useEffect(() => {
    registerReturnNoticeHandler(next => setKind(next));
  }, []);

  const dismiss = useCallback(() => setKind(null), []);
  const visible = kind !== null;
  // `delivered` is the floor, not a guess: an unregistered variant must still
  // produce a readable modal rather than a raw i18n key.
  const variant: ReturnNoticeKind = kind ?? 'delivered';

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={dismiss}>
      <View style={styles.overlay}>
        <View
          style={[
            styles.container,
            {backgroundColor: colors.background.secondary},
          ]}>
          <View
            style={[
              styles.iconCircle,
              {
                backgroundColor: colors.success.background,
                borderColor: colors.success[500],
              },
            ]}>
            <Icon name="check" size="lg" color={colors.success[400]} />
          </View>

          <Text style={[styles.title, {color: colors.text.primary}]}>
            {t(`host.proof.returnNotice.${variant}.title`)}
          </Text>

          <Text style={[styles.description, {color: colors.text.secondary}]}>
            {t(`host.proof.returnNotice.${variant}.description`)}
          </Text>

          <View
            style={[styles.hintBox, {backgroundColor: colors.background.primary}]}>
            <Text style={[styles.hintText, {color: colors.text.tertiary}]}>
              {t('host.proof.returnNotice.hint')}
            </Text>
          </View>

          <TouchableOpacity
            style={[styles.button, {backgroundColor: colors.success[500]}]}
            onPress={dismiss}
            activeOpacity={0.8}>
            <Text style={styles.buttonText}>
              {t('host.proof.returnNotice.dismiss')}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'flex-end',
  },
  container: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    alignItems: 'center',
  },
  iconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 8,
    textAlign: 'center',
  },
  description: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 16,
    paddingHorizontal: 8,
  },
  hintBox: {
    borderRadius: 12,
    padding: 12,
    marginBottom: 20,
    width: '100%',
  },
  hintText: {
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },
  button: {
    paddingVertical: 14,
    paddingHorizontal: 48,
    borderRadius: 12,
    width: '100%',
    alignItems: 'center',
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});
