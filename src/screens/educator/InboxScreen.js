import React, { useState, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity,
  StyleSheet, ActivityIndicator, RefreshControl
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../../hooks/useAuth';
import { useClassroom } from '../../hooks/useClassroom';
import { supabase } from '../../lib/supabase';
import { colors, spacing, radius } from '../../theme';
import { format, isToday, isYesterday } from 'date-fns';

function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (isToday(d)) return format(d, 'h:mm a');
  if (isYesterday(d)) return 'Yesterday';
  return format(d, 'MMM d');
}

export default function InboxScreen() {
  const navigation = useNavigation();
  const { profile } = useAuth();
  const { active } = useClassroom();
  const [threads, setThreads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Reload threads every time the screen is focused
  useFocusEffect(
    useCallback(() => {
      loadThreads();
    }, [active?.id, profile?.id])
  );

  async function loadThreads() {
    if (!profile || !active) {
      setLoading(false);
      return;
    }

    // Get children in active classroom (excluding archived)
    const { data: children } = await supabase
      .from('children')
      .select('id, first_name, last_name')
      .eq('classroom_id', active.id)
      .is('archived_at', null)
      .order('first_name');

    if (!children?.length) {
      setThreads([]);
      setLoading(false);
      return;
    }

    // For each child, fetch latest message and unread count
    const threadData = await Promise.all(
      children.map(async (child) => {
        // Latest message in thread
        const { data: lastMsg } = await supabase
          .from('messages')
          .select('body, created_at, sender_id, sender:profiles(full_name, role)')
          .eq('child_id', child.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        // Count unread: messages from parents since educator's last message
        let unread = 0;
        const { data: myLastMsg } = await supabase
          .from('messages')
          .select('created_at')
          .eq('child_id', child.id)
          .eq('sender_id', profile.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (myLastMsg) {
          const { count } = await supabase
            .from('messages')
            .select('id', { count: 'exact', head: true })
            .eq('child_id', child.id)
            .neq('sender_id', profile.id)
            .gt('created_at', myLastMsg.created_at);
          unread = count || 0;
        } else if (lastMsg) {
          // Educator never replied — all parent messages are "unread"
          const { count } = await supabase
            .from('messages')
            .select('id', { count: 'exact', head: true })
            .eq('child_id', child.id)
            .neq('sender_id', profile.id);
          unread = count || 0;
        }

        return {
          childId: child.id,
          childName: `${child.first_name} ${child.last_name || ''}`.trim(),
          childFirstName: child.first_name,
          initial: child.first_name[0]?.toUpperCase() || '?',
          lastMessage: lastMsg?.body || null,
          lastMessageTime: lastMsg?.created_at || null,
          lastSenderRole: lastMsg?.sender?.role || null,
          lastSenderName: lastMsg?.sender?.full_name || null,
          isMe: lastMsg?.sender_id === profile.id,
          unread,
        };
      })
    );

    // Sort: unread first, then by most recent message
    threadData.sort((a, b) => {
      if (a.unread > 0 && b.unread === 0) return -1;
      if (b.unread > 0 && a.unread === 0) return 1;
      if (a.lastMessageTime && b.lastMessageTime) {
        return new Date(b.lastMessageTime) - new Date(a.lastMessageTime);
      }
      if (a.lastMessageTime) return -1;
      if (b.lastMessageTime) return 1;
      return 0;
    });

    setThreads(threadData);
    setLoading(false);
  }

  async function handleRefresh() {
    setRefreshing(true);
    await loadThreads();
    setRefreshing(false);
  }

  function renderThread({ item }) {
    const previewPrefix = item.isMe
      ? 'You: '
      : item.lastSenderRole === 'parent'
        ? `${item.lastSenderName || 'Parent'}: `
        : '';

    return (
      <TouchableOpacity
        style={styles.threadCard}
        onPress={() => navigation.navigate('Messaging', {
          childId: item.childId,
          childName: item.childFirstName,
        })}
        activeOpacity={0.7}
      >
        <View style={[styles.threadAvatar, item.unread > 0 && styles.threadAvatarUnread]}>
          <Text style={[styles.threadInitial, item.unread > 0 && styles.threadInitialUnread]}>
            {item.initial}
          </Text>
        </View>
        <View style={styles.threadBody}>
          <View style={styles.threadTop}>
            <Text style={styles.threadName}>{item.childName}</Text>
            {item.lastMessageTime && (
              <Text style={[styles.threadTime, item.unread > 0 && styles.threadTimeUnread]}>
                {formatTime(item.lastMessageTime)}
              </Text>
            )}
          </View>
          {item.lastMessage ? (
            <Text
              style={[styles.threadPreview, item.unread > 0 && styles.threadPreviewUnread]}
              numberOfLines={2}
            >
              {previewPrefix}{item.lastMessage}
            </Text>
          ) : (
            <Text style={styles.threadEmpty}>No messages yet — tap to start</Text>
          )}
        </View>
        {item.unread > 0 && (
          <View style={styles.unreadBadge}>
            <Text style={styles.unreadText}>{item.unread > 99 ? '99+' : item.unread}</Text>
          </View>
        )}
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Inbox</Text>
        <Text style={styles.headerSub}>
          {active ? `${active.name} — Messages with parents` : 'Messages with parents'}
        </Text>
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : (
        <FlatList
          data={threads}
          keyExtractor={t => t.childId}
          renderItem={renderThread}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              colors={[colors.primary]}
              tintColor={colors.primary}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyIcon}>💬</Text>
              <Text style={styles.emptyTitle}>No conversations yet</Text>
              <Text style={styles.emptyText}>
                Messages will appear here when you or a parent{'\n'}starts a conversation about a child.
              </Text>
            </View>
          }
        />
      )}
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
  loadingWrap: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  list: { padding: spacing.lg, paddingBottom: 100 },
  threadCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.surface, borderRadius: radius.lg,
    padding: spacing.lg, marginBottom: spacing.sm,
    borderWidth: 1, borderColor: colors.border,
    gap: spacing.md,
  },
  threadAvatar: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: colors.primaryLight,
    alignItems: 'center', justifyContent: 'center',
  },
  threadAvatarUnread: { backgroundColor: colors.primary },
  threadInitial: { fontSize: 18, fontWeight: '700', color: colors.primary },
  threadInitialUnread: { color: colors.white },
  threadBody: { flex: 1 },
  threadTop: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 3,
  },
  threadName: { fontSize: 15, fontWeight: '600', color: colors.textPrimary },
  threadTime: { fontSize: 12, color: colors.textMuted },
  threadTimeUnread: { color: colors.primary, fontWeight: '600' },
  threadPreview: { fontSize: 13, color: colors.textSecondary, lineHeight: 18 },
  threadPreviewUnread: { color: colors.textPrimary, fontWeight: '500' },
  threadEmpty: { fontSize: 13, color: colors.textMuted, fontStyle: 'italic' },
  unreadBadge: {
    minWidth: 22, height: 22, borderRadius: 11,
    backgroundColor: colors.primary, paddingHorizontal: 5,
    alignItems: 'center', justifyContent: 'center',
  },
  unreadText: { fontSize: 11, color: colors.white, fontWeight: '700' },
  emptyWrap: { paddingTop: 80, alignItems: 'center' },
  emptyIcon: { fontSize: 48, marginBottom: spacing.lg },
  emptyTitle: { fontSize: 17, fontWeight: '600', color: colors.textPrimary, marginBottom: spacing.sm },
  emptyText: { fontSize: 14, color: colors.textMuted, textAlign: 'center', lineHeight: 20 },
});




