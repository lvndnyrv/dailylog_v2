import React, { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, StyleSheet, Alert
} from 'react-native';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../lib/supabase';
import { Input, Button, LoadingScreen, Divider } from '../../components/ui';
import { showToast } from '../../components/Toast';
import { colors, spacing, radius } from '../../theme';

/**
 * Admin settings — edit daycare details + admin's own account actions.
 */
export default function AdminSettingsScreen() {
  const { profile, signOut } = useAuth();
  const [daycare, setDaycare]   = useState(null);
  const [name, setName]         = useState('');
  const [address, setAddress]   = useState('');
  const [phone, setPhone]       = useState('');
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('daycares')
        .select('*')
        .eq('id', profile.daycare_id)
        .maybeSingle();
      setDaycare(data);
      setName(data?.name || '');
      setAddress(data?.address || '');
      setPhone(data?.phone || '');
      setLoading(false);
    }
    if (profile) load();
  }, [profile]);

  const hasChanges =
    name.trim() !== (daycare?.name || '') ||
    address.trim() !== (daycare?.address || '') ||
    phone.trim() !== (daycare?.phone || '');

  async function handleSave() {
    if (!name.trim()) {
      Alert.alert('Required', 'Daycare name cannot be empty.');
      return;
    }
    setSaving(true);
    const updates = {
      name: name.trim(),
      address: address.trim() || null,
      phone: phone.trim() || null,
    };
    const { error } = await supabase
      .from('daycares')
      .update(updates)
      .eq('id', profile.daycare_id);
    setSaving(false);
    if (error) { Alert.alert('Error', error.message); return; }
    setDaycare(prev => ({ ...prev, ...updates }));
    showToast('✓ Daycare settings saved', 'success');
  }

  function handleSignOut() {
    Alert.alert('Sign out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: signOut },
    ]);
  }

  if (loading) return <LoadingScreen />;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.pageTitle}>Settings</Text>

      {/* Profile summary */}
      <View style={styles.card}>
        <View style={styles.profileRow}>
          <View style={styles.avatar}>
            <Text style={styles.avatarInitial}>{profile?.full_name?.[0] || '?'}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.profileName}>{profile?.full_name}</Text>
            <Text style={styles.profileMeta}>{profile?.email} · Admin</Text>
          </View>
        </View>
      </View>

      {/* Daycare settings */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>🏢 Daycare details</Text>
        <Input label="Name *" value={name} onChangeText={setName} placeholder="Daycare name" />
        <Input label="Address" value={address} onChangeText={setAddress} placeholder="Street, city" />
        <Input label="Phone" value={phone} onChangeText={setPhone} placeholder="Contact number" keyboardType="phone-pad" />
        {hasChanges && (
          <Button
            label={saving ? 'Saving...' : 'Save changes'}
            onPress={handleSave}
            loading={saving}
          />
        )}
      </View>

      <Divider />

      <Button label="Sign out" onPress={handleSignOut} variant="ghost" />

      <View style={{ height: spacing.xxxl }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.xl },
  pageTitle: { fontSize: 24, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.xl },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border,
    padding: spacing.lg, marginBottom: spacing.lg,
  },
  cardTitle: { fontSize: 15, fontWeight: '600', color: colors.textPrimary, marginBottom: spacing.lg },
  profileRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatar: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: colors.purpleLight, alignItems: 'center', justifyContent: 'center',
  },
  avatarInitial: { fontSize: 20, fontWeight: '700', color: colors.purple },
  profileName: { fontSize: 16, fontWeight: '600', color: colors.textPrimary },
  profileMeta: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
});


