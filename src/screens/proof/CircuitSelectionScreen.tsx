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
  visibleNetworkCategories,
  circuitsForCategory,
  type CircuitName,
  type NetworkCategoryId,
} from '../../config';
import type {ProofStackParamList} from '../../navigation/types';

type NavigationProp = NativeStackNavigationProp<ProofStackParamList, 'CircuitSelection'>;

// Both the network list and the "which circuits are in it" answer come from
// src/config/networks.ts, which the More tab reads too.
type CategoryId = NetworkCategoryId;

// The default-network setting (settings.defaultNetwork) is the single source
// of truth for the Verify-tab category. `useSettings` already refreshes on
// focus (useFocusEffect), so the dropdown stays in sync whenever the user
// changes "Default Network" from the More tab.

interface CircuitDescriptor {
  /**
   * The canonical circuit id — the only id this screen deals in.
   *
   * There used to be a second `routeCircuitId` field carrying this app's
   * historical hyphenated spelling, plus an `iconKey` carrying a third. One of
   * those route ids, `'oidc-domain'`, was understood by no table anywhere: it
   * survived only because that entry's `navigate()` ignores its argument, so
   * the value was never looked up and never missed. Passing the canonical id
   * to a screen that resolves canonical ids removes both fields and the trap.
   */
  id: CircuitName;
  titleKey: string;
  descriptionKey: string;
  /** Direct circuit screens (no extra input step). */
  navigate: (nav: NavigationProp, circuitId: CircuitName) => void;
  experimental?: boolean;
  /**
   * i18n key for a shared group header rendered once above the first card
   * that carries it (e.g. the three Korea mDL cards share one
   * "Korea Mobile ID" header instead of repeating it in every title).
   */
  groupKey?: string;
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
    titleKey: 'host.proof.circuitSelection.coinbaseKyc.title',
    descriptionKey: 'host.proof.circuitSelection.coinbaseKyc.description',
    navigate: (nav, id) => nav.navigate('ProofGeneration', {circuitId: id}),
  },
  {
    id: 'coinbase_country_attestation',
    titleKey: 'host.proof.circuitSelection.coinbaseCountry.title',
    descriptionKey: 'host.proof.circuitSelection.coinbaseCountry.description',
    navigate: (nav) => nav.navigate('CountryInput'),
  },
  {
    // Arc Eligibility — the same Coinbase attestation, with the wallet able to
    // sign one EIP-712 action instead of an opaque signal hash. It routes
    // through the action screen because the action is what makes this circuit
    // worth picking by hand; the circuit accepts a request without one, and a
    // dapp that wants that sends it through the SDK.
    //
    // That screen can switch to any other circuit which binds an action, so
    // giwa_attestation's action path is reachable from here too. Its own
    // entry below goes straight to the proof, which is the plain attestation.
    id: 'arc_eligibility',
    titleKey: 'host.proof.circuitSelection.arcEligibility.title',
    descriptionKey: 'host.proof.circuitSelection.arcEligibility.description',
    navigate: (nav, id) => nav.navigate('ArcActionInput', {circuit: id}),
    experimental: true,
  },
  {
    id: 'giwa_attestation',
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
    titleKey: 'host.proof.circuitSelection.mdlKrOwnership.title',
    descriptionKey: 'host.proof.circuitSelection.mdlKrOwnership.description',
    navigate: (nav) => nav.navigate('MdlKrInput', {variant: 'ownership'}),
    experimental: true,
    groupKey: 'host.proof.circuitSelection.mdlKr.title',
  },
  {
    id: 'mdl_kr_age',
    titleKey: 'host.proof.circuitSelection.mdlKrAge.title',
    descriptionKey: 'host.proof.circuitSelection.mdlKrAge.description',
    navigate: (nav) => nav.navigate('MdlKrInput', {variant: 'age'}),
    experimental: true,
    groupKey: 'host.proof.circuitSelection.mdlKr.title',
  },
  {
    id: 'mdl_kr_region',
    titleKey: 'host.proof.circuitSelection.mdlKrRegion.title',
    descriptionKey: 'host.proof.circuitSelection.mdlKrRegion.description',
    navigate: (nav) => nav.navigate('MdlKrInput', {variant: 'region'}),
    experimental: true,
    groupKey: 'host.proof.circuitSelection.mdlKr.title',
  },
  {
    id: 'oidc_domain_attestation',
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
    () =>
      visibleNetworkCategories(developerMode, category).map((n) => ({
        value: n.id,
        label: t(n.labelKey),
      })),
    [t, developerMode, category],
  );


  // Resolve which CircuitName IDs belong in the current category.
  const visibleCircuitIds: ReadonlyArray<CircuitName> = useMemo(
    () => circuitsForCategory(category),
    [category],
  );

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
            visibleCards.map((c, i) => {
              // Render a shared group header once, above the first card that
              // carries a groupKey (so the three Korea mDL cards sit under one
              // "Korea Mobile ID" heading instead of repeating it per title).
              const prev = visibleCards[i - 1];
              const showGroupHeader = !!c.groupKey && c.groupKey !== prev?.groupKey;
              return (
                <React.Fragment key={c.id}>
                  {showGroupHeader && (
                    <Text
                      style={{
                        fontSize: 18,
                        fontWeight: '700',
                        color: themeColors.text.primary,
                        letterSpacing: -0.3,
                        marginTop: 4,
                        marginBottom: 12,
                      }}>
                      {t(c.groupKey!)}
                    </Text>
                  )}
                  <CircuitCard
                    icon={getCircuitIcon(c.id)}
                    title={t(c.titleKey)}
                    description={t(c.descriptionKey)}
                    experimental={c.experimental}
                    experimentalLabel={t('host.proof.circuitSelection.experimentalBadge')}
                    onPress={() => c.navigate(navigation, c.id)}
                  />
                </React.Fragment>
              );
            })
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
