import React, { useState, useEffect } from 'react';
import {
  View, Text, FlatList, TouchableOpacity,
  StyleSheet, ActivityIndicator
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../../hooks/useAuth';
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

export default function ParentMessagesScreen() {
  const navigation              = useNavigation();
  const { profile }             = useAuth();
  const [threads, setThreads]   = useState([]);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    loadThreads();
  }, [profile]);

  async function loadThreads() {
    if (!profile) return;

    // Get linked children
    const { data: links } = await supabase
      .from('parent_children')
      .select('child:children(id, first_name, last_name)')
      .eq('parent_id', profile.id);

    if (!links?.length) { setThreads([]); setLoading(false); return; }

    // For each child, get the latest message
    const threadData = await Promise.all(
      links.map(async (link) => {
        const child = link.child;
        const { data: lastMsg } = await supabase
          .from('messages')
          .select('body, created_at, sender:profiles(full_name, role)')
          .eq('child_id', child.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .single();

        // Count unread (messages from educators since parent's last message)
        const { data: parentLastMsg } = await supabase
          .from('messages')
          .select('created_at')
          .eq('child_id', child.id)
          .eq('sender_id', profile.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .single();

        let unread = 0;
        if (parentLastMsg) {
          const { count } = await supabase
            .from('messages')
            .select('id', { count: 'exact', head: true })
            .eq('child_id', child.id)
            .neq('sender_id', profile.id)
            .gt('created_at', parentLastMsg.created_at);
          unread = count || 0;
        } else if (lastMsg) {
          // Parent never sent a message — all educator messages are "unread"
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
          initial: child.first_name[0],
          lastMessage: lastMsg?.body || null,
          lastMessageTime: lastMsg?.created_at || null,
          lastSender: lastMsg?.sender?.full_name || null,
          lastSenderRole: lastMsg?.sender?.role || null,
          unread,
        };
      })
    );

    setThreads(threadData);
    setLoading(false);
  }

  function renderThread({ item }) {
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
          <Text style={styles.threadInitial}>{item.initial}</Text>
        </View>
        <View style={styles.threadBody}>
          <View style={styles.threadTop}>
            <Text style={styles.threadName}>{item.childName}</Text>
            {item.lastMessageTime && (
              <Text style={styles.threadTime}>{formatTime(item.lastMessageTime)}</Text>
            )}
          </View>
          {item.lastMessage ? (
            <Text style={[styles.threadPreview, item.unread > 0 && styles.threadPreviewUnread]} numberOfLines={2}>
              {item.lastSenderRole === 'educator' ? `${item.lastSender}: ` : 'You: '}
              {item.lastMessage}
            </Text>
          ) : (
            <Text style={styles.threadEmpty}>No messages yet — start a conversation</Text>
          )}
        </View>
        {item.unread > 0 && (
          <View style={styles.unreadBadge}>
            <Text style={styles.unreadText}>{item.unread}</Text>
          </View>
        )}
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Messages</Text>
        <Text style={styles.headerSub}>Chat with your children's educators</Text>
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
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyIcon}>💬</Text>
              <Text style={styles.emptyText}>No children linked yet.</Text>
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
  list: { padding: spacing.lg },
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
  threadBody: { flex: 1 },
  threadTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 },
  threadName: { fontSize: 15, fontWeight: '600', color: colors.textPrimary },
  threadTime: { fontSize: 12, color: colors.textMuted },
  threadPreview: { fontSize: 13, color: colors.textSecondary, lineHeight: 18 },
  threadPreviewUnread: { color: colors.textPrimary, fontWeight: '500' },
  threadEmpty: { fontSize: 13, color: colors.textMuted, fontStyle: 'italic' },
  unreadBadge: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  unreadText: { fontSize: 12, color: colors.white, fontWeight: '700' },
  emptyWrap: { paddingTop: 60, alignItems: 'center' },
  emptyIcon: { fontSize: 40, marginBottom: spacing.md },
  emptyText: { fontSize: 15, color: colors.textMuted },
});
