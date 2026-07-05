import React, { useState, useEffect } from 'react';
import {
  View, Text, FlatList, TouchableOpacity,
  StyleSheet, Alert, RefreshControl, Modal, TextInput
} from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../lib/supabase';
import { LoadingScreen, EmptyState, Badge, Button } from '../../components/ui';
import { showToast } from '../../components/Toast';
import { colors, spacing, radius } from '../../theme';

const ROLE_STYLE = {
  admin:    { label: 'Admin',    color: colors.purple,  bg: colors.purpleLight },
  educator: { label: 'Educator', color: colors.primary, bg: colors.primaryLight },
  parent:   { label: 'Parent',   color: colors.amber,   bg: colors.amberLight },
};

/**
 * Admin user management — list all daycare users, change roles,
 * invite educators (invite-gated signup), revoke pending invites.
 */
export default function AdminUsersScreen() {
  const isFocused = useIsFocused();
  const { profile } = useAuth();
  const [users, setUsers]       = useState([]);
  const [invites, setInvites]   = useState([]);
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter]     = useState('staff'); // staff | parents | all

  // Invite educator modal
  const [inviteOpen, setInviteOpen]   = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteError, setInviteError] = useState(null);
  const [inviteRoom, setInviteRoom]   = useState(null);
  const [rooms, setRooms]             = useState([]);
  const [sendingInvite, setSendingInvite] = useState(false);

  useEffect(() => {
    if (isFocused) load();
  }, [isFocused]);

  async function load() {
    const { data, error } = await supabase.rpc('get_daycare_users');
    if (error) showToast(`Couldn't load users: ${error.message}`, 'error');
    setUsers(data || []);

    // Pending staff invites
    const { data: inviteRows } = await supabase
      .from('staff_invites')
      .select('id, email, role, created_at, classroom:classrooms(name)')
      .is('consumed_at', null)
      .order('created_at', { ascending: false });
    setInvites(inviteRows || []);

    // Classrooms for the invite modal
    if (profile?.daycare_id) {
      const { data: roomRows } = await supabase
        .from('classrooms')
        .select('id, name')
        .eq('daycare_id', profile.daycare_id)
        .order('name');
      setRooms(roomRows || []);
    }

    setLoading(false);
    setRefreshing(false);
  }

  async function handleSendInvite() {
    const email = inviteEmail.trim().toLowerCase();
    if (!email) { setInviteError('Email is required'); return; }
    if (!/\S+@\S+\.\S+/.test(email)) { setInviteError('Enter a valid email address'); return; }

    setSendingInvite(true);
    setInviteError(null);

    // 1. Create the server-side invite (authoritative role/daycare/classroom)
    const { error: rpcError } = await supabase.rpc('invite_staff', {
      p_email: email,
      p_role: 'educator',
      p_classroom_id: inviteRoom?.id || null,
    });
    if (rpcError) {
      setSendingInvite(false);
      setInviteError(rpcError.message);
      return;
    }

    // 2. Send the magic-link email (account is created on first open;
    //    handle_new_user consumes the invite and assigns educator role)
    const { error: otpError } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: true,
        emailRedirectTo: 'dailylog://auth',
        data: { role: 'educator' },
      },
    });
    setSendingInvite(false);
    if (otpError) { setInviteError(otpError.message); return; }

    showToast(`✉️ Invite sent to ${email}`, 'success');
    setInviteOpen(false);
    setInviteEmail('');
    setInviteRoom(null);
    load();
  }

  function handleRevokeInvite(invite) {
    Alert.alert('Revoke invite', `Revoke the pending invite for ${invite.email}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Revoke', style: 'destructive',
        onPress: async () => {
          await supabase.from('staff_invites').delete().eq('id', invite.id);
          showToast('Invite revoked', 'success');
          load();
        },
      },
    ]);
  }

  function handleChangeRole(user) {
    if (user.id === profile.id) {
      Alert.alert('Not allowed', 'You cannot change your own role.');
      return;
    }
    const options = ['educator', 'parent', 'admin']
      .filter(r => r !== user.role)
      .map(r => ({
        text: `Make ${ROLE_STYLE[r].label}`,
        onPress: async () => {
          const { error } = await supabase.rpc('admin_set_user_role', {
            p_user_id: user.id,
            p_role: r,
          });
          if (error) Alert.alert('Error', error.message);
          else {
            showToast(`${user.full_name} is now ${ROLE_STYLE[r].label}`, 'success');
            load();
          }
        },
      }));

    Alert.alert(
      `Change role — ${user.full_name}`,
      `Current role: ${ROLE_STYLE[user.role]?.label || user.role}`,
      [...options, { text: 'Cancel', style: 'cancel' }]
    );
  }

  const filtered = users.filter(u => {
    if (filter === 'staff') return u.role === 'educator' || u.role === 'admin';
    if (filter === 'parents') return u.role === 'parent';
    return true;
  });

  function renderUser({ item }) {
    const roleStyle = ROLE_STYLE[item.role] || ROLE_STYLE.parent;
    const isMe = item.id === profile.id;
    return (
      <TouchableOpacity
        style={styles.userCard}
        onPress={() => handleChangeRole(item)}
        activeOpacity={0.7}
        disabled={isMe}
      >
        <View style={styles.userAvatar}>
          <Text style={styles.userInitial}>{item.full_name?.[0] || '?'}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.userName}>
            {item.full_name}{isMe ? ' (you)' : ''}
          </Text>
          <Text style={styles.userEmail}>{item.email}</Text>
          {item.classroom_name && (
            <Text style={styles.userRoom}>🏫 {item.classroom_name}</Text>
          )}
        </View>
        <Badge label={roleStyle.label} color={roleStyle.color} bg={roleStyle.bg} />
      </TouchableOpacity>
    );
  }

  if (loading) return <LoadingScreen />;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle}>Users</Text>
            <Text style={styles.headerSub}>{users.length} people · tap a user to change their role</Text>
          </View>
          <TouchableOpacity style={styles.inviteBtn} onPress={() => setInviteOpen(true)}>
            <Text style={styles.inviteBtnText}>+ Invite educator</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Filter */}
      <View style={styles.filterBar}>
        {[
          { key: 'staff',   label: 'Staff' },
          { key: 'parents', label: 'Parents' },
          { key: 'all',     label: 'All' },
        ].map(f => (
          <TouchableOpacity
            key={f.key}
            onPress={() => setFilter(f.key)}
            style={[styles.filterBtn, filter === f.key && styles.filterBtnActive]}
          >
            <Text style={[styles.filterText, filter === f.key && styles.filterTextActive]}>
              {f.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        data={filtered}
        keyExtractor={u => u.id}
        renderItem={renderUser}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          filter !== 'parents' && invites.length > 0 ? (
            <View style={styles.invitesSection}>
              <Text style={styles.invitesTitle}>⏳ Pending invites</Text>
              {invites.map(inv => (
                <TouchableOpacity
                  key={inv.id}
                  style={styles.inviteCard}
                  onLongPress={() => handleRevokeInvite(inv)}
                  activeOpacity={0.7}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.inviteEmail}>{inv.email}</Text>
                    <Text style={styles.inviteMeta}>
                      {inv.classroom?.name ? `🏫 ${inv.classroom.name} · ` : ''}Waiting for sign-up — hold to revoke
                    </Text>
                  </View>
                  <Badge label="Invited" color={colors.amber} bg={colors.amberLight} />
                </TouchableOpacity>
              ))}
            </View>
          ) : null
        }
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />
        }
        ListEmptyComponent={<EmptyState icon="👥" message="No users found." />}
      />

      {/* Invite educator modal */}
      <Modal visible={inviteOpen} transparent animationType="fade" onRequestClose={() => setInviteOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Invite an educator</Text>
            <Text style={styles.modalDesc}>
              They'll get an email link. Their account is created with educator access
              to your daycare — no public sign-up.
            </Text>

            <Text style={styles.modalLabel}>Email</Text>
            <TextInput
              style={[styles.modalInput, inviteError && styles.modalInputError]}
              value={inviteEmail}
              onChangeText={(v) => { setInviteEmail(v); setInviteError(null); }}
              placeholder="educator@email.com"
              placeholderTextColor={colors.textMuted}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />
            {inviteError && <Text style={styles.modalError}>{inviteError}</Text>}

            {rooms.length > 0 && (
              <>
                <Text style={styles.modalLabel}>Assign to classroom (optional)</Text>
                <View style={styles.roomChips}>
                  {rooms.map(r => (
                    <TouchableOpacity
                      key={r.id}
                      onPress={() => setInviteRoom(inviteRoom?.id === r.id ? null : r)}
                      style={[styles.roomChip, inviteRoom?.id === r.id && styles.roomChipSelected]}
                    >
                      <Text style={[styles.roomChipText, inviteRoom?.id === r.id && styles.roomChipTextSelected]}>
                        {r.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}

            <Button
              label={sendingInvite ? 'Sending...' : 'Send invite'}
              onPress={handleSendInvite}
              loading={sendingInvite}
              style={{ marginTop: spacing.md }}
            />
            <Button
              label="Cancel"
              variant="ghost"
              onPress={() => { setInviteOpen(false); setInviteError(null); }}
              style={{ marginTop: spacing.sm }}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    padding: spacing.xl, paddingTop: spacing.xl + spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  headerTitle: { fontSize: 24, fontWeight: '700', color: colors.textPrimary },
  headerSub: { fontSize: 13, color: colors.textSecondary, marginTop: 3 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  inviteBtn: {
    backgroundColor: colors.primary, borderRadius: radius.full,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },
  inviteBtnText: { fontSize: 13, fontWeight: '600', color: colors.white },
  invitesSection: { marginBottom: spacing.md },
  invitesTitle: {
    fontSize: 13, fontWeight: '600', color: colors.textSecondary,
    marginBottom: spacing.sm, textTransform: 'uppercase', letterSpacing: 0.5,
  },
  inviteCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.amberLight, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.amber + '44',
    padding: spacing.lg, marginBottom: spacing.sm,
  },
  inviteEmail: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  inviteMeta: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  modalBackdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center', padding: spacing.xl,
  },
  modalCard: {
    backgroundColor: colors.surface, borderRadius: radius.xl,
    padding: spacing.xl,
  },
  modalTitle: { fontSize: 19, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.sm },
  modalDesc: { fontSize: 13, color: colors.textSecondary, lineHeight: 19, marginBottom: spacing.lg },
  modalLabel: { fontSize: 13, fontWeight: '500', color: colors.textSecondary, marginBottom: spacing.xs },
  modalInput: {
    borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.md - 2,
    fontSize: 15, color: colors.textPrimary, backgroundColor: colors.bg,
    marginBottom: spacing.md,
  },
  modalInputError: { borderColor: colors.danger },
  modalError: { fontSize: 12, color: colors.danger, fontWeight: '500', marginTop: -spacing.sm, marginBottom: spacing.md },
  roomChips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.sm },
  roomChip: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: radius.full, borderWidth: 1.5, borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  roomChipSelected: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  roomChipText: { fontSize: 13, color: colors.textSecondary, fontWeight: '500' },
  roomChipTextSelected: { color: colors.primary, fontWeight: '600' },
  filterBar: {
    flexDirection: 'row', gap: spacing.sm,
    paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm,
  },
  filterBtn: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: radius.full, borderWidth: 1.5, borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  filterBtnActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  filterText: { fontSize: 13, color: colors.textSecondary, fontWeight: '500' },
  filterTextActive: { color: colors.primary, fontWeight: '600' },
  list: { padding: spacing.lg },
  userCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.surface, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border,
    padding: spacing.lg, marginBottom: spacing.sm,
  },
  userAvatar: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center',
  },
  userInitial: { fontSize: 16, fontWeight: '700', color: colors.primary },
  userName: { fontSize: 15, fontWeight: '600', color: colors.textPrimary },
  userEmail: { fontSize: 12, color: colors.textSecondary, marginTop: 1 },
  userRoom: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
});

