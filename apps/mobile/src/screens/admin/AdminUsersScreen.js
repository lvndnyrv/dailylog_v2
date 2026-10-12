import React, { useMemo, useState, useEffect } from 'react';
import { isStaffRole } from '@dailylog/shared';
import {
  View, Text, FlatList, TouchableOpacity,
  StyleSheet, Alert, RefreshControl, Modal, TextInput,
  KeyboardAvoidingView, Platform, ScrollView
} from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../lib/supabase';
import { LoadingScreen, EmptyState, Badge, Button } from '../../components/ui';
import { showToast } from '../../components/Toast';
import { colors, fonts, spacing, radius } from '../../theme';

const ROLE_STYLE = {
  owner_admin: { label: 'Owner admin', color: colors.purple, bg: colors.purpleLight },
  admin:    { label: 'Admin',    color: colors.purple,  bg: colors.purpleLight },
  educator: { label: 'Educator', color: colors.primary, bg: colors.primaryLight },
  parent:   { label: 'Parent',   color: colors.amber,   bg: colors.amberLight },
};

/**
 * Admin user management — list all daycare users, change roles,
 * invite educators (invite-gated signup), revoke pending invites.
 */
export default function AdminUsersScreen({ navigation, route }) {
  const isFocused = useIsFocused();
  const { profile } = useAuth();
  const [users, setUsers]       = useState([]);
  const [invites, setInvites]   = useState([]);
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter]     = useState('staff'); // staff | parents | all
  const [search, setSearch] = useState('');
  const [busyInviteId, setBusyInviteId] = useState(null);

  // Invite educator modal
  const [inviteOpen, setInviteOpen]   = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteJobTitle, setInviteJobTitle] = useState('Educator');
  const [inviteBackgroundCheck, setInviteBackgroundCheck] = useState(false);
  const [inviteErrors, setInviteErrors] = useState({});
  const [inviteRoom, setInviteRoom]   = useState(null);
  const [rooms, setRooms]             = useState([]);
  const [sendingInvite, setSendingInvite] = useState(false);

  useEffect(() => {
    if (isFocused) load();
  }, [isFocused]);

  useEffect(() => {
    if (!isFocused || !route?.params?.openInvite) return;
    setInviteErrors({});
    setInviteOpen(true);
    navigation.setParams({ openInvite: undefined });
  }, [isFocused, navigation, route?.params?.openInvite]);

  async function load() {
    const { data, error } = await supabase.rpc('get_daycare_users');
    if (error) showToast(`Couldn't load users: ${error.message}`, 'error');
    const userRows = data || [];

    const [{ data: memberRows }, { data: roomRows }] = await Promise.all([
      userRows.length
        ? supabase.from('staff_members')
          .select('id, profile_id, job_title, employment_type, status, started_on')
          .in('profile_id', userRows.map(user => user.id))
        : Promise.resolve({ data: [] }),
      profile?.daycare_id
        ? supabase.from('classrooms')
          .select('id, name')
          .eq('daycare_id', profile.daycare_id)
          .is('archived_at', null)
          .order('name')
        : Promise.resolve({ data: [] }),
    ]);
    const memberByProfile = Object.fromEntries((memberRows || []).map(member => [member.profile_id, member]));
    const roomById = Object.fromEntries((roomRows || []).map(room => [room.id, room]));
    setUsers(userRows.map(user => ({
      ...user,
      staff_member: memberByProfile[user.id] || null,
      classroom_name: roomById[user.classroom_id]?.name || null,
    })));
    setRooms(roomRows || []);

    // Pending staff invites
    const { data: inviteRows } = await supabase
      .from('staff_invites')
      .select('id, email, full_name, role, job_title, require_background_check, created_at, expires_at, last_sent_at, resend_count, classroom:classrooms(name)')
      .is('accepted_at', null)
      .order('created_at', { ascending: false });
    setInvites(inviteRows || []);

    setLoading(false);
    setRefreshing(false);
  }

  async function handleSendInvite() {
    const email = inviteEmail.trim().toLowerCase();
    const fullName = inviteName.trim();
    const errors = {};
    if (!email) errors.email = 'Email is required';
    else if (!/\S+@\S+\.\S+/.test(email)) errors.email = 'Enter a valid email address';
    if (fullName.length < 2) errors.name = 'Full name is required';
    if (Object.keys(errors).length) {
      setInviteErrors(errors);
      return;
    }

    setSendingInvite(true);
    setInviteErrors({});

    // 1. Create the server-side invite (authoritative role/daycare/classroom)
    const { data: inviteCode, error: rpcError } = await supabase.rpc('invite_staff', {
      p_email: email,
      p_role: 'educator',
      p_classroom_id: inviteRoom?.id || null,
      p_full_name: fullName,
      p_job_title: inviteJobTitle.trim() || 'Educator',
      p_require_background_check: inviteBackgroundCheck,
    });
    if (rpcError) {
      setSendingInvite(false);
      setInviteErrors({ form: rpcError.message });
      return;
    }

    // 2. Queue the business invite link. The recipient creates or signs into
    //    their own account before accept_staff_invite assigns the trusted role.
    const inviteLink = `dailylog://invite?code=${encodeURIComponent(inviteCode)}`;
    const { error: emailError } = await supabase.rpc('enqueue_email_notification', {
      p_daycare_id: profile.daycare_id,
      p_recipient_email: email,
      p_kind: 'staff_invite',
      p_title: "You're invited to DailyLog",
      p_body: `Your center invited you to join DailyLog. Open this invitation on your phone: ${inviteLink}`,
      p_payload: { type: 'staff_invite', inviteLink },
      p_dedupe_key: `staff-invite:${inviteCode}`,
    });
    setSendingInvite(false);
    if (emailError) {
      setInviteErrors({ form: `The invitation was created, but its email could not be queued: ${emailError.message}` });
      load();
      return;
    }

    showToast(`✉️ Invite sent to ${email}`, 'success');
    setInviteOpen(false);
    setInviteEmail('');
    setInviteName('');
    setInviteJobTitle('Educator');
    setInviteBackgroundCheck(false);
    setInviteRoom(null);
    load();
  }

  function handleRevokeInvite(invite) {
    Alert.alert('Revoke invite', `Revoke the pending invite for ${invite.email}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Revoke', style: 'destructive',
        onPress: async () => {
          setBusyInviteId(invite.id);
          const { error } = await supabase.from('staff_invites').delete().eq('id', invite.id);
          setBusyInviteId(null);
          if (error) {
            Alert.alert('Could not revoke invite', error.message);
            return;
          }
          showToast('Invite cancelled', 'success');
          load();
        },
      },
    ]);
  }

  async function handleResendInvite(invite) {
    setBusyInviteId(invite.id);
    const { data, error } = await supabase.rpc('resend_staff_invite', { p_invite_id: invite.id });
    if (error) {
      setBusyInviteId(null);
      Alert.alert('Could not resend invite', error.message);
      return;
    }
    const inviteLink = `dailylog://invite?code=${encodeURIComponent(data.code)}`;
    const { error: emailError } = await supabase.rpc('enqueue_email_notification', {
      p_daycare_id: profile.daycare_id,
      p_recipient_email: data.email,
      p_kind: 'staff_invite',
      p_title: "You're invited to DailyLog",
      p_body: `Your center renewed your DailyLog invitation. Open it on your phone: ${inviteLink}`,
      p_payload: { type: 'staff_invite', inviteLink },
      p_dedupe_key: `staff-invite-resend:${invite.id}:${data.resendCount}`,
    });
    setBusyInviteId(null);
    if (emailError) {
      Alert.alert('Invite renewed, email not queued', emailError.message);
    } else {
      showToast(`Invite resent to ${data.email}`, 'success');
    }
    load();
  }

  const filtered = useMemo(() => users.filter(u => {
    if (filter === 'staff') return isStaffRole(u.role);
    if (filter === 'parents') return u.role === 'parent';
    return true;
  }).filter(u => {
    const value = `${u.full_name || ''} ${u.email || ''} ${u.classroom_name || ''}`.toLowerCase();
    return value.includes(search.trim().toLowerCase());
  }), [filter, search, users]);

  function renderUser({ item }) {
    const roleStyle = ROLE_STYLE[item.role] || ROLE_STYLE.parent;
    const isMe = item.id === profile.id;
    return (
      <TouchableOpacity
        style={styles.userCard}
        onPress={() => {
          if (isStaffRole(item.role)) {
            navigation.getParent()?.navigate('AdminStaffProfile', { person: item });
          } else {
            navigation.getParent()?.navigate('AdminFamilyProfile', { person: item });
          }
        }}
        activeOpacity={0.7}
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
        <Ionicons name="chevron-forward" size={17} color={colors.textFaint} />
      </TouchableOpacity>
    );
  }

  if (loading) return <LoadingScreen />;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle}>People</Text>
            <Text style={styles.headerSub}>{users.length} connected people · {invites.length} pending invite{invites.length === 1 ? '' : 's'}</Text>
          </View>
          <TouchableOpacity style={styles.inviteBtn} onPress={() => setInviteOpen(true)}>
            <Ionicons name="person-add-outline" size={17} color={colors.white} />
            <Text style={styles.inviteBtnText}>Invite</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.searchWrap}>
        <Ionicons name="search-outline" size={18} color={colors.textFaint} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search people or rooms"
          placeholderTextColor={colors.textFaint}
          style={styles.searchInput}
          accessibilityLabel="Search people or rooms"
        />
        {search ? (
          <TouchableOpacity onPress={() => setSearch('')} accessibilityLabel="Clear search">
            <Ionicons name="close-circle" size={18} color={colors.textFaint} />
          </TouchableOpacity>
        ) : null}
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
                <View
                  key={inv.id}
                  style={styles.inviteCard}
                >
                  <View style={styles.inviteTopRow}>
                    <View style={styles.inviteAvatar}><Ionicons name="mail-unread-outline" size={18} color={colors.amber} /></View>
                    <View style={{ flex: 1 }}>
                    <Text style={styles.inviteEmail}>{inv.full_name || inv.email}</Text>
                    <Text style={styles.inviteMeta}>
                      {inv.job_title || 'Educator'}
                      {inv.classroom?.name ? ` · ${inv.classroom.name}` : ''}
                      {inv.require_background_check ? ' · Clearance required' : ''}
                    </Text>
                    {inv.full_name ? <Text style={styles.inviteAddress}>{inv.email}</Text> : null}
                    </View>
                    <Badge label="Invited" color={colors.amber} bg={colors.amberLight} />
                  </View>
                  <View style={styles.inviteActions}>
                    <TouchableOpacity
                      onPress={() => handleRevokeInvite(inv)}
                      disabled={busyInviteId === inv.id}
                      style={styles.revokeButton}
                      accessibilityRole="button"
                      accessibilityLabel={`Cancel invitation for ${inv.full_name || inv.email}`}
                    >
                      <Text style={styles.revokeText}>Cancel invite</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => handleResendInvite(inv)}
                      disabled={busyInviteId === inv.id}
                      style={styles.resendButton}
                      accessibilityRole="button"
                      accessibilityLabel={`Resend invitation to ${inv.full_name || inv.email}`}
                    >
                      <Ionicons name="refresh-outline" size={15} color={colors.primary} />
                      <Text style={styles.resendText}>{busyInviteId === inv.id ? 'Working…' : 'Resend'}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
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
        <KeyboardAvoidingView
          style={styles.modalBackdrop}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            contentContainerStyle={styles.modalScroll}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Invite an educator</Text>
            <Text style={styles.modalDesc}>
              They'll get an email link. Their account is created with educator access
              to your daycare — no public sign-up.
            </Text>

            <Text style={styles.modalLabel}>Full name</Text>
            <TextInput
              style={[styles.modalInput, inviteErrors.name && styles.modalInputError]}
              value={inviteName}
              onChangeText={(v) => { setInviteName(v); setInviteErrors(current => ({ ...current, name: null, form: null })); }}
              placeholder="Priya Sharma"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="words"
              autoCorrect={false}
            />
            {inviteErrors.name ? <Text style={styles.fieldError}>{inviteErrors.name}</Text> : null}

            <Text style={styles.modalLabel}>Email</Text>
            <TextInput
              style={[styles.modalInput, inviteErrors.email && styles.modalInputError]}
              value={inviteEmail}
              onChangeText={(v) => { setInviteEmail(v); setInviteErrors(current => ({ ...current, email: null, form: null })); }}
              placeholder="educator@email.com"
              placeholderTextColor={colors.textMuted}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />
            {inviteErrors.email ? <Text style={styles.fieldError}>{inviteErrors.email}</Text> : null}
            {inviteErrors.form ? <Text style={styles.modalError}>{inviteErrors.form}</Text> : null}

            <Text style={styles.modalLabel}>Job title</Text>
            <TextInput
              style={styles.modalInput}
              value={inviteJobTitle}
              onChangeText={setInviteJobTitle}
              placeholder="Educator"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="words"
            />

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

            <TouchableOpacity
              style={styles.checkRow}
              onPress={() => setInviteBackgroundCheck((current) => !current)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: inviteBackgroundCheck }}
            >
              <View style={[styles.checkBox, inviteBackgroundCheck && styles.checkBoxActive]}>
                {inviteBackgroundCheck ? (
                  <Ionicons name="checkmark" size={15} color={colors.white} />
                ) : null}
              </View>
              <View style={styles.checkCopy}>
                <Text style={styles.checkTitle}>Require background check</Text>
                <Text style={styles.checkText}>Shown to the educator before they join.</Text>
              </View>
            </TouchableOpacity>

            <Button
              label={sendingInvite ? 'Sending...' : 'Send invite'}
              onPress={handleSendInvite}
              loading={sendingInvite}
              style={{ marginTop: spacing.md }}
            />
            <Button
              label="Cancel"
              variant="ghost"
              onPress={() => { setInviteOpen(false); setInviteErrors({}); }}
              style={{ marginTop: spacing.sm }}
            />
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: spacing.xl, paddingTop: spacing.md, paddingBottom: spacing.md },
  headerTitle: { fontSize: 25, fontFamily: fonts.black, color: colors.textPrimary },
  headerSub: { fontSize: 12.5, fontFamily: fonts.regular, color: colors.textMuted, marginTop: 3 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  inviteBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.primary, borderRadius: radius.md,
    minHeight: 42, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },
  inviteBtnText: { fontSize: 13, fontFamily: fonts.bold, color: colors.white },
  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginHorizontal: spacing.lg, paddingHorizontal: spacing.md, minHeight: 46, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface },
  searchInput: { flex: 1, color: colors.textPrimary, fontFamily: fonts.regular, fontSize: 14, paddingVertical: 0 },
  invitesSection: { marginBottom: spacing.md },
  invitesTitle: {
    fontSize: 13, fontWeight: '600', color: colors.textSecondary,
    marginBottom: spacing.sm, textTransform: 'uppercase', letterSpacing: 0.5,
  },
  inviteCard: {
    backgroundColor: colors.amberLight, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.amber + '44',
    padding: spacing.lg, marginBottom: spacing.sm,
  },
  inviteTopRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  inviteAvatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  inviteActions: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.amber + '33' },
  revokeButton: { minHeight: 38, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md, borderRadius: radius.md },
  revokeText: { color: colors.danger, fontFamily: fonts.bold, fontSize: 12 },
  resendButton: { minHeight: 38, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface },
  resendText: { color: colors.primary, fontFamily: fonts.bold, fontSize: 12 },
  inviteEmail: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  inviteMeta: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  inviteAddress: { fontSize: 11.5, color: colors.textMuted, marginTop: 2 },
  modalBackdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)',
  },
  modalScroll: {
    flexGrow: 1, justifyContent: 'center', padding: spacing.xl,
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
  fieldError: { fontSize: 12, color: colors.danger, fontFamily: fonts.bold, marginTop: -spacing.sm, marginBottom: spacing.md },
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
  checkRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm,
    marginTop: spacing.sm, marginBottom: spacing.sm,
  },
  checkBox: {
    width: 21, height: 21, borderRadius: 5,
    borderWidth: 1.5, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface,
  },
  checkBoxActive: { borderColor: colors.primary, backgroundColor: colors.primary },
  checkCopy: { flex: 1 },
  checkTitle: { fontSize: 13, fontWeight: '600', color: colors.textPrimary },
  checkText: { marginTop: 2, fontSize: 11.5, color: colors.textMuted },
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
