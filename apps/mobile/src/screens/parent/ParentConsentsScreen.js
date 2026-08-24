import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../../hooks/useAuth';
import { getChildConsents, setParentConsent } from '../../hooks/useStaffVisibility';
import { supabase } from '../../lib/supabase';
import { EmptyState } from '../../components/ui';
import { showToast } from '../../components/Toast';
import { colors, fonts, radius, spacing } from '../../theme';

const KIND_ICONS = {
  'Photo & media consent': 'camera-outline',
  'Sunscreen application': 'sunny-outline',
  'Field-trip permission': 'walk-outline',
  'Water / splash play': 'water-outline',
};

export default function ParentConsentsScreen({ navigation, route }) {
  const { profile } = useAuth();
  const [children, setChildren] = useState([]);
  const [selectedChild, setSelectedChild] = useState(route.params?.child || null);
  const [data, setData] = useState(null);
  const [loadingChildren, setLoadingChildren] = useState(true);
  const [loading, setLoading] = useState(false);
  const [busyKind, setBusyKind] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => { loadChildren(); }, [profile?.id]);

  useFocusEffect(useCallback(() => {
    if (selectedChild?.id) loadConsents(selectedChild.id);
  }, [selectedChild?.id]));

  async function loadChildren() {
    if (!profile?.id) return;
    setLoadingChildren(true);
    const { data: links, error: childError } = await supabase
      .from('parent_children')
      .select('child:children(id,first_name,last_name,photo_url,archived_at)')
      .eq('parent_id', profile.id);
    if (childError) {
      setError(childError.message);
      setLoadingChildren(false);
      return;
    }
    const available = (links || []).map((link) => link.child).filter((child) => child && !child.archived_at);
    setChildren(available);
    setSelectedChild((current) => {
      const preferredId = route.params?.child?.id || current?.id;
      return available.find((child) => child.id === preferredId) || available[0] || null;
    });
    setLoadingChildren(false);
  }

  async function loadConsents(childId) {
    setLoading(true);
    setError('');
    try {
      setData(await getChildConsents(childId));
    } catch (loadError) {
      setError(loadError.message || 'Permissions could not be loaded.');
    } finally {
      setLoading(false);
    }
  }

  function requestChange(item, granted) {
    if (!granted) {
      Alert.alert(
        `Decline ${item.label.toLowerCase()}?`,
        item.kind === 'Photo & media consent'
          ? 'Educators will immediately be blocked from adding new daily-log photos of this child.'
          : 'Educators will immediately see this activity as restricted for your child.',
        [
          { text: 'Keep allowed', style: 'cancel' },
          { text: 'Decline', style: 'destructive', onPress: () => saveChange(item, false) },
        ],
      );
      return;
    }
    saveChange(item, true);
  }

  async function saveChange(item, granted) {
    if (!selectedChild?.id) return;
    setBusyKind(item.kind);
    try {
      const saved = await setParentConsent(selectedChild.id, item.kind, granted);
      setData((current) => ({
        ...current,
        items: (current?.items || []).map((permission) => (
          permission.kind === item.kind
            ? { ...permission, status: saved.status, granted: saved.granted, updatedAt: saved.updatedAt, updatedBy: profile.full_name }
            : permission
        )),
      }));
      showToast(granted ? 'Permission allowed' : 'Permission declined', 'success');
    } catch (saveError) {
      Alert.alert('Could not update permission', saveError.message || 'Please try again.');
    } finally {
      setBusyKind(null);
    }
  }

  const items = data?.items || [];

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.back} accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={styles.headerCopy}>
          <Text style={styles.headerTitle}>Permissions & consents</Text>
          <Text style={styles.headerSubtitle}>You stay in control</Text>
        </View>
        <View style={styles.back} />
      </View>

      {loadingChildren ? (
        <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>
      ) : children.length === 0 ? (
        <View style={styles.center}><EmptyState icon="🛡️" message="Link a child before managing activity permissions." /></View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          {children.length > 1 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.childTabs}>
              {children.map((child) => {
                const selected = selectedChild?.id === child.id;
                return (
                  <TouchableOpacity
                    key={child.id}
                    style={[styles.childChip, selected && styles.childChipActive]}
                    onPress={() => setSelectedChild(child)}
                  >
                    <Text style={[styles.childChipText, selected && styles.childChipTextActive]}>{child.first_name}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          ) : null}

          <View style={styles.hero}>
            <View style={styles.shieldIcon}>
              <Ionicons name="shield-checkmark-outline" size={28} color={colors.primary} />
            </View>
            <View style={styles.heroCopy}>
              <Text style={styles.heroTitle}>{selectedChild?.first_name}'s permissions</Text>
              <Text style={styles.heroText}>Choose which optional activities the center may include your child in.</Text>
            </View>
          </View>

          {error ? (
            <View style={styles.errorCard}>
              <Text style={styles.errorText}>{error}</Text>
              <TouchableOpacity onPress={() => loadConsents(selectedChild?.id)}><Text style={styles.retryText}>Try again</Text></TouchableOpacity>
            </View>
          ) : loading ? (
            <View style={styles.loadingCard}><ActivityIndicator color={colors.primary} /></View>
          ) : (
            <View style={styles.card}>
              {items.map((item, index) => {
                const allowed = item.status === 'allowed';
                const busy = busyKind === item.kind;
                return (
                  <View key={item.kind} style={[styles.permissionRow, index > 0 && styles.rowBorder]}>
                    <View style={[styles.permissionIcon, allowed ? styles.iconAllowed : styles.iconRestricted]}>
                      <Ionicons
                        name={KIND_ICONS[item.kind] || 'shield-outline'}
                        size={21}
                        color={allowed ? colors.success : colors.textMuted}
                      />
                    </View>
                    <View style={styles.permissionCopy}>
                      <Text style={styles.permissionLabel}>{item.label}</Text>
                      <Text style={styles.permissionDetail}>{item.detail}</Text>
                      <Text style={[styles.statusText, allowed ? styles.allowedText : styles.restrictedText]}>
                        {allowed ? 'Allowed' : (item.status === 'declined' ? 'Declined' : 'Not answered · treated as restricted')}
                      </Text>
                    </View>
                    {busy ? (
                      <View style={styles.switchLoading}><ActivityIndicator size="small" color={colors.primary} /></View>
                    ) : (
                      <Switch
                        value={allowed}
                        onValueChange={(value) => requestChange(item, value)}
                        disabled={Boolean(busyKind)}
                        trackColor={{ false: colors.border, true: colors.success }}
                        thumbColor={colors.white}
                        accessibilityLabel={`${item.label}, ${allowed ? 'allowed' : 'restricted'}`}
                      />
                    )}
                  </View>
                );
              })}
            </View>
          )}

          <View style={styles.infoCard}>
            <Ionicons name="information-circle-outline" size={20} color={colors.primary} />
            <Text style={styles.infoText}>
              Changes apply immediately. Previous daily-log entries remain in your private family record; contact the center if you need an older item removed.
            </Text>
          </View>
          <Text style={styles.footer}>Only your family and authorized center staff can see these choices.</Text>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  header: { minHeight: 68, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, borderBottomWidth: 1.5, borderBottomColor: colors.primaryLight },
  back: { width: 40, height: 44, justifyContent: 'center' },
  headerCopy: { flex: 1 },
  headerTitle: { textAlign: 'center', fontSize: 16.5, fontFamily: fonts.bold, color: colors.textPrimary },
  headerSubtitle: { marginTop: 2, textAlign: 'center', fontSize: 11.5, fontFamily: fonts.regular, color: colors.textMuted },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl },
  content: { padding: spacing.xl, paddingBottom: 52 },
  childTabs: { gap: spacing.sm, paddingBottom: spacing.lg },
  childChip: { borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.full, paddingHorizontal: spacing.lg, paddingVertical: 9, backgroundColor: colors.surface },
  childChipActive: { borderColor: colors.primary, backgroundColor: colors.primary },
  childChipText: { fontSize: 13, fontFamily: fonts.bold, color: colors.textMuted },
  childChipTextActive: { color: colors.white },
  hero: { flexDirection: 'row', gap: spacing.md, alignItems: 'center', padding: spacing.lg, borderRadius: 20, backgroundColor: colors.primarySoft },
  shieldIcon: { width: 50, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  heroCopy: { flex: 1 },
  heroTitle: { fontSize: 17, fontFamily: fonts.black, color: colors.textPrimary },
  heroText: { marginTop: 4, fontSize: 12.5, lineHeight: 18, fontFamily: fonts.regular, color: colors.textMuted },
  card: { marginTop: spacing.lg, overflow: 'hidden', borderWidth: 1.5, borderColor: colors.border, borderRadius: 18, backgroundColor: colors.surface },
  permissionRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, padding: spacing.lg },
  rowBorder: { borderTopWidth: 1, borderTopColor: colors.primarySoft },
  permissionIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  iconAllowed: { backgroundColor: colors.successLight },
  iconRestricted: { backgroundColor: colors.primarySoft },
  permissionCopy: { flex: 1, minWidth: 0 },
  permissionLabel: { fontSize: 14.5, fontFamily: fonts.bold, color: colors.textPrimary },
  permissionDetail: { marginTop: 4, fontSize: 12, lineHeight: 17, fontFamily: fonts.regular, color: colors.textMuted },
  statusText: { marginTop: 5, fontSize: 10.5, fontFamily: fonts.bold },
  allowedText: { color: colors.success },
  restrictedText: { color: colors.danger },
  switchLoading: { width: 51, height: 31, alignItems: 'center', justifyContent: 'center' },
  loadingCard: { minHeight: 220, alignItems: 'center', justifyContent: 'center' },
  errorCard: { marginTop: spacing.lg, padding: spacing.lg, borderRadius: radius.md, backgroundColor: colors.dangerLight },
  errorText: { fontSize: 12.5, lineHeight: 18, fontFamily: fonts.regular, color: colors.danger },
  retryText: { marginTop: spacing.sm, fontFamily: fonts.bold, color: colors.primary },
  infoCard: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginTop: spacing.lg, padding: spacing.lg, borderRadius: radius.md, backgroundColor: colors.primarySoft },
  infoText: { flex: 1, fontSize: 11.5, lineHeight: 18, fontFamily: fonts.regular, color: colors.textMuted },
  footer: { marginTop: spacing.lg, textAlign: 'center', fontSize: 11, lineHeight: 17, fontFamily: fonts.regular, color: colors.textFaint },
});
