/**
 * ArcActionInputScreen — the EIP-712 action an `arc_eligibility` proof binds to.
 *
 * Every other circuit that needs something from the user has a screen for it:
 * the country list, the OIDC domain, the Korea mDL predicate. Arc had none, so
 * picking "Arc Eligibility" reached the proof screen with no action at all —
 * and the hook, which used to choose its circuit from whether an action was
 * present, quietly produced a COINBASE proof instead. This screen is the
 * missing half; the hook now refuses that combination rather than substituting.
 *
 * In the shipped product a dapp supplies the action through the SDK, and the
 * user never sees this screen. It exists for testing a circuit whose verifier
 * lives only on a testnet, which is why it sits behind Developer Mode with the
 * rest of the Arc network.
 *
 * The user picks an action and fills its fields. Writing your own is one of the
 * choices rather than the only one, because an action a dapp would send is a
 * small, known shape and asking someone to hand-write it invites a typo that
 * reads as a circuit failure. Nothing is defaulted: an incomplete action stops
 * here rather than travelling on as a proof about something nobody chose.
 */
import React, {useCallback, useMemo, useState} from 'react';
import {Text, StyleSheet, SafeAreaView, TextInput, TouchableOpacity, View} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {useTranslation} from 'react-i18next';
import {Button, Card, Divider, Icon, KeyboardSafeScroll, Select} from '../../components/ui';
import type {SelectOption} from '../../components/ui';
import {useThemeColors} from '../../context';
import type {ProofStackParamList} from '../../navigation/types';
import type {TypedAction} from '../../utils/typedAction';
import {CIRCUIT_IDS, getNetworkConfigForCircuit} from '../../config';

type Navigation = NativeStackNavigationProp<ProofStackParamList, 'ArcActionInput'>;

/** The chain the action is signed for. Read from config, never typed in. */
const ARC = getNetworkConfigForCircuit(CIRCUIT_IDS.ARC_ELIGIBILITY);

type FieldId = 'to' | 'amount' | 'nonce';

interface ActionShape {
  /** The EIP-712 struct name — this is what the signature commits to. */
  primaryType: string;
  /** i18n key for the name shown on the card. */
  labelKey: string;
  descKey: string;
  fields: ReadonlyArray<{id: FieldId; type: string}>;
}

/**
 * The actions a dapp on Arc would ask a wallet to authorise. Adding one here is
 * the whole change — the form, the validation and the summary all follow.
 */
const ACTION_SHAPES: ReadonlyArray<ActionShape> = [
  {
    primaryType: 'Deposit',
    labelKey: 'host.proof.arcAction.deposit',
    descKey: 'host.proof.arcAction.depositDesc',
    fields: [
      {id: 'amount', type: 'uint256'},
      {id: 'nonce', type: 'uint256'},
    ],
  },
  {
    primaryType: 'Withdraw',
    labelKey: 'host.proof.arcAction.withdraw',
    descKey: 'host.proof.arcAction.withdrawDesc',
    fields: [
      {id: 'amount', type: 'uint256'},
      {id: 'nonce', type: 'uint256'},
    ],
  },
  {
    primaryType: 'Transfer',
    labelKey: 'host.proof.arcAction.transfer',
    descKey: 'host.proof.arcAction.transferDesc',
    fields: [
      {id: 'to', type: 'address'},
      {id: 'amount', type: 'uint256'},
      {id: 'nonce', type: 'uint256'},
    ],
  },
];

const CUSTOM = 'custom' as const;
type Choice = string | typeof CUSTOM;

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const DIGITS = /^[0-9]+$/;

/**
 * What the screen opens with, so Generate works on the first tap.
 *
 * These are a DEMO's starting values, not a default standing in for a missing
 * one: a real dapp sends the whole action through the SDK and this screen is
 * never reached. Every one of them is on screen and editable, and an edit that
 * breaks the shape still stops here rather than travelling on. The zero
 * address is deliberately not a real contract — nothing is called at signing
 * time, and a plausible-looking address would invite someone to believe the
 * proof was bound to something that exists.
 */
const ZERO = '0x0000000000000000000000000000000000000000';
const STARTING_VALUES: Record<FieldId, string> = {to: ZERO, amount: '1000000', nonce: '1'};

/** The EIP-712 types a hand-written field can have. */
const FIELD_TYPES = ['address', 'uint256', 'string', 'bool', 'bytes32'] as const;
type FieldType = (typeof FIELD_TYPES)[number];
type CustomField = {name: string; type: FieldType; value: string};

/**
 * The rows the custom action opens with.
 *
 * A JSON box stood here until 2026-09-12, which asked a person to hand-write
 * EIP-712 types on a phone keyboard. The circuit hashes whatever is written
 * without reading it, so any structure is provable — that freedom is the point,
 * and it is offered as rows because that is what can be typed on a phone.
 */
const STARTING_CUSTOM: CustomField[] = [
  {name: 'agent', type: 'address', value: '0x0000000000000000000000000000000000000001'},
  {name: 'ceiling', type: 'uint256', value: '5000000'},
  {name: 'memo', type: 'string', value: 'quarterly rebalance only'},
];

const NAME_SHAPE = /^[A-Za-z][A-Za-z0-9_]*$/;
const BYTES32 = /^0x[0-9a-fA-F]{64}$/;

export const ArcActionInputScreen: React.FC = () => {
  const {t} = useTranslation();
  const navigation = useNavigation<Navigation>();
  const {colors: themeColors} = useThemeColors();

  const [choice, setChoice] = useState<Choice>(ACTION_SHAPES[0].primaryType);
  const [appName, setAppName] = useState('MyVault');
  const [contract, setContract] = useState(ZERO);
  const [values, setValues] = useState<Record<FieldId, string>>(STARTING_VALUES);
  const [customName, setCustomName] = useState('GrantAuthority');
  const [customFields, setCustomFields] = useState<CustomField[]>(STARTING_CUSTOM);

  const editField = useCallback((index: number, patch: Partial<CustomField>) => {
    setCustomFields(prev => prev.map((field, at) => (at === index ? {...field, ...patch} : field)));
  }, []);

  const actionOptions: SelectOption<Choice>[] = useMemo(
    () => [
      ...ACTION_SHAPES.map(a => ({
        value: a.primaryType as Choice,
        label: t(a.labelKey),
        description: t(a.descKey),
      })),
      {
        value: CUSTOM,
        label: t('host.proof.arcAction.custom'),
        description: t('host.proof.arcAction.customDesc'),
      },
    ],
    [t],
  );

  const shape = ACTION_SHAPES.find(s => s.primaryType === choice);

  /** The built action, or the first thing wrong with what has been entered. */
  const parsed = useMemo((): {action: TypedAction} | {error: string} => {
    if (!appName.trim()) return {error: t('host.proof.arcAction.errAppName')};
    if (!ADDRESS.test(contract.trim())) return {error: t('host.proof.arcAction.errContract')};

    if (!shape) {
      const name = customName.trim();
      if (!NAME_SHAPE.test(name)) return {error: t('host.proof.arcAction.errActionName')};
      if (!customFields.length) return {error: t('host.proof.arcAction.errNoFields')};

      const seen = new Set<string>();
      const custom: Record<string, string | boolean> = {};
      for (const field of customFields) {
        const fieldName = field.name.trim();
        if (!NAME_SHAPE.test(fieldName)) return {error: t('host.proof.arcAction.errFieldName', {field: field.name || '—'})};
        if (seen.has(fieldName)) return {error: t('host.proof.arcAction.errFieldTwice', {field: fieldName})};
        seen.add(fieldName);

        const value = field.value.trim();
        // A value that does not match its declared type is signed and hashed
        // exactly like a correct one, and only fails at a contract that decodes
        // it — much later, and somewhere else.
        if (field.type === 'address' && !ADDRESS.test(value)) return {error: t('host.proof.arcAction.errAddress', {field: fieldName})};
        if (field.type === 'uint256' && !DIGITS.test(value)) return {error: t('host.proof.arcAction.errNumber', {field: fieldName})};
        if (field.type === 'bytes32' && !BYTES32.test(value)) return {error: t('host.proof.arcAction.errBytes32', {field: fieldName})};
        if (field.type === 'bool' && value !== 'true' && value !== 'false') return {error: t('host.proof.arcAction.errBool', {field: fieldName})};
        if (field.type === 'string' && !value) return {error: t('host.proof.arcAction.errRequired', {field: fieldName})};
        custom[fieldName] = field.type === 'bool' ? value === 'true' : value;
      }

      return {
        action: {
          domain: {name: appName.trim(), version: '1', chainId: ARC.chainId, verifyingContract: contract.trim()},
          types: {[name]: customFields.map(field => ({name: field.name.trim(), type: field.type}))},
          primaryType: name,
          message: custom,
        },
      };
    }

    const message: Record<string, string> = {};
    for (const f of shape.fields) {
      const v = values[f.id].trim();
      if (!v) return {error: t('host.proof.arcAction.errRequired', {field: t(`host.proof.arcAction.field.${f.id}`)})};
      if (f.type === 'address' && !ADDRESS.test(v)) {
        return {error: t('host.proof.arcAction.errAddress', {field: t(`host.proof.arcAction.field.${f.id}`)})};
      }
      if (f.type === 'uint256' && !DIGITS.test(v)) {
        return {error: t('host.proof.arcAction.errNumber', {field: t(`host.proof.arcAction.field.${f.id}`)})};
      }
      message[f.id] = v;
    }

    return {
      action: {
        domain: {
          name: appName.trim(),
          version: '1',
          chainId: ARC.chainId,
          verifyingContract: contract.trim(),
        },
        types: {[shape.primaryType]: shape.fields.map(f => ({name: f.id, type: f.type}))},
        primaryType: shape.primaryType,
        message,
      },
    };
  }, [shape, appName, contract, values, customName, customFields, t]);

  const error = 'error' in parsed ? parsed.error : null;

  const start = useCallback(() => {
    if (!('action' in parsed)) return;
    // No scope field here, for the same reason the Coinbase, country and
    // Korea mobile-ID screens have none: a dapp supplies it through the deep
    // link and a person testing on their own has no reason to choose one.
    // The proof screen settles it, identically for every circuit.
    navigation.navigate('ProofGeneration', {
      circuitId: CIRCUIT_IDS.ARC_ELIGIBILITY,
      action: parsed.action,
    });
  }, [navigation, parsed]);

  const inputStyle = (filled: boolean) => ({
    backgroundColor: themeColors.background.secondary,
    borderWidth: 1.5,
    borderColor: filled ? themeColors.info[500] : themeColors.border.primary,
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    color: themeColors.text.primary,
  });

  return (
    <SafeAreaView style={{flex: 1, backgroundColor: themeColors.background.primary}}>
      <KeyboardSafeScroll
        style={styles.scrollView}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}>

        <Card style={styles.sectionCard}>
          <Text style={[styles.eyebrow, {color: themeColors.info[400]}]}>
            {t('host.proof.arcAction.heroLabel')}
          </Text>
          <Text style={[styles.heroTitle, {color: themeColors.text.primary}]}>
            {t('host.proof.arcAction.title')}
          </Text>
          <Text style={[styles.hint, {color: themeColors.text.secondary}]}>
            {t('host.proof.arcAction.description')}
          </Text>
        </Card>

        <Card style={styles.sectionCard}>
          <Select<Choice>
            label={t('host.proof.arcAction.actionLabel')}
            value={choice}
            options={actionOptions}
            onChange={setChoice}
            pickerTitle={t('host.proof.arcAction.actionLabel')}
          />
        </Card>

        {shape ? (
          <>
            <Card style={styles.sectionCard}>
              <Text style={[styles.eyebrow, {color: themeColors.text.tertiary}]}>
                {t('host.proof.arcAction.contractLabel')}
              </Text>
              <Text style={[styles.fieldName, {color: themeColors.text.secondary}]}>
                {t('host.proof.arcAction.appNameLabel')}
              </Text>
              <TextInput
                style={[inputStyle(!!appName), styles.field]}
                placeholder={t('host.proof.arcAction.appNamePlaceholder')}
                placeholderTextColor={themeColors.text.disabled}
                value={appName}
                onChangeText={setAppName}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <Text style={[styles.fieldHint, styles.aboveNext, {color: themeColors.text.tertiary}]}>
                {t('host.proof.arcAction.appNameHint')}
              </Text>

              <Text style={[styles.fieldName, {color: themeColors.text.secondary}]}>
                {t('host.proof.arcAction.contractAddressLabel')}
              </Text>
              <TextInput
                style={inputStyle(ADDRESS.test(contract.trim()))}
                placeholder="0x…"
                placeholderTextColor={themeColors.text.disabled}
                value={contract}
                onChangeText={setContract}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <Text style={[styles.fieldHint, {color: themeColors.text.tertiary}]}>
                {t('host.proof.arcAction.contractHint', {chain: ARC.name, chainId: ARC.chainId})}
              </Text>
            </Card>

            <Card style={styles.sectionCard}>
              <Text style={[styles.eyebrow, {color: themeColors.text.tertiary}]}>
                {t('host.proof.arcAction.valuesLabel')}
              </Text>
              {shape.fields.map(f => (
                <React.Fragment key={f.id}>
                  <Text style={[styles.fieldName, {color: themeColors.text.secondary}]}>
                    {t(`host.proof.arcAction.field.${f.id}`)}
                  </Text>
                  <TextInput
                    style={[inputStyle(!!values[f.id]), styles.field]}
                    placeholder={f.type === 'address' ? '0x…' : '0'}
                    placeholderTextColor={themeColors.text.disabled}
                    value={values[f.id]}
                    onChangeText={v => setValues(prev => ({...prev, [f.id]: v}))}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType={f.type === 'uint256' ? 'number-pad' : 'default'}
                  />
                </React.Fragment>
              ))}
            </Card>
          </>
        ) : (
          <Card style={styles.sectionCard}>
            <Text style={[styles.eyebrow, {color: themeColors.text.tertiary}]}>
              {t('host.proof.arcAction.customLabel')}
            </Text>

            <Text style={[styles.fieldName, {color: themeColors.text.secondary}]}>
              {t('host.proof.arcAction.actionNameLabel')}
            </Text>
            <TextInput
              style={[inputStyle(!!customName), styles.field]}
              placeholder="GrantAuthority"
              placeholderTextColor={themeColors.text.disabled}
              value={customName}
              onChangeText={setCustomName}
              autoCapitalize="none"
              autoCorrect={false}
            />

            {customFields.map((field, index) => (
              <React.Fragment key={index}>
                <Divider />
                <View style={styles.rowHeader}>
                  <Text style={[styles.rowHeading, {color: themeColors.text.tertiary}]}>
                    {t('host.proof.arcAction.fieldNumber', {number: index + 1})}
                  </Text>
                  {customFields.length > 1 && (
                    <TouchableOpacity
                      accessibilityRole="button"
                      accessibilityLabel={t('host.proof.arcAction.removeField', {number: index + 1})}
                      onPress={() => setCustomFields(prev => prev.filter((_, at) => at !== index))}
                      hitSlop={{top: 12, bottom: 12, left: 12, right: 12}}
                      style={styles.rowRemove}>
                      <Icon name="x" size="sm" color={themeColors.text.tertiary} />
                    </TouchableOpacity>
                  )}
                </View>
                <TextInput
                  style={[inputStyle(!!field.name), styles.field]}
                  placeholder={t('host.proof.arcAction.fieldNamePlaceholder')}
                  placeholderTextColor={themeColors.text.disabled}
                  value={field.name}
                  onChangeText={name => editField(index, {name})}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <Select<FieldType>
                  label={t('host.proof.arcAction.fieldTypeLabel')}
                  value={field.type}
                  options={FIELD_TYPES.map(type => ({value: type, label: type}))}
                  onChange={type => editField(index, {type})}
                  pickerTitle={t('host.proof.arcAction.fieldTypeLabel')}
                />
                <TextInput
                  style={[inputStyle(!!field.value), styles.field]}
                  placeholder={t('host.proof.arcAction.fieldValuePlaceholder')}
                  placeholderTextColor={themeColors.text.disabled}
                  value={field.value}
                  onChangeText={value => editField(index, {value})}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType={field.type === 'uint256' ? 'number-pad' : 'default'}
                />
              </React.Fragment>
            ))}

            <TouchableOpacity
              accessibilityRole="button"
              onPress={() => setCustomFields(prev => [...prev, {name: '', type: 'string', value: ''}])}
              style={[styles.addField, {borderColor: themeColors.border.primary}]}>
              <Icon name="plus" size="sm" color={themeColors.info[400]} />
              <Text style={[styles.addFieldText, {color: themeColors.info[400]}]}>
                {t('host.proof.arcAction.addField')}
              </Text>
            </TouchableOpacity>
          </Card>
        )}

        <Card style={{...styles.sectionCard, backgroundColor: themeColors.background.tertiary}}>
          <Text style={[styles.eyebrow, {color: themeColors.text.tertiary}]}>
            {t('host.proof.arcAction.summaryLabel')}
          </Text>
          <Text
            style={[
              styles.summary,
              {color: error ? themeColors.warning[400] : themeColors.info[400]},
            ]}>
            {error ??
              t('host.proof.arcAction.summary', {
                action: shape ? t(shape.labelKey) : (parsed as {action: TypedAction}).action.primaryType,
                app: shape ? appName.trim() : (parsed as {action: TypedAction}).action.domain.name,
              })}
          </Text>
        </Card>

        <Button
          title={t('host.proof.arcAction.generate')}
          onPress={start}
          disabled={!!error}
          size="large"
          style={styles.continueButton}
        />
      </KeyboardSafeScroll>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  scrollView: {flex: 1},
  contentContainer: {paddingHorizontal: 16, paddingTop: 16, paddingBottom: 32},
  sectionCard: {marginBottom: 16},
  eyebrow: {fontSize: 11, fontWeight: '600', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 12},
  heroTitle: {fontSize: 24, fontWeight: '700', letterSpacing: -0.5, marginBottom: 8},
  hint: {fontSize: 15, lineHeight: 22},
  field: {marginBottom: 10},
  fieldName: {fontSize: 13, fontWeight: '600', marginBottom: 6},
  fieldHint: {fontSize: 13, marginTop: 8, lineHeight: 18},
  aboveNext: {marginBottom: 16},
  rowHeader: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4, marginBottom: 8},
  rowHeading: {fontSize: 12, fontWeight: '600', letterSpacing: 0.5, textTransform: 'uppercase'},
  rowRemove: {padding: 4},
  addField: {flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderWidth: 1.5, borderStyle: 'dashed', borderRadius: 12, marginTop: 4},
  addFieldText: {fontSize: 15, fontWeight: '600'},
  summary: {fontSize: 14, fontStyle: 'italic', lineHeight: 20},
  continueButton: {marginBottom: 16},
});

export default ArcActionInputScreen;
