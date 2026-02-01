import React, {useState} from 'react';
import {View, Text, StyleSheet, SafeAreaView, ScrollView, TouchableOpacity} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {Button, Card} from '../../components/ui';
import {colors} from '../../theme';
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
  const navigation = useNavigation<NavigationProp>();
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
      return 'Select at least one country to continue';
    }
    const verb = isIncluded ? 'IS one of' : 'is NOT one of';
    const countryNames = selectedCountries
      .map(code => COUNTRY_OPTIONS.find(c => c.code === code)?.name || code)
      .join(', ');
    return `Prove that your country ${verb}: ${countryNames}`;
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}>

        <Card style={styles.heroCard}>
          <Text style={styles.heroLabel}>COUNTRY VERIFICATION</Text>
          <Text style={styles.heroTitle}>Country Verification</Text>
          <Text style={styles.heroDescription}>
            Select countries for verification and choose whether to prove inclusion or exclusion
          </Text>
        </Card>

        <Card style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionLabel}>SELECTED COUNTRIES</Text>
            <Text style={styles.countIndicator}>
              {selectedCountries.length}/{MAX_COUNTRIES}
            </Text>
          </View>

          {selectedCountries.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>No countries selected</Text>
              <Text style={styles.emptyHint}>Tap countries below to add them</Text>
            </View>
          ) : (
            <View style={styles.chipContainer}>
              {selectedCountries.map(code => (
                <View key={code} style={styles.chip}>
                  <Text style={styles.chipText}>
                    {COUNTRY_OPTIONS.find(c => c.code === code)?.name || code}
                  </Text>
                  <TouchableOpacity
                    onPress={() => removeCountry(code)}
                    style={styles.chipRemove}
                    hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
                    <Text style={styles.chipRemoveText}>✕</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}
        </Card>

        <Card style={styles.sectionCard}>
          <Text style={styles.sectionLabel}>AVAILABLE COUNTRIES</Text>
          <View style={styles.countryGrid}>
            {COUNTRY_OPTIONS.map(country => {
              const isSelected = selectedCountries.includes(country.code);
              const isDisabled = !isSelected && selectedCountries.length >= MAX_COUNTRIES;
              return (
                <TouchableOpacity
                  key={country.code}
                  style={[
                    styles.countryButton,
                    isSelected && styles.countryButtonSelected,
                    isDisabled && styles.countryButtonDisabled,
                  ]}
                  onPress={() => toggleCountry(country.code)}
                  disabled={isDisabled}>
                  <Text
                    style={[
                      styles.countryCode,
                      isSelected && styles.countryCodeSelected,
                      isDisabled && styles.countryCodeDisabled,
                    ]}>
                    {country.code}
                  </Text>
                  <Text
                    style={[
                      styles.countryName,
                      isSelected && styles.countryNameSelected,
                      isDisabled && styles.countryNameDisabled,
                    ]}>
                    {country.name}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </Card>

        <Card style={styles.sectionCard}>
          <Text style={styles.sectionLabel}>VERIFICATION MODE</Text>

          <TouchableOpacity
            style={[
              styles.modeOption,
              isIncluded && styles.modeOptionSelected,
            ]}
            onPress={() => setIsIncluded(true)}>
            <View style={styles.modeContent}>
              <View style={styles.modeIcon}>
                <Text style={[
                  styles.modeIconText,
                  isIncluded && styles.modeIconTextSelected,
                ]}>
                  ✓
                </Text>
              </View>
              <View style={styles.modeTextContainer}>
                <Text style={[
                  styles.modeTitle,
                  isIncluded && styles.modeTitleSelected,
                ]}>
                  Included
                </Text>
                <Text style={styles.modeDescription}>
                  Prove your country IS in the selected list
                </Text>
              </View>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.modeOption,
              !isIncluded && styles.modeOptionSelected,
            ]}
            onPress={() => setIsIncluded(false)}>
            <View style={styles.modeContent}>
              <View style={styles.modeIcon}>
                <Text style={[
                  styles.modeIconText,
                  !isIncluded && styles.modeIconTextSelected,
                ]}>
                  ✕
                </Text>
              </View>
              <View style={styles.modeTextContainer}>
                <Text style={[
                  styles.modeTitle,
                  !isIncluded && styles.modeTitleSelected,
                ]}>
                  Excluded
                </Text>
                <Text style={styles.modeDescription}>
                  Prove your country is NOT in the selected list
                </Text>
              </View>
            </View>
          </TouchableOpacity>
        </Card>

        <Card style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>SUMMARY</Text>
          <Text style={[
            styles.summaryText,
            selectedCountries.length === 0 && styles.summaryTextWarning,
          ]}>
            {getSummaryText()}
          </Text>
        </Card>

        <Button
          title="Continue to Proof"
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
  container: {
    flex: 1,
    backgroundColor: colors.background.primary,
  },
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
  heroLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.info[400],
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  heroTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.text.primary,
    letterSpacing: -0.5,
    marginBottom: 8,
  },
  heroDescription: {
    fontSize: 15,
    color: colors.text.secondary,
    lineHeight: 22,
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
  sectionLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.text.tertiary,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  countIndicator: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.info[400],
  },
  emptyState: {
    paddingVertical: 24,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 15,
    fontWeight: '500',
    color: colors.text.secondary,
    marginBottom: 4,
  },
  emptyHint: {
    fontSize: 13,
    color: colors.text.tertiary,
  },
  chipContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.info.background,
    borderRadius: 20,
    paddingLeft: 12,
    paddingRight: 8,
    paddingVertical: 6,
    gap: 6,
  },
  chipText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.info[400],
  },
  chipRemove: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(59, 130, 246, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  chipRemoveText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.info[400],
  },
  countryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  countryButton: {
    width: '48%',
    backgroundColor: colors.background.secondary,
    borderWidth: 1.5,
    borderColor: colors.border.primary,
    borderRadius: 12,
    padding: 12,
  },
  countryButtonSelected: {
    borderColor: colors.info[500],
    backgroundColor: colors.info.background,
  },
  countryButtonDisabled: {
    opacity: 0.4,
  },
  countryCode: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text.secondary,
    marginBottom: 4,
    letterSpacing: 0.5,
  },
  countryCodeSelected: {
    color: colors.info[400],
  },
  countryCodeDisabled: {
    color: colors.text.disabled,
  },
  countryName: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.text.tertiary,
  },
  countryNameSelected: {
    color: colors.info[400],
  },
  countryNameDisabled: {
    color: colors.text.disabled,
  },
  modeOption: {
    backgroundColor: colors.background.secondary,
    borderWidth: 1.5,
    borderColor: colors.border.primary,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  modeOptionSelected: {
    borderColor: colors.info[500],
    backgroundColor: colors.info.background,
  },
  modeContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  modeIcon: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: colors.background.tertiary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modeIconText: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text.secondary,
  },
  modeIconTextSelected: {
    color: colors.info[400],
  },
  modeTextContainer: {
    flex: 1,
  },
  modeTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text.primary,
    marginBottom: 4,
  },
  modeTitleSelected: {
    color: colors.info[400],
  },
  modeDescription: {
    fontSize: 13,
    color: colors.text.tertiary,
    lineHeight: 18,
  },
  summaryCard: {
    marginBottom: 24,
    backgroundColor: colors.background.tertiary,
  },
  summaryLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.text.tertiary,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  summaryText: {
    fontSize: 14,
    fontStyle: 'italic',
    color: colors.info[400],
    lineHeight: 20,
  },
  summaryTextWarning: {
    color: colors.warning[400],
  },
  continueButton: {
    marginBottom: 16,
  },
});
