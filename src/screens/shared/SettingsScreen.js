import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { useAuth } from '../../hooks/useAuth';
import { Button, Divider } from '../../components/ui';
import { colors, spacing, radius } from '../../theme';

export default function SettingsScreen({ navigation }) {
  const { profile, signOut, deleteAccount } = useAuth();
  const [deleting, setDeleting] = useState(false);
  const isEducator = profile?.role === 'educator';

  function handleSignOut() {
    Alert.alert('Sign out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', onPress: signOut },
    ]);
  }

  function handleDeleteAccount() {
    Alert.alert(
      'Delete account',
      'This will permanently delete your account and all associated data. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete permanently',
          style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            const { error } = await deleteAccount();
            setDeleting(false);
            if (error) {
              Alert.alert('Deletion failed', error.message);
            }
          },
        },
      ]
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.pageTitle}>Settings</Text>

      {/* Profile card */}
      <View style={styles.profileCard}>
        <View style={styles.avatar}>
          <Text style={styles.avatarInitial}>{profile?.full_name?.[0] || '?'}</Text>
        </View>
        <View style={styles.profileInfo}>
          <Text style={styles.profileName}>{profile?.full_name}</Text>
          <Text style={styles.profileEmail}>{profile?.email}</Text>
          <View style={styles.roleBadge}>
            <Text style={styles.roleText}>
              {isEducator ? '👩‍🏫 Educator' : '👨‍👩‍👧 Parent'}
            </Text>
          </View>
        </View>
      </View>

      {/* Account section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Account</Text>

        <TouchableOpacity style={styles.menuItem} onPress={() => navigation.navigate('EditProfile')}>
          <View style={styles.menuLeft}>
            <Text style={styles.menuIcon}>✏️</Text>
            <Text style={styles.menuLabel}>Edit profile & password</Text>
          </View>
          <Text style={styles.menuArrow}>›</Text>
        </TouchableOpacity>
      </View>

      {/* Legal section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Legal & privacy</Text>
        <TouchableOpacity style={styles.menuItem} onPress={() => navigation.navigate('Privacy')}>
          <View style={styles.menuLeft}>
            <Text style={styles.menuIcon}>🔒</Text>
            <Text style={styles.menuLabel}>Privacy policy</Text>
          </View>
          <Text style={styles.menuArrow}>›</Text>
        </TouchableOpacity>

        {profile?.role === 'parent' && (
          <View style={styles.consentRow}>
            <Text style={styles.consentText}>
              ✓  You have consented to DailyLog collecting and sharing your child's daily care information from their daycare educators.
            </Text>
          </View>
        )}
      </View>

      {/* Actions */}
      <View style={styles.section}>
        <Button label="Sign out" onPress={handleSignOut} variant="ghost" style={{ marginBottom: spacing.md }} />
        <Button
          label={deleting ? 'Deleting...' : 'Delete my account'}
          onPress={handleDeleteAccount}
          loading={deleting}
          variant="danger"
        />
        <Text style={styles.deleteNote}>
          Deleting your account permanently removes all your data.
        </Text>
      </View>

      <Text style={styles.version}>DailyLog v1.0.0 · Smart Kid South Newmarket</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.xl },
  pageTitle: { fontSize: 24, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.xl },
  profileCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.lg,
    backgroundColor: colors.surface, borderRadius: radius.lg,
    padding: spacing.lg, marginBottom: spacing.lg,
    borderWidth: 1, borderColor: colors.border,
  },
  avatar: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center',
  },
  avatarInitial: { fontSize: 22, fontWeight: '700', color: colors.primary },
  profileInfo: { flex: 1 },
  profileName: { fontSize: 17, fontWeight: '600', color: colors.textPrimary },
  profileEmail: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
  roleBadge: {
    marginTop: spacing.xs, alignSelf: 'flex-start',
    backgroundColor: colors.primaryLight, paddingHorizontal: spacing.sm,
    paddingVertical: 2, borderRadius: radius.full,
  },
  roleText: { fontSize: 12, color: colors.primary, fontWeight: '500' },
  section: { marginBottom: spacing.lg },
  sectionTitle: {
    fontSize: 12, fontWeight: '600', color: colors.textSecondary,
    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: spacing.sm,
  },
  menuItem: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: colors.surface, padding: spacing.lg,
    borderRadius: radius.lg, marginBottom: spacing.sm,
    borderWidth: 1, borderColor: colors.border,
  },
  menuLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  menuIcon: { fontSize: 18 },
  menuLabel: { fontSize: 15, color: colors.textPrimary },
  menuRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  menuBadge: { fontSize: 12, color: colors.textSecondary },
  menuArrow: { fontSize: 20, color: colors.textMuted },
  consentRow: {
    backgroundColor: colors.successLight, borderRadius: radius.md,
    padding: spacing.md, marginTop: spacing.sm,
  },
  consentText: { fontSize: 13, color: colors.success, lineHeight: 18 },
  deleteNote: {
    fontSize: 12, color: colors.textMuted,
    marginTop: spacing.sm, textAlign: 'center', lineHeight: 16,
  },
  version: { fontSize: 12, color: colors.textMuted, textAlign: 'center', marginTop: spacing.xxxl },
});
