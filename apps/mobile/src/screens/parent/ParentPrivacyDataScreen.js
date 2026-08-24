import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useParentAccount } from '../../hooks/useParentAccount';
import { colors, fonts, radius, spacing } from '../../theme';
import {
  AccountIcon,
  ErrorCard,
  LoadingCard,
  ParentAccountHeader,
} from './ParentAccountShared';

function RequestRow({ icon, label, subtitle, tone, onPress, disabled }) {
  return (
    <TouchableOpacity
      style={[styles.actionRow, tone === 'danger' && styles.dangerRow, disabled && styles.disabled]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.72}
      accessibilityRole="button"
    >
      <AccountIcon name={icon} tone={tone} />
      <View style={styles.actionCopy}>
        <Text style={[styles.actionLabel, tone === 'danger' && styles.dangerLabel]}>{label}</Text>
        {subtitle ? <Text style={styles.actionSubtitle}>{subtitle}</Text> : null}
      </View>
      <Ionicons name="chevron-forward" size={17} color={colors.textFaint} />
    </TouchableOpacity>
  );
}

function requestDate(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat('en-CA', { month: 'short', day: 'numeric' }).format(new Date(value));
}

function DeleteRequestSheet({ visible, onClose, onConfirm, submitting }) {
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (visible) {
      setConfirmation('');
      setError('');
    }
  }, [visible]);

  function submit() {
    if (confirmation.trim().toUpperCase() !== 'DELETE') {
      setError('Type DELETE exactly to continue.');
      return;
    }
    onConfirm();
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <TouchableOpacity style={styles.dismissArea} activeOpacity={1} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.grabber} />
          <View style={styles.deleteIcon}>
            <Ionicons name="trash-outline" size={22} color={colors.danger} />
          </View>
          <Text style={styles.sheetTitle}>Request account deletion</Text>
          <Text style={styles.sheetText}>
            Your access will remain active while the center verifies your identity and reviews legally required childcare and billing retention.
          </Text>
          <Text style={styles.confirmLabel}>Type DELETE to confirm <Text style={styles.required}>*</Text></Text>
          <TextInput
            value={confirmation}
            onChangeText={(value) => { setConfirmation(value); setError(''); }}
            autoCapitalize="characters"
            autoCorrect={false}
            placeholder="DELETE"
            placeholderTextColor={colors.textFaint}
            style={[styles.confirmInput, error && styles.confirmInputError]}
          />
          {error ? <Text style={styles.confirmError}>{error}</Text> : null}
          <TouchableOpacity style={[styles.deleteButton, submitting && styles.disabled]} onPress={submit} disabled={submitting}>
            {submitting
              ? <ActivityIndicator color={colors.white} />
              : <Text style={styles.deleteButtonText}>Request deletion</Text>}
          </TouchableOpacity>
          <TouchableOpacity style={styles.keepButton} onPress={onClose} disabled={submitting}>
            <Text style={styles.keepButtonText}>Keep my account</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

export default function ParentPrivacyDataScreen({ navigation }) {
  const account = useParentAccount();
  const [submitting, setSubmitting] = useState('');
  const [cancelling, setCancelling] = useState('');
  const [showDelete, setShowDelete] = useState(false);

  const load = useCallback(() => account.refreshHub().catch(() => {}), [account.refreshHub]);
  useEffect(() => { load(); }, [load]);

  const children = account.hub?.children || [];
  const requests = account.hub?.data_requests
    || (account.hub?.latest_data_request ? [account.hub.latest_data_request] : []);
  const activeRequests = requests.filter((request) => ['requested', 'processing'].includes(request.status));
  const requestByType = Object.fromEntries(activeRequests.map((request) => [request.request_type, request]));
  const guardians = useMemo(() => {
    const people = new Map();
    children.forEach((child) => (child.guardians || []).forEach((guardian) => {
      people.set(guardian.id, guardian.full_name);
    }));
    return [...people.values()];
  }, [children]);

  function explainVisibility() {
    const childNames = children.map((child) => child.first_name).join(' and ') || 'your children';
    const guardianNames = guardians.join(', ') || 'linked guardians';
    Alert.alert(
      `Who can see ${childNames}`,
      `${guardianNames}, authorized educators in the assigned classroom, and center administrators. Other families cannot access these records.`
    );
  }

  async function submitRequest(type) {
    setSubmitting(type);
    try {
      const result = await account.requestDataAction(type);
      if (type === 'deletion') setShowDelete(false);
      Alert.alert(
        type === 'export' ? 'Data export requested' : 'Account deletion requested',
        type === 'export'
          ? 'The center will prepare your family data. You will be notified when it is ready, within 30 days.'
          : 'Your request was sent to the center. Your account remains accessible while identity and record-retention requirements are reviewed.',
      );
      return result;
    } catch (error) {
      Alert.alert('Request failed', error.message);
      return null;
    } finally {
      setSubmitting('');
    }
  }

  function confirmCancel(request) {
    Alert.alert(
      `Cancel ${request.request_type === 'export' ? 'data export' : 'deletion request'}?`,
      'You can submit a new request later.',
      [
        { text: 'Keep request', style: 'cancel' },
        {
          text: 'Cancel request',
          style: 'destructive',
          onPress: async () => {
            setCancelling(request.id);
            try {
              await account.cancelDataRequest(request.id);
            } catch (error) {
              Alert.alert('Could not cancel request', error.message);
            } finally {
              setCancelling('');
            }
          },
        },
      ]
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ParentAccountHeader navigation={navigation} title="Privacy & data" />
      <ScrollView contentContainerStyle={styles.content}>
        {!account.hub && account.loading ? <LoadingCard /> : null}
        {!account.hub && account.error ? <ErrorCard message={account.error} onRetry={load} /> : null}

        <View style={styles.infoCard}>
          <Ionicons name="shield-checkmark-outline" size={22} color={colors.primary} />
          <Text style={styles.infoText}>
            You control your family's data. Child photos and daily records are visible only to linked guardians and authorized center staff.
          </Text>
        </View>

        {activeRequests.map((request) => (
          <View key={request.id} style={styles.statusCard}>
            <View style={styles.statusIcon}>
              <Ionicons name="time-outline" size={17} color={colors.amber} />
            </View>
            <View style={styles.statusCopy}>
              <Text style={styles.statusTitle}>
                {request.request_type === 'export' ? 'Data export in progress' : 'Deletion request under review'}
              </Text>
              <Text style={styles.statusText}>
                Requested {requestDate(request.requested_at)} · {request.status === 'processing' ? 'being reviewed' : 'awaiting review'}
              </Text>
            </View>
            {request.status === 'requested' ? (
              cancelling === request.id
                ? <ActivityIndicator size="small" color={colors.amber} />
                : <TouchableOpacity onPress={() => confirmCancel(request)} accessibilityRole="button">
                    <Text style={styles.cancelRequestText}>Cancel</Text>
                  </TouchableOpacity>
            ) : null}
          </View>
        ))}

        <View style={styles.actions}>
          <RequestRow
            icon="lock-closed-outline"
            label={`Who can see ${children.length === 1 ? children[0].first_name : 'my children'}`}
            subtitle="Guardians and authorized center staff"
            onPress={explainVisibility}
          />
          <RequestRow
            icon="download-outline"
            label="Download my data"
            subtitle="Request an export of your family records"
            disabled={submitting === 'export' || Boolean(requestByType.export)}
            onPress={() => Alert.alert(
              'Request your data?',
              'The center will prepare a secure export within 30 days.',
              [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Request export', onPress: () => submitRequest('export') },
              ]
            )}
          />
          <RequestRow
            icon="document-text-outline"
            label="Privacy policy"
            subtitle="How DailyLog handles your data"
            onPress={() => navigation.navigate('Privacy')}
          />
          <RequestRow
            icon="trash-outline"
            label="Delete my account"
            subtitle="Request removal of your personal access and data"
            tone="danger"
            disabled={submitting === 'deletion' || Boolean(requestByType.deletion)}
            onPress={() => setShowDelete(true)}
          />
        </View>
      </ScrollView>
      <DeleteRequestSheet
        visible={showDelete}
        onClose={() => setShowDelete(false)}
        onConfirm={() => submitRequest('deletion')}
        submitting={submitting === 'deletion'}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: 22, paddingBottom: 44, gap: spacing.md },
  infoCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md,
    backgroundColor: colors.primaryLight, borderRadius: radius.lg,
    padding: spacing.lg,
  },
  infoText: {
    flex: 1, color: colors.textSecondary, fontFamily: fonts.regular,
    fontSize: 12.5, lineHeight: 19,
  },
  statusCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: '#FFFBF2', borderWidth: 1, borderColor: '#F0E2C4',
    borderRadius: radius.lg, padding: spacing.md,
  },
  statusIcon: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  statusCopy: { flex: 1, minWidth: 0 },
  statusTitle: { color: '#8A6A2E', fontFamily: fonts.bold, fontSize: 12.5 },
  statusText: { color: '#8A6A2E', fontFamily: fonts.regular, fontSize: 11.5, lineHeight: 16, marginTop: 2 },
  cancelRequestText: { color: colors.danger, fontFamily: fonts.bold, fontSize: 11.5 },
  actions: { gap: spacing.sm },
  actionRow: {
    minHeight: 70, flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderSoft,
    borderRadius: radius.lg, paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
  },
  dangerRow: { backgroundColor: '#FDF6F6', borderColor: '#F1DADA', marginTop: spacing.xs },
  actionCopy: { flex: 1, minWidth: 0 },
  actionLabel: { color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 14.5 },
  dangerLabel: { color: colors.danger },
  actionSubtitle: {
    color: colors.textFaint, fontFamily: fonts.regular, fontSize: 11.5,
    lineHeight: 16, marginTop: 2,
  },
  disabled: { opacity: 0.5 },
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(23,51,91,0.38)' },
  dismissArea: { flex: 1 },
  sheet: {
    backgroundColor: colors.bg, borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingHorizontal: 24, paddingTop: spacing.md, paddingBottom: 30,
  },
  grabber: { width: 42, height: 5, borderRadius: 3, alignSelf: 'center', backgroundColor: colors.borderStrong, marginBottom: spacing.lg },
  deleteIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.dangerLight, marginBottom: spacing.md },
  sheetTitle: { color: colors.textPrimary, fontFamily: fonts.black, fontSize: 21 },
  sheetText: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, marginTop: spacing.xs, marginBottom: spacing.lg },
  confirmLabel: { color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 13, marginBottom: spacing.sm },
  required: { color: colors.danger },
  confirmInput: { minHeight: 52, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface, paddingHorizontal: spacing.lg, color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 15, letterSpacing: 1 },
  confirmInputError: { borderColor: colors.danger, backgroundColor: '#FDF6F6' },
  confirmError: { color: colors.danger, fontFamily: fonts.regular, fontSize: 12, marginTop: 5 },
  deleteButton: { minHeight: 52, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, backgroundColor: colors.danger, marginTop: spacing.lg },
  deleteButtonText: { color: colors.white, fontFamily: fonts.bold, fontSize: 15 },
  keepButton: { minHeight: 46, alignItems: 'center', justifyContent: 'center', marginTop: spacing.sm },
  keepButtonText: { color: colors.textSecondary, fontFamily: fonts.bold, fontSize: 14 },
});
