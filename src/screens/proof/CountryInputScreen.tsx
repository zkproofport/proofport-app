import React, {useState} from 'react';
import {View, Text, StyleSheet, SafeAreaView, ScrollView, TouchableOpacity} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {useTranslation} from 'react-i18next';
import {Button, Card} from '../../components/ui';
import {useThemeColors} from '../../context';
import type {ProofStackParamList} from '../../navigation/types';

type NavigationProp = NativeStackNavigationProp<ProofStackParamList, 'CountryInput'>;

const COUNTRY_OPTIONS = [
  {code: 'US', name: 'United States'},
  {code: 'KR', name: 'South Korea'},
  {code: 'JP', name: 'Japan'},
  {code: 'GB', name: 'United Kingdom'},
  {code: 'DE', name: 'Germany'},
  {code: 'FR', name: 'France'},
  {code: 'CA', name: 'Canada'},
  {code: 'AU', name: 'Australia'},
  {code: 'SG', name: 'Singapore'},
  {code: 'BR', name: 'Brazil'},
  {code: 'IN', name: 'India'},
  {code: 'CH', name: 'Switzerland'},
];

const MAX_COUNTRIES = 10;

export const CountryInputScreen: React.FC = () => {
  const { colors: themeColors } = useThemeColors();
  const navigation = useNavigation<NavigationProp>();
  const { t } = useTranslation();
  const [selectedCountries, setSelectedCountries] = useState<string[]>([]);
  const [isIncluded, setIsIncluded] = useState<boolean>(true);

  const toggleCountry = (code: string) => {
    if (selectedCountries.includes(code)) {
      setSelectedCountries(selectedCountries.filter(c => c !== code));
    } else {
      if (selectedCountries.length < MAX_COUNTRIES) {
        setSelectedCountries([...selectedCountries, code]);
      }
    }
  };

  const removeCountry = (code: string) => {
    setSelectedCountries(selectedCountries.filter(c => c !== code));
  };

  const handleContinue = () => {
    navigation.navigate('ProofGeneration', {
      circuitId: 'coinbase-country',
      countryInputs: {
        countryList: selectedCountries,
        isIncluded: isIncluded,
      },
    });
  };

  const getSummaryText = () => {
    if (selectedCountries.length === 0) {
      return t('host.proof.country.summarySelectAtLeastOne');
    }
    const verb = isIncluded
      ? t('host.proof.country.summaryVerbIs')
      : t('host.proof.country.summaryVerbIsNot');
    const countryNames = selectedCountries
      .map(code => COUNTRY_OPTIONS.find(c => c.code === code)?.name || code)
      .join(', ');
    return t('host.proof.country.summaryProve', {verb, countries: countryNames});
  };

  return (
    <SafeAreaView style={{flex: 1, backgroundColor: themeColors.background.primary}}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}>

        <Card style={styles.heroCard}>
          <Text style={{fontSize: 11, fontWeight: '600', color: themeColors.info[400], letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 8}}>
            {t('host.proof.country.heroLabel')}
          </Text>
          <Text style={{fontSize: 24, fontWeight: '700', color: themeColors.text.primary, letterSpacing: -0.5, marginBottom: 8}}>
            {t('host.proof.country.heroTitle')}
          </Text>
          <Text style={{fontSize: 15, color: themeColors.text.secondary, lineHeight: 22}}>
            {t('host.proof.country.heroDescription')}
          </Text>
        </Card>

        <Card style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <Text style={{fontSize: 11, fontWeight: '600', color: themeColors.text.tertiary, letterSpacing: 1.5, textTransform: 'uppercase'}}>
              {t('host.proof.country.selectedLabel')}
            </Text>
            <Text style={{fontSize: 13, fontWeight: '600', color: themeColors.info[400]}}>
              {selectedCountries.length}/{MAX_COUNTRIES}
            </Text>
          </View>

          {selectedCountries.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={{fontSize: 15, fontWeight: '500', color: themeColors.text.secondary, marginBottom: 4}}>
                {t('host.proof.country.noCountriesSelected')}
              </Text>
              <Text style={{fontSize: 13, color: themeColors.text.tertiary}}>
                {t('host.proof.country.tapToAdd')}
              </Text>
            </View>
          ) : (
            <View style={styles.chipContainer}>
              {selectedCountries.map(code => (
                <View key={code} style={{flexDirection: 'row', alignItems: 'center', backgroundColor: themeColors.info.background, borderRadius: 20, paddingLeft: 12, paddingRight: 8, paddingVertical: 6, gap: 6}}>
                  <Text style={{fontSize: 14, fontWeight: '600', color: themeColors.info[400]}}>
                    {COUNTRY_OPTIONS.find(c => c.code === code)?.name || code}
                  </Text>
                  <TouchableOpacity
                    onPress={() => removeCountry(code)}
                    style={styles.chipRemove}
                    hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
                    <Text style={{fontSize: 12, fontWeight: '700', color: themeColors.info[400]}}>✕</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}
        </Card>

        <Card style={styles.sectionCard}>
          <Text style={{fontSize: 11, fontWeight: '600', color: themeColors.text.tertiary, letterSpacing: 1.5, textTransform: 'uppercase'}}>
            {t('host.proof.country.availableLabel')}
          </Text>
          <View style={styles.countryGrid}>
            {COUNTRY_OPTIONS.map(country => {
              const isSelected = selectedCountries.includes(country.code);
              const isDisabled = !isSelected && selectedCountries.length >= MAX_COUNTRIES;
              return (
                <TouchableOpacity
                  key={country.code}
                  style={[
                    {width: '48%', backgroundColor: themeColors.background.secondary, borderWidth: 1.5, borderColor: themeColors.border.primary, borderRadius: 12, padding: 12},
                    isSelected && {borderColor: themeColors.info[500], backgroundColor: themeColors.info.background},
                    isDisabled && {opacity: 0.4},
                  ]}
                  onPress={() => toggleCountry(country.code)}
                  disabled={isDisabled}>
                  <Text
                    style={[
                      {fontSize: 18, fontWeight: '700', color: themeColors.text.secondary, marginBottom: 4, letterSpacing: 0.5},
                      isSelected && {color: themeColors.info[400]},
                      isDisabled && {color: themeColors.text.disabled},
                    ]}>
                    {country.code}
                  </Text>
                  <Text
                    style={[
                      {fontSize: 12, fontWeight: '500', color: themeColors.text.tertiary},
                      isSelected && {color: themeColors.info[400]},
                      isDisabled && {color: themeColors.text.disabled},
                    ]}>
                    {country.name}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </Card>

        <Card style={styles.sectionCard}>
          <Text style={{fontSize: 11, fontWeight: '600', color: themeColors.text.tertiary, letterSpacing: 1.5, textTransform: 'uppercase'}}>
            {t('host.proof.country.modeLabel')}
          </Text>

          <TouchableOpacity
            style={[
              {backgroundColor: themeColors.background.secondary, borderWidth: 1.5, borderColor: themeColors.border.primary, borderRadius: 12, padding: 16, marginBottom: 12},
              isIncluded && {borderColor: themeColors.info[500], backgroundColor: themeColors.info.background},
            ]}
            onPress={() => setIsIncluded(true)}>
            <View style={styles.modeContent}>
              <View style={{width: 36, height: 36, borderRadius: 8, backgroundColor: themeColors.background.tertiary, justifyContent: 'center', alignItems: 'center'}}>
                <Text style={[
                  {fontSize: 18, fontWeight: '700', color: themeColors.text.secondary},
                  isIncluded && {color: themeColors.info[400]},
                ]}>
                  ✓
                </Text>
              </View>
              <View style={styles.modeTextContainer}>
                <Text style={[
                  {fontSize: 16, fontWeight: '600', color: themeColors.text.primary, marginBottom: 4},
                  isIncluded && {color: themeColors.info[400]},
                ]}>
                  {t('host.proof.country.includedTitle')}
                </Text>
                <Text style={{fontSize: 13, color: themeColors.text.tertiary, lineHeight: 18}}>
                  {t('host.proof.country.includedDescription')}
                </Text>
              </View>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              {backgroundColor: themeColors.background.secondary, borderWidth: 1.5, borderColor: themeColors.border.primary, borderRadius: 12, padding: 16, marginBottom: 12},
              !isIncluded && {borderColor: themeColors.info[500], backgroundColor: themeColors.info.background},
            ]}
            onPress={() => setIsIncluded(false)}>
            <View style={styles.modeContent}>
              <View style={{width: 36, height: 36, borderRadius: 8, backgroundColor: themeColors.background.tertiary, justifyContent: 'center', alignItems: 'center'}}>
                <Text style={[
                  {fontSize: 18, fontWeight: '700', color: themeColors.text.secondary},
                  !isIncluded && {color: themeColors.info[400]},
                ]}>
                  ✕
                </Text>
              </View>
              <View style={styles.modeTextContainer}>
                <Text style={[
                  {fontSize: 16, fontWeight: '600', color: themeColors.text.primary, marginBottom: 4},
                  !isIncluded && {color: themeColors.info[400]},
                ]}>
                  {t('host.proof.country.excludedTitle')}
                </Text>
                <Text style={{fontSize: 13, color: themeColors.text.tertiary, lineHeight: 18}}>
                  {t('host.proof.country.excludedDescription')}
                </Text>
              </View>
            </View>
          </TouchableOpacity>
        </Card>

        <Card style={{marginBottom: 24, backgroundColor: themeColors.background.tertiary}}>
          <Text style={{fontSize: 11, fontWeight: '600', color: themeColors.text.tertiary, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 8}}>
            {t('host.proof.country.summaryLabel')}
          </Text>
          <Text style={[
            {fontSize: 14, fontStyle: 'italic', color: themeColors.info[400], lineHeight: 20},
            selectedCountries.length === 0 && {color: themeColors.warning[400]},
          ]}>
            {getSummaryText()}
          </Text>
        </Card>

        <Button
          title={t('host.proof.country.continueButton')}
          onPress={handleContinue}
          disabled={selectedCountries.length === 0}
          size="large"
          style={styles.continueButton}
        />
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
  },
  contentContainer: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 32,
  },
  heroCard: {
    marginBottom: 16,
  },
  sectionCard: {
    marginBottom: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  emptyState: {
    paddingVertical: 24,
    alignItems: 'center',
  },
  chipContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chipRemove: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(59, 130, 246, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  countryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  modeContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  modeTextContainer: {
    flex: 1,
  },
  continueButton: {
    marginBottom: 16,
  },
});
