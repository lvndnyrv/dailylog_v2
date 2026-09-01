import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../lib/supabase';
import { colors, fonts, radius, spacing } from '../../theme';

const ROLE_LABELS = {
  owner_admin: 'Owner admin',
  admin: 'Administrator',
  educator: 'Educator',
};

export default function StaffMessagesScreen({ navigation }) {
  const { profile } = useAuth();
  const [threads, setThreads] = useState([]);
  const [team, setTeam] = useState([]);
  const [loading, setLoading] = useState(true);
  const [startingId, setStartingId] = useState(null);
  const [showTeam, setShowTeam] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async (showLoading = false) => {
    if (!profile?.id) return;
    if (showLoading) setLoading(true);
    const [{ data: threadRows, error: threadError }, { data: teamRows, error: teamError }] = await Promise.all([
      supabase.rpc('list_my_staff_conversations'),
      supabase
        .from('profiles')
        .select('id, full_name, role')
        .in('role', ['owner_admin', 'admin', 'educator'])
        .is('archived_at', null)
        .neq('id', profile.id)
        .order('full_name'),
    ]);
    setLoading(false);
    if (threadError || teamError) {
      setError(threadError?.message || teamError?.message || 'Could not load team messages.');
      return;
    }
    setError(null);
    setThreads(threadRows || []);
    setTeam(teamRows || []);
  }, [profile?.id]);

  useFocusEffect(useCallback(() => {
    void load(true);
  }, [load]));

  useEffect(() => {
    if (!profile?.id) return undefined;
    const channel = supabase
      .channel(`staff-inbox:${profile.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, () => {
        void load(false);
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [load, profile?.id]);

  function openThread(thread) {
    navigation.navigate('StaffConversation', {
      conversationId: thread.conversation_id,
      otherProfileId: thread.other_profile_id,
      otherName: thread.other_full_name,
      otherRole: thread.other_role,
    });
  }

  async function startConversation(person) {
    setStartingId(person.id);
    setError(null);
    const { data: conversationId, error: startError } = await supabase.rpc(
      'get_or_create_staff_conversation',
      { p_other_profile_id: person.id },
    );
    setStartingId(null);
    if (startError) {
      setError(startError.message);
      return;
    }
    setShowTeam(false);
    navigation.navigate('StaffConversation', {
      conversationId,
      otherProfileId: person.id,
      otherName: person.full_name,
      otherRole: person.role,
    });
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.iconButton}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="chevron-back" size={23} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.eyebrow}>PRIVATE TEAM CHAT</Text>
          <Text style={styles.title}>Team messages</Text>
        </View>
        <TouchableOpacity
          onPress={() => setShowTeam(true)}
          style={styles.newButton}
          accessibilityRole="button"
          accessibilityLabel="Start a team message"
        >
          <Ionicons name="create-outline" size={18} color={colors.white} />
          <Text style={styles.newButtonText}>New</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.privacyNote}>
        <Ionicons name="lock-closed-outline" size={17} color={colors.primary} />
        <Text style={styles.privacyText}>Each thread is visible only to its two participants.</Text>
      </View>

      {loading ? (
        <View style={styles.centered}><ActivityIndicator size="large" color={colors.primary} /></View>
      ) : error && threads.length === 0 ? (
        <View style={styles.centered}>
          <Ionicons name="cloud-offline-outline" size={34} color={colors.textFaint} />
          <Text style={styles.emptyTitle}>Messages are unavailable</Text>
          <Text style={styles.emptyBody}>{error}</Text>
          <TouchableOpacity onPress={() => load(true)} style={styles.retryButton}>
            <Text style={styles.retryText}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={threads}
          keyExtractor={(item) => item.conversation_id}
          contentContainerStyle={threads.length ? styles.listContent : styles.emptyContent}
          renderItem={({ item }) => {
            const unread = Number(item.unread_count || 0);
            return (
              <TouchableOpacity style={styles.threadCard} onPress={() => openThread(item)} activeOpacity={0.72}>
                <InitialAvatar name={item.other_full_name} />
                <View style={styles.threadCopy}>
                  <View style={styles.threadHeading}>
                    <Text numberOfLines={1} style={[styles.threadName, unread > 0 && styles.threadNameUnread]}>
                      {item.other_full_name}
                    </Text>
                    <Text style={styles.time}>{formatRelative(item.last_message_at)}</Text>
                  </View>
                  <Text style={styles.role}>{ROLE_LABELS[item.other_role] || item.other_role}</Text>
                  <Text numberOfLines={1} style={[styles.preview, unread > 0 && styles.previewUnread]}>
                    {item.last_message_body || 'No messages yet — say hello.'}
                  </Text>
                </View>
                {unread > 0 ? (
                  <View style={styles.badge}><Text style={styles.badgeText}>{unread > 99 ? '99+' : unread}</Text></View>
                ) : (
                  <Ionicons name="chevron-forward" size={19} color={colors.textFaint} />
                )}
              </TouchableOpacity>
            );
          }}
          ListEmptyComponent={(
            <View style={styles.centered}>
              <View style={styles.emptyIcon}>
                <Ionicons name="chatbubbles-outline" size={34} color={colors.primary} />
              </View>
              <Text style={styles.emptyTitle}>No team messages yet</Text>
              <Text style={styles.emptyBody}>Start a private conversation with an administrator or educator.</Text>
              <TouchableOpacity onPress={() => setShowTeam(true)} style={styles.startButton}>
                <Text style={styles.startButtonText}>Start a conversation</Text>
              </TouchableOpacity>
            </View>
          )}
        />
      )}

      <Modal visible={showTeam} transparent animationType="slide" onRequestClose={() => setShowTeam(false)}>
        <View style={styles.modalOverlay}>
          <TouchableOpacity style={styles.modalDismiss} activeOpacity={1} onPress={() => setShowTeam(false)} />
          <View style={styles.sheet}>
            <View style={styles.grabber} />
            <View style={styles.sheetHeader}>
              <View>
                <Text style={styles.sheetTitle}>New team message</Text>
                <Text style={styles.sheetSubtitle}>Choose one person</Text>
              </View>
              <TouchableOpacity onPress={() => setShowTeam(false)} style={styles.iconButton} accessibilityLabel="Close">
                <Ionicons name="close" size={21} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
            {team.map((person, index) => (
              <TouchableOpacity
                key={person.id}
                onPress={() => startConversation(person)}
                disabled={startingId != null}
                style={[styles.personRow, index > 0 && styles.personBorder]}
              >
                <InitialAvatar name={person.full_name} />
                <View style={styles.threadCopy}>
                  <Text style={styles.personName}>{person.full_name}</Text>
                  <Text style={styles.role}>{ROLE_LABELS[person.role] || person.role}</Text>
                </View>
                {startingId === person.id
                  ? <ActivityIndicator color={colors.primary} />
                  : <Ionicons name="chevron-forward" size={19} color={colors.textFaint} />}
              </TouchableOpacity>
            ))}
            {team.length === 0 && <Text style={styles.noTeam}>No other active team members were found.</Text>}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function InitialAvatar({ name }) {
  const initials = String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
  return <View style={styles.avatar}><Text style={styles.avatarText}>{initials || '?'}</Text></View>;
}

function formatRelative(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const minutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60000));
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h`;
  return date.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.xl, paddingTop: spacing.sm, paddingBottom: spacing.md },
  iconButton: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  headerText: { flex: 1 },
  eyebrow: { fontSize: 10.5, letterSpacing: 1.5, fontFamily: fonts.bold, color: colors.textFaint },
  title: { marginTop: 2, fontSize: 24, lineHeight: 30, fontFamily: fonts.black, color: colors.textPrimary },
  newButton: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: colors.primary, borderRadius: radius.md, paddingHorizontal: spacing.md, height: 42 },
  newButtonText: { color: colors.white, fontFamily: fonts.bold, fontSize: 13.5 },
  privacyNote: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginHorizontal: spacing.xl, marginBottom: spacing.md, padding: spacing.md, borderRadius: radius.lg, backgroundColor: colors.primaryLight },
  privacyText: { flex: 1, fontSize: 12.5, lineHeight: 17, fontFamily: fonts.regular, color: colors.textSecondary },
  listContent: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxxl, gap: spacing.sm },
  emptyContent: { flexGrow: 1 },
  threadCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 84, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primaryLight },
  avatarText: { color: colors.primary, fontFamily: fonts.bold, fontSize: 14 },
  threadCopy: { flex: 1, minWidth: 0 },
  threadHeading: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  threadName: { flex: 1, fontSize: 15, fontFamily: fonts.bold, color: colors.textPrimary },
  threadNameUnread: { fontFamily: fonts.black },
  role: { marginTop: 1, fontSize: 11.5, fontFamily: fonts.regular, color: colors.textFaint },
  preview: { marginTop: 4, fontSize: 12.5, fontFamily: fonts.regular, color: colors.textSecondary },
  previewUnread: { fontFamily: fonts.bold, color: colors.textPrimary },
  time: { fontSize: 10.5, fontFamily: fonts.regular, color: colors.textFaint },
  badge: { minWidth: 22, height: 22, paddingHorizontal: 6, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary },
  badgeText: { color: colors.white, fontFamily: fonts.bold, fontSize: 10.5 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xxxl },
  emptyIcon: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primaryLight, marginBottom: spacing.lg },
  emptyTitle: { marginTop: spacing.md, fontSize: 18, fontFamily: fonts.black, color: colors.textPrimary, textAlign: 'center' },
  emptyBody: { marginTop: spacing.sm, maxWidth: 300, fontSize: 13.5, lineHeight: 19, fontFamily: fonts.regular, color: colors.textSecondary, textAlign: 'center' },
  retryButton: { marginTop: spacing.lg, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.primary },
  retryText: { color: colors.primary, fontFamily: fonts.bold },
  startButton: { marginTop: spacing.xl, backgroundColor: colors.primary, borderRadius: radius.md, paddingHorizontal: spacing.xl, paddingVertical: spacing.md },
  startButtonText: { color: colors.white, fontFamily: fonts.bold, fontSize: 14 },
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(23,51,91,.34)' },
  modalDismiss: { flex: 1 },
  sheet: { maxHeight: '72%', paddingHorizontal: spacing.xl, paddingTop: spacing.md, paddingBottom: 36, borderTopLeftRadius: 28, borderTopRightRadius: 28, backgroundColor: colors.surface },
  grabber: { width: 42, height: 4, borderRadius: 2, alignSelf: 'center', backgroundColor: colors.borderStrong, marginBottom: spacing.md },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  sheetTitle: { fontSize: 20, fontFamily: fonts.black, color: colors.textPrimary },
  sheetSubtitle: { marginTop: 2, fontSize: 12.5, fontFamily: fonts.regular, color: colors.textSecondary },
  personRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 70, paddingVertical: spacing.md },
  personBorder: { borderTopWidth: 1, borderTopColor: colors.borderSoft },
  personName: { fontSize: 14.5, fontFamily: fonts.bold, color: colors.textPrimary },
  noTeam: { paddingVertical: spacing.xxl, textAlign: 'center', color: colors.textMuted, fontFamily: fonts.regular },
});
