import React, { useState } from 'react';
import {
  Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Button, Input } from '../../components/ui';
import { useParentBilling } from '../../hooks/useParentBilling';
import { colors, fonts, radius, spacing } from '../../theme';
import { ScreenHeader, sharedStyles } from './ParentBillingShared';

function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

function formatCard(value) {
  return digits(value).slice(0, 16).replace(/(.{4})/g, '$1 ').trim();
}

function formatExpiry(value) {
  const clean = digits(value).slice(0, 4);
  return clean.length > 2 ? `${clean.slice(0, 2)}/${clean.slice(2)}` : clean;
}

function validLuhn(value) {
  const number = digits(value);
  if (number.length < 13 || number.length > 19) return false;
  let sum = 0;
  let double = false;
  for (let index = number.length - 1; index >= 0; index -= 1) {
    let digit = Number(number[index]);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

function cardBrand(number) {
  const clean = digits(number);
  if (clean.startsWith('4')) return 'Visa';
  if (/^5[1-5]/.test(clean) || /^2(2[2-9]|[3-6]|7[01]|720)/.test(clean)) return 'Mastercard';
  if (/^3[47]/.test(clean)) return 'Amex';
  return 'Card';
}

function expiryParts(value) {
  const clean = digits(value);
  if (clean.length !== 4) return null;
  const month = Number(clean.slice(0, 2));
  const year = 2000 + Number(clean.slice(2));
  if (month < 1 || month > 12) return null;
  return { month, year };
}

export default function ParentAddPaymentMethodScreen({ navigation }) {
  const { addDemoPaymentMethod } = useParentBilling();
  const [methodType, setMethodType] = useState('card');
  const [name, setName] = useState('');
  const [cardNumber, setCardNumber] = useState('');
  const [expiry, setExpiry] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [accountType, setAccountType] = useState('Checking');
  const [institution, setInstitution] = useState('');
  const [transit, setTransit] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [makeDefault, setMakeDefault] = useState(true);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  function clear(field, setter, transform = (value) => value) {
    return (value) => {
      setter(transform(value));
      setErrors((current) => ({ ...current, [field]: '', form: '' }));
    };
  }

  function useTestDetails() {
    const year = String((new Date().getFullYear() + 2) % 100).padStart(2, '0');
    setName('Lucia Castillo');
    setCardNumber('4242 4242 4242 4242');
    setExpiry(`12/${year}`);
    setPostalCode('M5V 2T6');
    setErrors({});
  }

  function validate() {
    const next = {};
    if (!name.trim()) next.name = 'Account holder name is required.';
    if (methodType === 'card') {
      if (!cardNumber) next.cardNumber = 'Card number is required.';
      else if (!validLuhn(cardNumber)) next.cardNumber = 'Enter a valid test card number.';
      const parsed = expiryParts(expiry);
      if (!parsed) next.expiry = 'Enter expiry as MM/YY.';
      else {
        const now = new Date();
        if (parsed.year < now.getFullYear() || (parsed.year === now.getFullYear() && parsed.month < now.getMonth() + 1)) {
          next.expiry = 'This card has expired.';
        }
      }
      if (!postalCode.trim()) next.postalCode = 'Billing postal code is required.';
    } else {
      if (!/^\d{3}$/.test(institution)) next.institution = 'Enter the 3-digit institution number.';
      if (!/^\d{5}$/.test(transit)) next.transit = 'Enter the 5-digit transit number.';
      if (!/^\d{7,12}$/.test(accountNumber)) next.accountNumber = 'Enter a 7–12 digit account number.';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function save() {
    if (!validate()) return;
    const parsedExpiry = methodType === 'card' ? expiryParts(expiry) : null;
    const sourceNumber = methodType === 'card' ? digits(cardNumber) : accountNumber;
    setSaving(true);
    try {
      await addDemoPaymentMethod({
        methodType,
        brand: methodType === 'card' ? cardBrand(cardNumber) : accountType,
        last4: sourceNumber.slice(-4),
        expiryMonth: parsedExpiry?.month,
        expiryYear: parsedExpiry?.year,
        makeDefault,
      });
      navigation.goBack();
    } catch (saveError) {
      setErrors({ form: saveError.message });
    } finally {
      setSaving(false);
    }
  }

  function changeType(nextType) {
    setMethodType(nextType);
    setErrors({});
  }

  return (
    <SafeAreaView style={sharedStyles.safeArea} edges={['top']}>
      <ScreenHeader navigation={navigation} title="Add payment method" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.testNotice}>
            <Ionicons name="flask-outline" size={21} color={colors.amber} />
            <View style={styles.noticeCopy}>
              <Text style={styles.noticeTitle}>Test payment method</Text>
              <Text style={styles.noticeText}>This development build saves only the final four digits. It never sends these details to a card or banking network.</Text>
            </View>
          </View>

          <Text style={styles.sectionLabel}>Method type</Text>
          <View style={styles.segment}>
            {[
              ['card', 'card-outline', 'Card'],
              ['bank', 'business-outline', 'Bank account'],
            ].map(([value, icon, label]) => (
              <TouchableOpacity key={value} style={[styles.segmentButton, methodType === value && styles.segmentSelected]} onPress={() => changeType(value)}>
                <Ionicons name={icon} size={18} color={methodType === value ? colors.primary : colors.textMuted} />
                <Text style={[styles.segmentText, methodType === value && styles.segmentTextSelected]}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Input
            label="Account holder name (required)"
            value={name}
            onChangeText={clear('name', setName)}
            placeholder="Full legal name"
            autoCapitalize="words"
            autoComplete="name"
            error={errors.name}
          />

          {methodType === 'card' ? (
            <>
              <Input
                label="Card number (required)"
                value={cardNumber}
                onChangeText={clear('cardNumber', setCardNumber, formatCard)}
                placeholder="4242 4242 4242 4242"
                keyboardType="number-pad"
                autoComplete="cc-number"
                error={errors.cardNumber}
              />
              <View style={styles.fieldRow}>
                <Input
                  label="Expiry (required)"
                  value={expiry}
                  onChangeText={clear('expiry', setExpiry, formatExpiry)}
                  placeholder="MM/YY"
                  keyboardType="number-pad"
                  autoComplete="cc-exp"
                  error={errors.expiry}
                  style={styles.halfField}
                />
                <Input
                  label="Postal code (required)"
                  value={postalCode}
                  onChangeText={clear('postalCode', setPostalCode, (value) => value.toUpperCase().slice(0, 7))}
                  placeholder="M5V 2T6"
                  autoCapitalize="characters"
                  autoComplete="postal-code"
                  error={errors.postalCode}
                  style={styles.halfField}
                />
              </View>
              <TouchableOpacity style={styles.testDetailsButton} onPress={useTestDetails}>
                <Text style={styles.testDetailsText}>Fill safe test details</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={styles.sectionLabel}>Account type</Text>
              <View style={styles.segment}>
                {['Checking', 'Savings'].map((value) => (
                  <TouchableOpacity key={value} style={[styles.segmentButton, accountType === value && styles.segmentSelected]} onPress={() => setAccountType(value)}>
                    <Text style={[styles.segmentText, accountType === value && styles.segmentTextSelected]}>{value}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={styles.fieldRow}>
                <Input label="Institution (required)" value={institution} onChangeText={clear('institution', setInstitution, (value) => digits(value).slice(0, 3))} placeholder="001" keyboardType="number-pad" error={errors.institution} style={styles.halfField} />
                <Input label="Transit (required)" value={transit} onChangeText={clear('transit', setTransit, (value) => digits(value).slice(0, 5))} placeholder="12345" keyboardType="number-pad" error={errors.transit} style={styles.halfField} />
              </View>
              <Input label="Account number (required)" value={accountNumber} onChangeText={clear('accountNumber', setAccountNumber, (value) => digits(value).slice(0, 12))} placeholder="7–12 digits" keyboardType="number-pad" secureTextEntry error={errors.accountNumber} />
              <Text style={styles.microcopy}>Production bank accounts will require provider verification before they can be charged.</Text>
            </>
          )}

          <View style={styles.defaultCard}>
            <View style={styles.defaultCopy}>
              <Text style={styles.defaultTitle}>Make this the default</Text>
              <Text style={styles.defaultText}>Use it first for invoice payments and autopay.</Text>
            </View>
            <Switch value={makeDefault} onValueChange={setMakeDefault} trackColor={{ false: colors.border, true: colors.success }} thumbColor={colors.white} />
          </View>

          {errors.form ? <Text style={styles.formError}>{errors.form}</Text> : null}
          {Object.keys(errors).some((key) => key !== 'form' && errors[key]) ? <Text style={styles.checkFields}>Check the highlighted required fields.</Text> : null}
          <Button label="Add payment method" onPress={save} loading={saving} style={styles.saveButton} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingHorizontal: 22, paddingTop: spacing.lg, paddingBottom: 44 },
  testNotice: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, backgroundColor: colors.amberLight, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.lg },
  noticeCopy: { flex: 1 },
  noticeTitle: { color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 14 },
  noticeText: { color: colors.amber, fontFamily: fonts.regular, fontSize: 12, lineHeight: 18, marginTop: 3 },
  sectionLabel: { color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 13.5, marginBottom: spacing.sm },
  segment: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg },
  segmentButton: { flex: 1, minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface },
  segmentSelected: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  segmentText: { color: colors.textMuted, fontFamily: fonts.bold, fontSize: 13 },
  segmentTextSelected: { color: colors.primary },
  fieldRow: { flexDirection: 'row', gap: spacing.md },
  halfField: { flex: 1, minWidth: 0 },
  testDetailsButton: { alignSelf: 'flex-start', minHeight: 38, justifyContent: 'center', marginTop: -spacing.sm, marginBottom: spacing.md },
  testDetailsText: { color: colors.primary, fontFamily: fonts.bold, fontSize: 13 },
  microcopy: { color: colors.textFaint, fontFamily: fonts.regular, fontSize: 11.5, lineHeight: 17, marginTop: -spacing.sm, marginBottom: spacing.md },
  defaultCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.primaryLight, borderRadius: radius.lg, padding: spacing.lg, marginTop: spacing.sm },
  defaultCopy: { flex: 1, minWidth: 0, paddingRight: spacing.sm },
  defaultTitle: { color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 14 },
  defaultText: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, marginTop: 2, flexShrink: 1 },
  formError: { color: colors.danger, fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, backgroundColor: colors.dangerLight, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.lg },
  checkFields: { color: colors.danger, fontFamily: fonts.bold, fontSize: 12.5, marginTop: spacing.md },
  saveButton: { marginTop: spacing.lg },
});
