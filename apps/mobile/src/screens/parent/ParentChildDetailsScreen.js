import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useParentAccount } from '../../hooks/useParentAccount';
import { useParentFamily } from '../../hooks/useParentFamily';
import { colors, fonts, radius, spacing } from '../../theme';
import {
  ErrorCard,
  ParentAccountHeader,
  initials,
} from './ParentAccountShared';

function readableDate(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat('en-CA', {
    month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(`${value}T12:00:00Z`));
}

function ageLabel(value) {
  if (!value) return '';
  const birth = new Date(`${value}T12:00:00Z`);
  const today = new Date();
  let years = today.getUTCFullYear() - birth.getUTCFullYear();
  const birthdayPassed = today.getUTCMonth() > birth.getUTCMonth()
    || (today.getUTCMonth() === birth.getUTCMonth() && today.getUTCDate() >= birth.getUTCDate());
  if (!birthdayPassed) years -= 1;
  return years > 0 ? `${years} year${years === 1 ? '' : 's'} old` : 'Under 1 year old';
}

function textValue(value, fallback = 'None shared') {
  if (Array.isArray(value)) return value.filter(Boolean).join(', ') || fallback;
  return String(value || '').trim() || fallback;
}

function contactName(contact) {
  return contact?.name || contact?.full_name || contact?.fullName || 'Emergency contact';
}

function contactDetail(contact) {
  const relationship = contact?.relationship || contact?.relation;
  const phone = contact?.phone || contact?.phone_number || contact?.phoneNumber;
  return [relationship, phone].filter(Boolean).join(' · ') || 'Contact details held by the center';
}

function InfoRow({ label, value, last = false }) {
  return (
    <View style={[styles.infoRow, !last && styles.rowDivider]}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

function ActionCard({ icon, label, detail, onPress }) {
  return (
    <TouchableOpacity
      style={styles.actionCard}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <View style={styles.actionIcon}>
        <Ionicons name={icon} size={20} color={colors.primary} />
      </View>
      <View style={styles.actionCopy}>
        <Text style={styles.actionLabel}>{label}</Text>
        <Text style={styles.actionDetail}>{detail}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
    </TouchableOpacity>
  );
}

export default function ParentChildDetailsScreen({ navigation, route }) {
  const account = useParentAccount();
  const family = useParentFamily();
  const childId = route.params?.childId || route.params?.child?.id;
  const [child, setChild] = useState(route.params?.child || null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!childId) {
      setError('Choose a child to view their details.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const details = await account.getChildDetails(childId);
      setChild(details);
      family.selectChild(childId);
    } catch (loadError) {
      setError(loadError.message || 'Child details could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [account.getChildDetails, childId, family.selectChild]);

  useEffect(() => { load(); }, [load]);

  const displayName = child?.preferred_name || child?.first_name || 'Child';
  const fullName = [child?.first_name, child?.last_name].filter(Boolean).join(' ');
  const emergencyContacts = Array.isArray(child?.emergency_contacts) ? child.emergency_contacts : [];

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ParentAccountHeader
        navigation={navigation}
        title={child ? `${displayName}'s details` : 'Child details'}
        subtitle="Profile, care information and family access"
      />

      {loading && !child ? (
        <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>
      ) : error && !child ? (
        <View style={styles.stateWrap}><ErrorCard message={error} onRetry={load} /></View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          {error ? <ErrorCard message={error} onRetry={load} /> : null}

          <View style={styles.heroCard}>
            {child?.photo_url ? (
              <Image source={{ uri: child.photo_url }} style={styles.avatar} />
            ) : (
              <View style={styles.avatarFallback}>
                <Text style={styles.avatarText}>{initials(fullName)}</Text>
              </View>
            )}
            <View style={styles.heroCopy}>
              <Text style={styles.childName}>{fullName}</Text>
              <Text style={styles.childMeta}>
                {[child?.classroom_name, ageLabel(child?.date_of_birth)].filter(Boolean).join(' · ')}
              </Text>
              {child?.center_name ? <Text style={styles.centerName}>{child.center_name}</Text> : null}
            </View>
          </View>

          <Text style={styles.sectionLabel}>PROFILE</Text>
          <View style={styles.card}>
            <InfoRow label="Preferred name" value={textValue(child?.preferred_name, displayName)} />
            <InfoRow label="Date of birth" value={textValue(readableDate(child?.date_of_birth), 'Not shared')} />
            <InfoRow label="Pronouns" value={textValue(child?.pronouns, 'Not shared')} />
            <InfoRow label="Enrolled" value={textValue(readableDate(child?.enrolled_on), 'Not available')} last />
          </View>

          <Text style={styles.sectionLabel}>CARE INFORMATION</Text>
          <View style={styles.card}>
            <InfoRow label="Allergies" value={textValue(child?.allergies)} />
            <InfoRow label="Dietary needs" value={textValue(child?.dietary_needs)} />
            <InfoRow label="Medical notes" value={textValue(child?.medical_notes)} last />
          </View>
          <View style={styles.privacyNote}>
            <Ionicons name="shield-checkmark-outline" size={19} color={colors.primary} />
            <Text style={styles.privacyText}>Care information is visible only to your family and authorized center staff.</Text>
          </View>

          <Text style={styles.sectionLabel}>EMERGENCY CONTACTS</Text>
          <View style={styles.card}>
            {emergencyContacts.length ? emergencyContacts.map((contact, index) => (
              <View key={`${contactName(contact)}-${index}`} style={[styles.contactRow, index < emergencyContacts.length - 1 && styles.rowDivider]}>
                <View style={styles.contactAvatar}>
                  <Text style={styles.contactAvatarText}>{initials(contactName(contact))}</Text>
                </View>
                <View style={styles.contactCopy}>
                  <Text style={styles.contactName}>{contactName(contact)}</Text>
                  <Text style={styles.contactDetail}>{contactDetail(contact)}</Text>
                </View>
              </View>
            )) : (
              <Text style={styles.emptyText}>No emergency contacts have been shared yet. Contact the center to update this record.</Text>
            )}
          </View>

          <Text style={styles.sectionLabel}>GUARDIANS</Text>
          <View style={styles.card}>
            {(child?.guardians || []).map((guardian, index) => (
              <View key={guardian.id} style={[styles.contactRow, index < child.guardians.length - 1 && styles.rowDivider]}>
                <View style={styles.contactAvatar}>
                  <Text style={styles.contactAvatarText}>{initials(guardian.full_name)}</Text>
                </View>
                <View style={styles.contactCopy}>
                  <Text style={styles.contactName}>{guardian.full_name}{guardian.is_current_user ? ' · you' : ''}</Text>
                  <Text style={styles.contactDetail}>{guardian.relationship || 'Parent/guardian'}</Text>
                </View>
                {guardian.is_primary ? <Text style={styles.primaryBadge}>Primary</Text> : null}
              </View>
            ))}
          </View>

          <Text style={styles.sectionLabel}>MANAGE</Text>
          <View style={styles.actions}>
            <ActionCard
              icon="people-outline"
              label="Authorized pickups"
              detail="People allowed to collect this child"
              onPress={() => navigation.navigate('AuthorizedPickups', { child })}
            />
            <ActionCard
              icon="medical-outline"
              label="Medications"
              detail="Authorizations and administration history"
              onPress={() => navigation.navigate('Medication', { child })}
            />
            <ActionCard
              icon="shield-checkmark-outline"
              label="Permissions & consents"
              detail="Control optional activities"
              onPress={() => navigation.navigate('ParentConsents', { child })}
            />
            <ActionCard
              icon="document-text-outline"
              label="Documents"
              detail="Health forms, agreements and requests"
              onPress={() => navigation.navigate('ParentDocuments', { childId: child.id })}
            />
          </View>

          <Text style={styles.footer}>To change official child or care information, contact your center so staff can verify and update the record.</Text>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  stateWrap: { paddingHorizontal: spacing.xl },
  content: { paddingHorizontal: spacing.xl, paddingBottom: 48, gap: spacing.md },
  heroCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.lg,
    backgroundColor: colors.primaryLight, borderRadius: radius.xl, padding: spacing.lg,
  },
  avatar: { width: 64, height: 64, borderRadius: 32 },
  avatarFallback: {
    width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  avatarText: { color: colors.primary, fontFamily: fonts.black, fontSize: 20 },
  heroCopy: { flex: 1, minWidth: 0 },
  childName: { color: colors.textPrimary, fontFamily: fonts.black, fontSize: 19 },
  childMeta: { color: colors.textSecondary, fontFamily: fonts.regular, fontSize: 13, marginTop: 3 },
  centerName: { color: colors.textFaint, fontFamily: fonts.regular, fontSize: 11.5, marginTop: 3 },
  sectionLabel: {
    color: colors.textFaint, fontFamily: fonts.bold, fontSize: 10.5,
    letterSpacing: 0.8, marginTop: spacing.sm, marginLeft: 2,
  },
  card: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderSoft,
    borderRadius: radius.lg, paddingHorizontal: spacing.lg,
  },
  infoRow: { paddingVertical: spacing.md, gap: 4 },
  rowDivider: { borderBottomWidth: 1, borderBottomColor: colors.borderSoft },
  infoLabel: { color: colors.textFaint, fontFamily: fonts.bold, fontSize: 10.5, letterSpacing: 0.4 },
  infoValue: { color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 14, lineHeight: 20 },
  privacyNote: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.primarySoft, borderRadius: radius.md, padding: spacing.md,
  },
  privacyText: { flex: 1, color: colors.textSecondary, fontFamily: fonts.regular, fontSize: 12, lineHeight: 17 },
  contactRow: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  contactAvatar: {
    width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.primaryLight,
  },
  contactAvatarText: { color: colors.primary, fontFamily: fonts.bold, fontSize: 11.5 },
  contactCopy: { flex: 1, minWidth: 0 },
  contactName: { color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 13.5 },
  contactDetail: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 11.5, marginTop: 2 },
  primaryBadge: {
    color: colors.success, backgroundColor: colors.successLight,
    borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: 4,
    fontFamily: fonts.bold, fontSize: 10.5,
  },
  emptyText: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 12.5, lineHeight: 18, paddingVertical: spacing.lg },
  actions: { gap: spacing.sm },
  actionCard: {
    minHeight: 70, flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderSoft,
    borderRadius: radius.lg, paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
  },
  actionIcon: {
    width: 40, height: 40, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.primarySoft,
  },
  actionCopy: { flex: 1, minWidth: 0 },
  actionLabel: { color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 14 },
  actionDetail: { color: colors.textFaint, fontFamily: fonts.regular, fontSize: 11.5, marginTop: 2 },
  footer: {
    color: colors.textFaint, fontFamily: fonts.regular, fontSize: 11.5,
    lineHeight: 17, textAlign: 'center', paddingHorizontal: spacing.lg, marginTop: spacing.sm,
  },
});
