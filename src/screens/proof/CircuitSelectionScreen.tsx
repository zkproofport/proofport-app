import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {ScrollView, StyleSheet, Text, View, SafeAreaView} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {useTranslation} from 'react-i18next';
import {CircuitCard, Select, type SelectOption} from '../../components/ui';
import {useThemeColors} from '../../context';
import {useSettings} from '../../hooks';
import {getCircuitIcon} from '../../utils';
import {
  USER_FACING_NETWORKS,
  NETWORK_INDEPENDENT_CIRCUITS,
  isNetworkVisible,
  type CircuitName,
  type NetworkId,
} from '../../config';
import type {ProofStackParamList} from '../../navigation/types';

type NavigationProp = NativeStackNavigationProp<ProofStackParamList, 'CircuitSelection'>;

// "other" lives at the UI layer only — it's a bucket for circuits that
// aren't bound to any specific chain (currently OIDC). All real chains
// come from USER_FACING_NETWORKS in src/config/networks.ts.
type CategoryId = NetworkId | 'other';

const OTHER_KEY = 'other' as const;

// The default-network setting (settings.defaultNetwork) is the single source
// of truth for the Verify-tab category. `useSettings` already refreshes on
// focus (useFocusEffect), so the dropdown stays in sync whenever the user
// changes "Default Network" from the More tab.

interface CircuitDescriptor {
  /** Internal canonical circuit ID matching CircuitName. */
  id: CircuitName;
  /** Route param used by ProofGeneration / CountryInput / DomainInput. */
  routeCircuitId: string;
  iconKey: string;
  titleKey: string;
  descriptionKey: string;
  /** Direct circuit screens (no extra input step). */
  navigate: (nav: NavigationProp, routeCircuitId: string) => void;
  experimental?: boolean;
}

// Single source of truth for the Verify-tab card list. Adding a new
// circuit means:
//   1. Add its CircuitName to config/contracts.ts.
//   2. Append an entry below.
//   3. Make sure its network is listed in USER_FACING_NETWORKS or
//      NETWORK_INDEPENDENT_CIRCUITS.
const CIRCUIT_REGISTRY: ReadonlyArray<CircuitDescriptor> = [
  {
    id: 'coinbase_attestation',
    routeCircuitId: 'coinbase-kyc',
    iconKey: 'coinbase-kyc',
    titleKey: 'host.proof.circuitSelection.coinbaseKyc.title',
    descriptionKey: 'host.proof.circuitSelection.coinbaseKyc.description',
    navigate: (nav, id) => nav.navigate('ProofGeneration', {circuitId: id}),
  },
  {
    id: 'coinbase_country_attestation',
    routeCircuitId: 'coinbase-country',
    iconKey: 'coinbase-country',
    titleKey: 'host.proof.circuitSelection.coinbaseCountry.title',
    descriptionKey: 'host.proof.circuitSelection.coinbaseCountry.description',
    navigate: (nav) => nav.navigate('CountryInput'),
  },
  {
    id: 'giwa_attestation',
    routeCircuitId: 'giwa-kyc',
    iconKey: 'giwa-kyc',
    titleKey: 'host.proof.circuitSelection.giwaKyc.title',
    descriptionKey: 'host.proof.circuitSelection.giwaKyc.description',
    navigate: (nav, id) => nav.navigate('ProofGeneration', {circuitId: id}),
    experimental: true,
  },
  // Korea Mobile ID — three independent Noir circuits sharing the same
  // canonical natural-person commitment. Each card routes through the
  // MdlKrInput screen so the user supplies the predicate parameter
  // (disclose_flags / age_threshold / target si-do) before the proof
  // flow starts.
  {
    id: 'mdl_kr_ownership',
    routeCircuitId: 'mdl-kr-ownership',
    iconKey: 'giwa-kyc',
    titleKey: 'host.proof.circuitSelection.mdlKrOwnership.title',
    descriptionKey: 'host.proof.circuitSelection.mdlKrOwnership.description',
    navigate: (nav) => nav.navigate('MdlKrInput', {variant: 'ownership'}),
    experimental: true,
  },
  {
    id: 'mdl_kr_age',
    routeCircuitId: 'mdl-kr-age',
    iconKey: 'giwa-kyc',
    titleKey: 'host.proof.circuitSelection.mdlKrAge.title',
    descriptionKey: 'host.proof.circuitSelection.mdlKrAge.description',
    navigate: (nav) => nav.navigate('MdlKrInput', {variant: 'age'}),
    experimental: true,
  },
  {
    id: 'mdl_kr_region',
    routeCircuitId: 'mdl-kr-region',
    iconKey: 'giwa-kyc',
    titleKey: 'host.proof.circuitSelection.mdlKrRegion.title',
    descriptionKey: 'host.proof.circuitSelection.mdlKrRegion.description',
    navigate: (nav) => nav.navigate('MdlKrInput', {variant: 'region'}),
    experimental: true,
  },
  {
    id: 'oidc_domain_attestation',
    routeCircuitId: 'oidc-domain',
    iconKey: 'oidc_domain_attestation',
    titleKey: 'host.proof.circuitSelection.oidcDomain.title',
    descriptionKey: 'host.proof.circuitSelection.oidcDomain.description',
    navigate: (nav) => nav.navigate('DomainInput'),
  },
];

export const CircuitSelectionScreen: React.FC = () => {
  const {colors: themeColors} = useThemeColors();
  const navigation = useNavigation<NavigationProp>();
  const {t} = useTranslation();
  const {settings, loading, updateSettings} = useSettings();

  const [category, setCategory] = useState<CategoryId>('base');
  // Keep the picker mirrored on settings.defaultNetwork. useSettings refreshes
  // on screen focus, so changing the default network from the More tab will
  // re-flow into this dropdown on the next focus event.
  useEffect(() => {
    if (!loading && settings) {
      setCategory((settings.defaultNetwork as CategoryId) ?? 'base');
    }
  }, [loading, settings?.defaultNetwork]);

  const handleCategoryChange = useCallback(
    (next: CategoryId) => {
      setCategory(next);
      // Persist back to settings so this picker, the More tab, and any other
      // surface that reads `settings.defaultNetwork` stay in lockstep.
      updateSettings({defaultNetwork: next}).catch((e) => console.error('[Verify] updateSettings failed', e));
    },
    [updateSettings],
  );

  const developerMode = !loading && settings ? settings.developerMode : false;
  const categoryOptions: SelectOption<CategoryId>[] = useMemo(
    () => [
      ...USER_FACING_NETWORKS.filter((n) =>
        isNetworkVisible(n, developerMode, category),
      ).map((n) => ({
        value: n.id as CategoryId,
        label: t(n.labelKey),
      })),
      {
        value: OTHER_KEY,
        label: t('host.proof.circuitSelection.network.other'),
      },
    ],
    [t, developerMode, category],
  );


  // Resolve which CircuitName IDs belong in the current category.
  const visibleCircuitIds: ReadonlyArray<CircuitName> = useMemo(() => {
    if (category === OTHER_KEY) return NETWORK_INDEPENDENT_CIRCUITS;
    const net = USER_FACING_NETWORKS.find((n) => n.id === category);
    return net?.circuits ?? [];
  }, [category]);

  const visibleCards = useMemo(
    () =>
      visibleCircuitIds.flatMap((id) =>
        CIRCUIT_REGISTRY.filter((c) => c.id === id),
      ),
    [visibleCircuitIds],
  );

  return (
    <SafeAreaView style={{flex: 1, backgroundColor: themeColors.background.primary}}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={{fontSize: 32, fontWeight: '700', color: themeColors.text.primary, letterSpacing: -0.5}}>
            {t('host.proof.circuitSelection.title')}
          </Text>
        </View>

        {/* Category picker — same Select used by the More tab. */}
        <View
          style={[
            styles.selectWrap,
            {
              backgroundColor: themeColors.background.secondary,
              borderColor: themeColors.border.primary,
            },
          ]}>
          <Select<CategoryId>
            label={t('host.proof.circuitSelection.network.label')}
            value={category}
            options={categoryOptions}
            onChange={handleCategoryChange}
            pickerTitle={t('host.proof.circuitSelection.network.label')}
          />
        </View>

        <View style={styles.section}>
          <Text style={{fontSize: 14, fontWeight: '600', color: themeColors.text.secondary, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 16}}>
            {t('host.proof.circuitSelection.sectionLabel')}
          </Text>

          {visibleCards.length === 0 ? null : (
            visibleCards.map((c) => (
              <CircuitCard
                key={c.id}
                icon={getCircuitIcon(c.iconKey)}
                title={t(c.titleKey)}
                description={t(c.descriptionKey)}
                experimental={c.experimental}
                experimentalLabel={t('host.proof.circuitSelection.experimentalBadge')}
                onPress={() => c.navigate(navigation, c.routeCircuitId)}
              />
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  scrollView: {flex: 1},
  contentContainer: {paddingHorizontal: 16, paddingBottom: 32},
  header: {paddingVertical: 24},
  selectWrap: {
    borderWidth: 1,
    borderRadius: 12,
    marginBottom: 20,
  },
  section: {marginTop: 8},
});
