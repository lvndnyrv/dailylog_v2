import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator, Alert, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useParentBilling } from '../../hooks/useParentBilling';
import { colors, fonts, radius, spacing } from '../../theme';
import { isPaymentMethodExpired, money, PaymentMethodRow, ScreenHeader, sharedStyles, shortDate } from './ParentBillingShared';

export default function ParentPaymentMethodsScreen({ navigation }) {
  const { home, loading, error, refresh, setPreferences, removePaymentMethod } = useParentBilling();
  const [saving, setSaving] = useState(false);

  useFocusEffect(useCallback(() => {
    refresh().catch(() => {});
  }, [refresh]));

  const preferences = home?.preferences || {};
  const methods = home?.payment_methods || [];
  const selectedId = preferences.default_payment_method_id || methods.find((method) => !isPaymentMethodExpired(method))?.id || null;
  const selected = methods.find((method) => method.id === selectedId);

  async function save(autopayEnabled, paymentMethodId) {
    setSaving(true);
    try {
      await setPreferences(autopayEnabled, paymentMethodId);
    } catch (saveError) {
      Alert.alert('Could not save billing settings', saveError.message);
    } finally {
      setSaving(false);
    }
  }

  function toggleAutopay(enabled) {
    if (enabled && !selectedId) {
      Alert.alert('Add a payment method', 'A payment method is required before autopay can be enabled.');
      return;
    }
    if (enabled && isPaymentMethodExpired(selected)) {
      Alert.alert('Card expired', 'Add or select a current payment method before enabling autopay.');
      return;
    }
    save(enabled, selectedId);
  }

  function chooseMethod(methodId) {
    const method = methods.find((item) => item.id === methodId);
    if (isPaymentMethodExpired(method)) {
      Alert.alert('Card expired', 'Add a current card before selecting this payment method.');
      return;
    }
    save(Boolean(preferences.autopay_enabled), methodId);
  }

  function addMethod() {
    navigation.navigate('ParentAddPaymentMethod');
  }

  function confirmRemove() {
    if (!selected) return;
    Alert.alert(
      'Remove payment method?',
      `${selected.brand} ···· ${selected.last4} will no longer be available for new payments.${preferences.autopay_enabled ? ' If no other current method is available, autopay will turn off.' : ''}`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            setSaving(true);
            try {
              await removePaymentMethod(selected.id);
            } catch (removeError) {
              Alert.alert('Could not remove method', removeError.message);
            } finally {
              setSaving(false);
            }
          },
        },
      ],
    );
  }

  return (
    <SafeAreaView style={sharedStyles.safeArea} edges={['top']}>
      <ScreenHeader navigation={navigation} title="Autopay & methods" />
      {!home && loading ? <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View> : null}
      {error && !home ? (
        <View style={styles.center}>
          <Text style={styles.error}>{error}</Text>
          <TouchableOpacity onPress={() => refresh().catch(() => {})}><Text style={styles.retry}>Try again</Text></TouchableOpacity>
        </View>
      ) : null}
      {home ? (
        <ScrollView contentContainerStyle={sharedStyles.content}>
          <View style={styles.autopayCard}>
            <View style={styles.autopayCopy}>
              <Text style={styles.autopayTitle}>Autopay</Text>
              <Text style={styles.autopayText}>Charge the balance automatically on the due date</Text>
            </View>
            {saving ? <ActivityIndicator style={styles.switchLoader} color={colors.primary} /> : (
              <Switch
                value={Boolean(preferences.autopay_enabled)}
                onValueChange={toggleAutopay}
                trackColor={{ false: colors.border, true: colors.success }}
                thumbColor={colors.white}
              />
            )}
          </View>

          {preferences.autopay_enabled && selected ? (
            <View style={[styles.nextChargeCard, isPaymentMethodExpired(selected) && styles.expiredChargeCard]}>
              <Text style={[styles.nextChargeText, isPaymentMethodExpired(selected) && styles.expiredChargeText]}>
                {isPaymentMethodExpired(selected) ? (
                  <>Autopay needs attention. <Text style={styles.nextChargeStrong}>{selected.brand} ···· {selected.last4}</Text> has expired. Add a current method before the next due date.</>
                ) : home.current_balance_cents > 0 && home.next_due_on ? (
                  <>Next charge: <Text style={styles.nextChargeStrong}>{money(home.current_balance_cents)} on {shortDate(home.next_due_on)}</Text> to {selected.brand} ···· {selected.last4}. A receipt will be saved to your account.</>
                ) : (
                  <>Autopay is ready. Future balances will charge to <Text style={styles.nextChargeStrong}>{selected.brand} ···· {selected.last4}</Text> on their due date.</>
                )}
              </Text>
            </View>
          ) : null}

          <Text style={styles.sectionTitle}>Payment methods</Text>
          <View style={styles.methodList}>
            {methods.map((method) => (
              <PaymentMethodRow
                key={method.id}
                method={method}
                selected={method.id === selectedId}
                badge={method.id === selectedId ? 'Default' : null}
                disabled={saving}
                onPress={() => chooseMethod(method.id)}
              />
            ))}
            <TouchableOpacity style={styles.addMethod} onPress={addMethod}>
              <Ionicons name="add" size={20} color={colors.primary} />
              <Text style={styles.addMethodText}>Add payment method</Text>
            </TouchableOpacity>
          </View>

          {selected ? (
            <TouchableOpacity style={styles.removeButton} onPress={confirmRemove} disabled={saving}>
              <Ionicons name="trash-outline" size={17} color={colors.danger} />
              <Text style={styles.removeText}>Remove {selected.brand} ···· {selected.last4}</Text>
            </TouchableOpacity>
          ) : null}

          <View style={styles.demoCard}>
            <Ionicons name="flask-outline" size={19} color={colors.amber} />
            <Text style={styles.demoText}>The Visa and bank account on this screen are test data. They never contact a payment network.</Text>
          </View>
        </ScrollView>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  error: { color: colors.danger, fontFamily: fonts.regular, fontSize: 14, textAlign: 'center' },
  retry: { color: colors.primary, fontFamily: fonts.bold, fontSize: 14, marginTop: spacing.md },
  autopayCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.sm, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.primaryLight, borderRadius: 16, padding: spacing.lg },
  autopayCopy: { flex: 1 },
  autopayTitle: { color: colors.textPrimary, fontFamily: fonts.black, fontSize: 15 },
  autopayText: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 12.5, lineHeight: 18, marginTop: 2 },
  switchLoader: { width: 50 },
  nextChargeCard: { backgroundColor: colors.primaryLight, borderRadius: radius.lg, paddingHorizontal: 15, paddingVertical: spacing.md, marginTop: spacing.lg },
  nextChargeText: { color: colors.textSecondary, fontFamily: fonts.regular, fontSize: 12.5, lineHeight: 19 },
  expiredChargeCard: { backgroundColor: colors.dangerLight },
  expiredChargeText: { color: colors.danger },
  nextChargeStrong: { color: colors.textPrimary, fontFamily: fonts.bold },
  sectionTitle: { color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 13.5, marginTop: spacing.lg, marginBottom: spacing.md },
  methodList: { gap: spacing.sm },
  addMethod: { minHeight: 58, flexDirection: 'row', gap: spacing.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.border, borderRadius: radius.lg },
  addMethodText: { color: colors.primary, fontFamily: fonts.bold, fontSize: 14 },
  removeButton: { minHeight: 46, flexDirection: 'row', gap: spacing.sm, alignItems: 'center', justifyContent: 'center', marginTop: spacing.md },
  removeText: { color: colors.danger, fontFamily: fonts.bold, fontSize: 13 },
  demoCard: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, backgroundColor: colors.amberLight, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.lg },
  demoText: { flex: 1, color: colors.amber, fontFamily: fonts.regular, fontSize: 12, lineHeight: 18 },
});
