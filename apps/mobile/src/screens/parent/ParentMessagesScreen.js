import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { isStaffRole } from '@dailylog/shared';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { format, isToday, isYesterday } from 'date-fns';
import { useAuth } from '../../hooks/useAuth';
import { useParentFamily } from '../../hooks/useParentFamily';
import { supabase } from '../../lib/supabase';
import { colors, fonts, radius, spacing } from '../../theme';

function formatTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (isToday(date)) return format(date, 'h:mm a');
  if (isYesterday(date)) return 'Yesterday';
  return format(date, 'MMM d');
}

export default function ParentMessagesScreen() {
  const navigation = useNavigation();
  const { profile } = useAuth();
  const family = useParentFamily();
  const [threads, setThreads] = useState([]);
  const [announcement, setAnnouncement] = useState(null);
  const [announcementUnread, setAnnouncementUnread] = useState(0);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const filteredThreads = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return threads;
    return threads.filter((thread) => (
      thread.childName.toLowerCase().includes(normalized)
      || thread.roomName.toLowerCase().includes(normalized)
      || thread.lastMessage?.toLowerCase().includes(normalized)
      || thread.lastSender?.toLowerCase().includes(normalized)
    ));
  }, [query, threads]);

  const load = useCallback(async () => {
    if (!profile?.id) return;
    setError(null);

    try {
      const { data: announcements, error: announcementError } = await supabase
        .from('announcements')
        .select('id, title, created_at')
        .order('pinned', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(20);
      if (announcementError) throw announcementError;

      const visibleAnnouncements = announcements || [];
      setAnnouncement(visibleAnnouncements[0] || null);

      if (visibleAnnouncements.length) {
        const { data: reads, error: readsError } = await supabase
          .from('announcement_reads')
          .select('announcement_id')
          .eq('profile_id', profile.id)
          .in('announcement_id', visibleAnnouncements.map((item) => item.id));
        if (readsError) throw readsError;
        const readIds = new Set((reads || []).map((item) => item.announcement_id));
        setAnnouncementUnread(
          visibleAnnouncements.filter((item) => !readIds.has(item.id)).length,
        );
      } else {
        setAnnouncementUnread(0);
      }

      const threadRows = await Promise.all(
        family.children.map(async (child) => {
          const [messagesResult, unreadResult] = await Promise.all([
          supabase
            .from('messages')
            .select('body, created_at, sender_id, sender:profiles(full_name, role)')
            .eq('child_id', child.id)
            .order('created_at', { ascending: false })
            .limit(20),
          supabase
            .from('messages')
            .select('id', { count: 'exact', head: true })
            .eq('child_id', child.id)
            .neq('sender_id', profile.id)
            .is('read_at', null),
          ]);
          if (messagesResult.error) throw messagesResult.error;
          if (unreadResult.error) throw unreadResult.error;
          const recentMessages = messagesResult.data;
          const unread = unreadResult.count;
        const lastMessage = recentMessages?.[0] || null;
        const staffMessage = recentMessages?.find((message) => (
          isStaffRole(message.sender?.role)
        ));
        const staffName = staffMessage?.sender?.full_name || null;
        return {
          childId: child.id,
          childName: `${child.first_name} ${child.last_name || ''}`.trim(),
          childFirstName: child.first_name,
          roomName: child.classroom?.name || 'Classroom',
          initial: staffName?.charAt(0) || child.first_name?.charAt(0) || '?',
          staffName,
          lastMessage: lastMessage?.body || null,
          lastMessageTime: lastMessage?.created_at || null,
          lastSender: lastMessage?.sender?.full_name || '',
          isMe: lastMessage?.sender_id === profile.id,
          unread: unread || 0,
        };
        }),
      );

      threadRows.sort((left, right) => {
        if (left.childId === family.selectedChildId) return -1;
        if (right.childId === family.selectedChildId) return 1;
        if (left.unread !== right.unread) return right.unread - left.unread;
        if (!left.lastMessageTime && !right.lastMessageTime) return 0;
        if (!left.lastMessageTime) return 1;
        if (!right.lastMessageTime) return -1;
        return new Date(right.lastMessageTime) - new Date(left.lastMessageTime);
      });
      setThreads(threadRows);
    } catch (loadError) {
      setError(loadError.message || 'We could not load your conversations.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [family.children, family.selectedChildId, profile?.id]);

  useFocusEffect(
    useCallback(() => {
      family.refresh({ silent: true }).catch(() => {});
    }, [family.refresh]),
  );

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!profile?.id) return undefined;
    const channel = supabase
      .channel(`parent-inbox:${profile.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'announcements' }, load)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [load, profile?.id]);

  function openThread(item) {
    family.selectChild(item.childId);
    navigation.navigate('Messaging', {
      childId: item.childId,
      childName: item.childFirstName,
    });
  }

  function renderThread({ item, index }) {
    const title = `${item.roomName} · ${item.staffName?.split(' ')[0] || 'Educators'}`;
    const preview = item.lastMessage
      ? `${item.childFirstName}: ${item.isMe ? 'You: ' : ''}${item.lastMessage}`
      : `Start a conversation about ${item.childFirstName}`;
    return (
      <TouchableOpacity
        style={[styles.threadRow, index < filteredThreads.length - 1 && styles.threadRowBorder]}
        onPress={() => openThread(item)}
        activeOpacity={0.72}
      >
        <View style={styles.threadAvatar}>
          <Text style={styles.threadAvatarText}>{item.initial.toUpperCase()}</Text>
          {!!item.staffName && <View style={styles.onlineDot} />}
        </View>
        <View style={styles.threadBody}>
          <Text style={styles.threadTitle} numberOfLines={1}>{title}</Text>
          <Text
            style={[styles.threadPreview, item.unread > 0 && styles.threadPreviewUnread]}
            numberOfLines={1}
          >
            {preview}
          </Text>
        </View>
        <View style={styles.threadMeta}>
          <Text style={[styles.threadTime, item.unread > 0 && styles.threadTimeUnread]}>
            {formatTime(item.lastMessageTime)}
          </Text>
          {item.unread > 0 && (
            <View style={styles.unreadBadge}>
              <Text style={styles.unreadText}>{item.unread > 99 ? '99+' : item.unread}</Text>
            </View>
          )}
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>Chat</Text>

        <View style={styles.search}>
          <Ionicons name="search-outline" size={18} color={colors.textFaint} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search messages…"
            placeholderTextColor={colors.textFaint}
            style={styles.searchInput}
            returnKeyType="search"
          />
          {!!query && (
            <TouchableOpacity onPress={() => setQuery('')} accessibilityRole="button" accessibilityLabel="Clear search">
              <Ionicons name="close-circle" size={18} color={colors.textFaint} />
            </TouchableOpacity>
          )}
        </View>

        {!!announcement && (
          <TouchableOpacity
            style={styles.announcementRow}
            onPress={() => navigation.navigate('Announcements')}
            activeOpacity={0.75}
          >
            <View style={styles.announcementIcon}>
              <Ionicons name="megaphone-outline" size={19} color={colors.primary} />
            </View>
            <View style={styles.announcementCopy}>
              <Text style={styles.announcementTitle}>Announcements</Text>
              <Text style={styles.announcementPreview} numberOfLines={1}>{announcement.title}</Text>
            </View>
            <View style={styles.announcementMeta}>
              <Text style={styles.announcementTime}>{formatTime(announcement.created_at)}</Text>
              {announcementUnread > 0 && (
                <View style={styles.unreadBadge}>
                  <Text style={styles.unreadText}>{announcementUnread}</Text>
                </View>
              )}
            </View>
          </TouchableOpacity>
        )}

        {error ? (
          <TouchableOpacity style={styles.errorBanner} onPress={load}>
            <Text style={styles.errorText}>{error} Tap to retry.</Text>
          </TouchableOpacity>
        ) : null}

        <Text style={styles.sectionLabel}>CONVERSATIONS</Text>

        {loading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={colors.primary} size="large" />
          </View>
        ) : (
          <FlatList
            data={filteredThreads}
            keyExtractor={(item) => item.childId}
            renderItem={renderThread}
            style={styles.threadList}
            contentContainerStyle={!filteredThreads.length ? styles.threadListEmpty : undefined}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => {
                  setRefreshing(true);
                  load();
                }}
                colors={[colors.primary]}
                tintColor={colors.primary}
              />
            }
            ListEmptyComponent={
              <View style={styles.emptyWrap}>
                <View style={styles.emptyIcon}>
                  <Ionicons name="chatbubble-ellipses-outline" size={28} color={colors.primary} />
                </View>
                <Text style={styles.emptyTitle}>{query ? 'No matching messages' : 'No conversations yet'}</Text>
                <Text style={styles.emptyText}>
                  {query
                    ? 'Try a child, classroom, or educator name.'
                    : 'Linked classroom conversations will appear here.'}
                </Text>
              </View>
            }
          />
        )}

        <Text style={styles.hoursNote}>Educators reply during daycare hours, 7 AM – 6 PM.</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: {
    flex: 1,
    paddingTop: spacing.xxl,
    paddingHorizontal: spacing.xxl,
    paddingBottom: spacing.sm,
  },
  title: {
    marginBottom: spacing.lg,
    fontSize: 24,
    lineHeight: 30,
    fontFamily: fonts.black,
    color: colors.textPrimary,
  },
  search: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.lg,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 12,
    fontSize: 14,
    fontFamily: fonts.regular,
    color: colors.textPrimary,
  },
  announcementRow: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: 16,
    backgroundColor: colors.primaryLight,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    marginBottom: spacing.xl,
  },
  announcementIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  announcementCopy: { flex: 1, minWidth: 0 },
  announcementTitle: { fontSize: 14.5, fontFamily: fonts.bold, color: colors.textPrimary },
  announcementPreview: {
    marginTop: 3,
    fontSize: 12.5,
    fontFamily: fonts.regular,
    color: colors.textSecondary,
  },
  announcementMeta: { alignItems: 'flex-end', gap: 5 },
  announcementTime: { fontSize: 11.5, fontFamily: fonts.regular, color: colors.textMuted },
  sectionLabel: {
    marginBottom: spacing.sm,
    fontSize: 12,
    letterSpacing: 1,
    fontFamily: fonts.bold,
    color: colors.textFaint,
  },
  errorBanner: {
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: `${colors.danger}44`,
    borderRadius: radius.md,
    backgroundColor: colors.dangerLight,
    padding: spacing.md,
  },
  errorText: { color: colors.danger, fontSize: 12.5, lineHeight: 18, fontFamily: fonts.bold },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  threadList: {
    flexGrow: 0,
    maxHeight: 330,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 18,
    backgroundColor: colors.surface,
  },
  threadListEmpty: { minHeight: 190, justifyContent: 'center' },
  threadRow: {
    minHeight: 74,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  threadRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.primarySoft },
  threadAvatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  threadAvatarText: { fontSize: 15, fontFamily: fonts.bold, color: colors.primary },
  onlineDot: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 11,
    height: 11,
    borderRadius: 6,
    backgroundColor: colors.success,
    borderWidth: 2.5,
    borderColor: colors.surface,
  },
  threadBody: { flex: 1, minWidth: 0 },
  threadTitle: { fontSize: 14.5, fontFamily: fonts.bold, color: colors.textPrimary },
  threadPreview: {
    marginTop: 4,
    fontSize: 12.5,
    fontFamily: fonts.regular,
    color: colors.textFaint,
  },
  threadPreviewUnread: { fontFamily: fonts.bold, color: colors.textPrimary },
  threadMeta: { alignSelf: 'stretch', alignItems: 'flex-end', justifyContent: 'center', gap: 5 },
  threadTime: { fontSize: 11.5, fontFamily: fonts.regular, color: colors.textFaint },
  threadTimeUnread: { fontFamily: fonts.bold, color: colors.primary },
  unreadBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.primary,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadText: { fontSize: 11.5, fontFamily: fonts.bold, color: colors.white },
  emptyWrap: { alignItems: 'center', paddingHorizontal: spacing.xl },
  emptyIcon: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  emptyTitle: { fontSize: 15, fontFamily: fonts.bold, color: colors.textPrimary },
  emptyText: {
    marginTop: spacing.xs,
    fontSize: 12.5,
    lineHeight: 18,
    fontFamily: fonts.regular,
    color: colors.textMuted,
    textAlign: 'center',
  },
  hoursNote: {
    marginTop: spacing.lg,
    paddingHorizontal: spacing.xl,
    fontSize: 12.5,
    lineHeight: 20,
    fontFamily: fonts.regular,
    color: colors.textFaint,
    textAlign: 'center',
  },
});
