/**
 * MdlKrInputScreen — collects the inputs each mdl_kr predicate circuit
 * needs before kicking off the OmniOne CX flow.
 *
 *  • ownership: disclose_flags bitmask (NAME / BIRTH / SEX / TELNO).
 *               0 = fully anonymous; non-zero requires owner_commit.
 *  • age:       age_threshold (and optional current_year).
 *  • region:    target si/do (one of the 17 Korean administrative regions).
 *
 * No safety-critical defaults are silently applied — the user must pick
 * a region, an age threshold, or at least confirm the anonymous case
 * before the proof flow starts.
 */
import React, {useMemo, useState} from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
  TextInput,
} from 'react-native';
import {useNavigation, useRoute} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import type {RouteProp} from '@react-navigation/native';
import {Button, Card} from '../../components/ui';
import {useThemeColors} from '../../context';
import type {ProofStackParamList} from '../../navigation/types';
import {
  DISCLOSE_NAME,
  DISCLOSE_BIRTH,
  DISCLOSE_SEX,
  DISCLOSE_TELNO,
} from '../../utils/mdlKr';

type Navigation = NativeStackNavigationProp<ProofStackParamList, 'MdlKrInput'>;
type Route = RouteProp<ProofStackParamList, 'MdlKrInput'>;

const SI_DO_OPTIONS: ReadonlyArray<string> = [
  '서울특별시',
  '부산광역시',
  '대구광역시',
  '인천광역시',
  '광주광역시',
  '대전광역시',
  '울산광역시',
  '세종특별자치시',
  '경기도',
  '강원특별자치도',
  '충청북도',
  '충청남도',
  '전라북도',
  '전라남도',
  '경상북도',
  '경상남도',
  '제주특별자치도',
];

const DISCLOSE_OPTIONS: ReadonlyArray<{
  key: 'name' | 'birth' | 'sex' | 'telno';
  bit: number;
  label: string;
  hint: string;
}> = [
  {key: 'name',  bit: DISCLOSE_NAME,  label: '이름',     hint: 'name'},
  {key: 'birth', bit: DISCLOSE_BIRTH, label: '생년월일', hint: 'birth_date'},
  {key: 'sex',   bit: DISCLOSE_SEX,   label: '성별',     hint: 'sex'},
  {key: 'telno', bit: DISCLOSE_TELNO, label: '전화번호', hint: 'telno'},
];

export const MdlKrInputScreen: React.FC = () => {
  const {colors: themeColors} = useThemeColors();
  const navigation = useNavigation<Navigation>();
  const route = useRoute<Route>();
  const variant = route.params.variant;

  const currentYear = new Date().getFullYear();

  // ownership state — per-attribute toggle + text input. The user types
  // in the value they expect their mDL to match; the circuit asserts
  // equality when the corresponding flag bit is set. Blank input with
  // the flag set is rejected by canContinue below.
  const [discloseBits, setDiscloseBits] = useState<Record<string, boolean>>({
    name: false,
    birth: false,
    sex: false,
    telno: false,
  });
  const [expectedName, setExpectedName] = useState('');
  const [expectedBirth, setExpectedBirth] = useState('');
  const [expectedSex, setExpectedSex] = useState('');
  const [expectedTelno, setExpectedTelno] = useState('');

  // age state
  const [ageThresholdText, setAgeThresholdText] = useState('19');

  // region state
  const [selectedRegion, setSelectedRegion] = useState<string | null>(null);

  const discloseFlags = useMemo(() => {
    let f = 0;
    for (const opt of DISCLOSE_OPTIONS) {
      if (discloseBits[opt.key]) f |= opt.bit;
    }
    return f & 0x0f;
  }, [discloseBits]);

  const parsedAgeThreshold = useMemo(() => {
    const n = parseInt(ageThresholdText, 10);
    if (Number.isNaN(n) || n < 0 || n > 150) return null;
    return n;
  }, [ageThresholdText]);

  const canContinue = useMemo(() => {
    if (variant === 'ownership') {
      // For each flagged attribute, the text input must be non-empty.
      // Anonymous (flags == 0) is also allowed.
      if (discloseBits.name  && expectedName.trim().length === 0) return false;
      if (discloseBits.birth && expectedBirth.trim().length === 0) return false;
      if (discloseBits.sex   && expectedSex.trim().length === 0) return false;
      if (discloseBits.telno && expectedTelno.trim().length === 0) return false;
      return true;
    }
    if (variant === 'age') return parsedAgeThreshold !== null;
    if (variant === 'region') return selectedRegion !== null;
    return false;
  }, [variant, parsedAgeThreshold, selectedRegion, discloseBits, expectedName, expectedBirth, expectedSex, expectedTelno]);

  const handleContinue = () => {
    if (!canContinue) return;
    const circuitId = `mdl-kr-${variant}`;
    if (variant === 'ownership') {
      navigation.navigate('ProofGeneration', {
        circuitId,
        mdlKrInputs: {
          variant: 'ownership',
          discloseFlags,
          expectedName:  discloseBits.name  ? expectedName.trim()  : undefined,
          expectedBirth: discloseBits.birth ? expectedBirth.trim() : undefined,
          expectedSex:   discloseBits.sex   ? expectedSex.trim()   : undefined,
          expectedTelno: discloseBits.telno ? expectedTelno.trim() : undefined,
        },
      });
    } else if (variant === 'age') {
      navigation.navigate('ProofGeneration', {
        circuitId,
        mdlKrInputs: {
          variant: 'age',
          ageThreshold: parsedAgeThreshold!,
          currentYear,
        },
      });
    } else if (variant === 'region') {
      navigation.navigate('ProofGeneration', {
        circuitId,
        mdlKrInputs: {variant: 'region', targetRegion: selectedRegion!},
      });
    }
  };

  const heroLabel =
    variant === 'ownership'
      ? '소유권 증명'
      : variant === 'age'
      ? '나이 증명'
      : '거주지 증명';
  const heroTitle =
    variant === 'ownership'
      ? '공개할 속성을 선택하세요'
      : variant === 'age'
      ? '증명할 최소 나이를 정하세요'
      : '거주를 증명할 시/도를 고르세요';
  const heroDesc =
    variant === 'ownership'
      ? '체크한 항목만 owner_commit에 포함됩니다. 아무것도 체크하지 않으면 익명 증명입니다.'
      : variant === 'age'
      ? `회로는 (현재 연도 ${currentYear} - 출생 연도) >= 입력값 인지 검증합니다.`
      : '회로는 OmniOne CX 주소의 첫 토큰이 선택한 시/도와 일치하는지 검증합니다.';

  return (
    <SafeAreaView style={{flex: 1, backgroundColor: themeColors.background.primary}}>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.contentContainer}>
        <Card style={styles.heroCard}>
          <Text style={{fontSize: 11, fontWeight: '600', color: themeColors.info[400], letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 8}}>
            {heroLabel}
          </Text>
          <Text style={{fontSize: 24, fontWeight: '700', color: themeColors.text.primary, letterSpacing: -0.5, marginBottom: 8}}>
            {heroTitle}
          </Text>
          <Text style={{fontSize: 15, color: themeColors.text.secondary, lineHeight: 22}}>
            {heroDesc}
          </Text>
        </Card>

        {variant === 'ownership' && (
          <Card style={styles.sectionCard}>
            <Text style={[styles.sectionLabel, {color: themeColors.text.tertiary}]}>
              공개할 속성 (disclose_flags = 0x{discloseFlags.toString(16).padStart(2, '0')})
            </Text>
            <Text style={{marginTop: 8, fontSize: 13, color: themeColors.text.tertiary}}>
              체크한 항목에 직접 값을 입력하세요. 회로는 입력값과 mDL의 실제 값이 같은지 검증합니다.
            </Text>
            <View style={{marginTop: 12}}>
              {DISCLOSE_OPTIONS.map((opt) => {
                const checked = discloseBits[opt.key];
                const value =
                  opt.key === 'name'  ? expectedName
                  : opt.key === 'birth' ? expectedBirth
                  : opt.key === 'sex'   ? expectedSex
                  : expectedTelno;
                const onChange = (txt: string) => {
                  if (opt.key === 'name')  setExpectedName(txt);
                  else if (opt.key === 'birth') setExpectedBirth(txt);
                  else if (opt.key === 'sex')   setExpectedSex(txt);
                  else if (opt.key === 'telno') setExpectedTelno(txt);
                };
                const keyboard =
                  opt.key === 'birth' || opt.key === 'telno' ? 'number-pad' : 'default';
                const maxLen =
                  opt.key === 'birth' ? 8 : opt.key === 'sex' ? 1 : opt.key === 'telno' ? 16 : 32;
                return (
                  <View
                    key={opt.key}
                    style={[
                      styles.ownershipRow,
                      {
                        borderColor: checked
                          ? themeColors.info[400]
                          : themeColors.border.primary,
                        backgroundColor: themeColors.background.secondary,
                      },
                    ]}>
                    <TouchableOpacity
                      onPress={() =>
                        setDiscloseBits((prev) => ({...prev, [opt.key]: !prev[opt.key]}))
                      }
                      style={styles.ownershipRowHeader}>
                      <View
                        style={[
                          styles.checkbox,
                          {
                            borderColor: checked ? themeColors.info[400] : themeColors.border.primary,
                            backgroundColor: checked ? themeColors.info[400] : 'transparent',
                          },
                        ]}>
                        {checked && (
                          <Text style={{color: 'white', fontWeight: '700', fontSize: 14}}>✓</Text>
                        )}
                      </View>
                      <Text
                        style={{
                          flex: 1,
                          marginLeft: 12,
                          fontSize: 16,
                          fontWeight: '600',
                          color: themeColors.text.primary,
                        }}>
                        {opt.label}
                      </Text>
                      <Text style={{fontSize: 12, color: themeColors.text.tertiary}}>
                        {opt.hint}
                      </Text>
                    </TouchableOpacity>
                    {checked && (
                      <TextInput
                        value={value}
                        onChangeText={onChange}
                        placeholder={
                          opt.key === 'birth' ? 'YYYYMMDD'
                          : opt.key === 'sex' ? 'M / F'
                          : opt.key === 'telno' ? '01012345678'
                          : '홍길동'
                        }
                        placeholderTextColor={themeColors.text.tertiary}
                        keyboardType={keyboard}
                        maxLength={maxLen}
                        autoCapitalize={opt.key === 'sex' ? 'characters' : 'none'}
                        style={[
                          styles.expectedInput,
                          {
                            color: themeColors.text.primary,
                            borderColor: themeColors.border.primary,
                          },
                        ]}
                      />
                    )}
                  </View>
                );
              })}
            </View>
          </Card>
        )}

        {variant === 'age' && (
          <Card style={styles.sectionCard}>
            <Text style={[styles.sectionLabel, {color: themeColors.text.tertiary}]}>
              최소 나이 (age_threshold)
            </Text>
            <TextInput
              value={ageThresholdText}
              onChangeText={setAgeThresholdText}
              keyboardType="number-pad"
              maxLength={3}
              style={[
                styles.numberInput,
                {
                  color: themeColors.text.primary,
                  borderColor: themeColors.border.primary,
                  backgroundColor: themeColors.background.secondary,
                },
              ]}
            />
            <Text style={{marginTop: 8, fontSize: 13, color: themeColors.text.tertiary}}>
              {parsedAgeThreshold !== null
                ? `current_year = ${currentYear}, age_threshold = ${parsedAgeThreshold}`
                : '0..150 사이 정수를 입력하세요'}
            </Text>
          </Card>
        )}

        {variant === 'region' && (
          <Card style={styles.sectionCard}>
            <Text style={[styles.sectionLabel, {color: themeColors.text.tertiary}]}>
              시 / 도
            </Text>
            <View style={{marginTop: 12}}>
              {SI_DO_OPTIONS.map((region) => {
                const selected = selectedRegion === region;
                return (
                  <TouchableOpacity
                    key={region}
                    onPress={() => setSelectedRegion(region)}
                    style={[
                      styles.row,
                      {
                        borderColor: selected
                          ? themeColors.info[400]
                          : themeColors.border.primary,
                        backgroundColor: themeColors.background.secondary,
                      },
                    ]}>
                    <Text
                      style={{
                        fontSize: 16,
                        fontWeight: '600',
                        color: themeColors.text.primary,
                      }}>
                      {region}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </Card>
        )}

        <Button
          title="계속"
          onPress={handleContinue}
          disabled={!canContinue}
          style={styles.continueButton}
        />
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  scrollView: {flex: 1},
  contentContainer: {padding: 16, paddingBottom: 48},
  heroCard: {padding: 20, marginBottom: 12},
  sectionCard: {padding: 16, marginBottom: 12},
  sectionLabel: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 14,
    borderWidth: 1,
    borderRadius: 12,
    marginBottom: 8,
  },
  ownershipRow: {
    padding: 12,
    borderWidth: 1,
    borderRadius: 12,
    marginBottom: 8,
  },
  ownershipRowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderWidth: 2,
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  expectedInput: {
    marginTop: 10,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    backgroundColor: 'transparent',
  },
  numberInput: {
    marginTop: 12,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 18,
    fontWeight: '600',
  },
  continueButton: {marginTop: 16},
});
