import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, FlatList, TouchableOpacity,
  StyleSheet, TextInput, KeyboardAvoidingView,
  Platform, ActivityIndicator
} from 'react-native';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../lib/supabase';
import { mutate } from '../../lib/offlineQueue';
import { newId } from '../../lib/uuid';
import { toastError } from '../../components/Toast';
import { colors, spacing, radius } from '../../theme';
import { format, isToday, isYesterday } from 'date-fns';

function formatMsgTime(ts) {
  const d = new Date(ts);
  if (isToday(d))     return format(d, 'h:mm a');
  if (isYesterday(d)) return `Yesterday ${format(d, 'h:mm a')}`;
  return format(d, 'MMM d, h:mm a');
}

export default function MessagingScreen({ route, navigation }) {
  const { childId, childName } = route.params;
  const { profile }            = useAuth();
  const [messages, setMessages] = useState([]);
  const [participants, setParticipants] = useState({ educator: null, parent: null });
  const [text, setText]         = useState('');
  const [loading, setLoading]   = useState(true);
  const [sending, setSending]   = useState(false);
  const listRef                 = useRef(null);

  useEffect(() => {
    loadMessages();

    // Real-time subscription — dedupes against optimistic sends by id
    const channel = supabase
      .channel(`messages:${childId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `child_id=eq.${childId}`,
      }, payload => {
        setMessages(prev => prev.some(m => m.id === payload.new.id)
          ? prev.map(m => (m.id === payload.new.id ? { ...m, ...payload.new } : m))
          : [...prev, payload.new]);
        setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
        // Mark incoming messages as read immediately if they're not mine
        if (payload.new.sender_id !== profile.id) {
          markMessagesAsRead([payload.new.id]);
        }
      })
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, [childId]);

  // Mark messages from others as read
  async function markMessagesAsRead(messageIds) {
    if (!messageIds?.length) return;
    await supabase
      .from('messages')
      .update({ read_at: new Date().toISOString() })
      .in('id', messageIds)
      .is('read_at', null)
      .neq('sender_id', profile.id);
  }

  async function loadMessages() {
    const { data } = await supabase
      .from('messages')
      .select('*, sender:profiles(full_name, role)')
      .eq('child_id', childId)
      .order('created_at', { ascending: true });
    setMessages(data || []);
    setLoading(false);
    setTimeout(() => listRef.current?.scrollToEnd({ animated: false }), 100);

    // Extract participant names from messages
    if (data?.length) {
      const educatorMsg = data.find(m => m.sender?.role === 'educator' || m.sender?.role === 'admin');
      const parentMsg = data.find(m => m.sender?.role === 'parent');
      setParticipants({
        educator: educatorMsg?.sender?.full_name || null,
        parent: parentMsg?.sender?.full_name || null,
      });
    }

    // Mark all unread messages from others as read
    if (data?.length) {
      const unreadFromOthers = data.filter(
        m => m.sender_id !== profile.id && !m.read_at
      );
      if (unreadFromOthers.length > 0) {
        markMessagesAsRead(unreadFromOthers.map(m => m.id));
      }
    }
  }

  async function handleSend() {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setText('');

    // Optimistic append with a client-generated id (works offline too)
    const row = {
      id: newId(),
      child_id: childId,
      sender_id: profile.id,
      body: trimmed,
    };
    setMessages(prev => [...prev, {
      ...row,
      created_at: new Date().toISOString(),
      sender: { full_name: profile.full_name, role: profile.role },
    }]);
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);

    const { error } = await mutate({ type: 'insert', table: 'messages', data: row });
    if (error) {
      // Hard failure — roll back and restore the draft
      setMessages(prev => prev.filter(m => m.id !== row.id));
      setText(trimmed);
      toastError('Message not sent', error);
    }
    setSending(false);
  }

  function renderMessage({ item, index }) {
    const isMe    = item.sender_id === profile.id;
    const prev    = messages[index - 1];
    const showName = !isMe && (!prev || prev.sender_id !== item.sender_id);

    return (
      <View style={[styles.msgWrap, isMe && styles.msgWrapMe]}>
        {showName && (
          <Text style={styles.msgSender}>
            {item.sender?.full_name || (item.sender?.role === 'parent' ? 'Parent' : 'Educator')}
          </Text>
        )}
        <View style={[styles.bubble, isMe && styles.bubbleMe]}>
          <Text style={[styles.bubbleText, isMe && styles.bubbleTextMe]}>{item.body}</Text>
        </View>
        <Text style={[styles.msgTime, isMe && styles.msgTimeMe]}>
          {formatMsgTime(item.created_at)}
        </Text>
      </View>
    );
  }

  // Build header subtitle showing participant names
  const headerSub = participants.educator && participants.parent
    ? `${participants.educator} ↔ ${participants.parent}`
    : participants.educator
      ? `${participants.educator} · Educator`
      : participants.parent
        ? `${participants.parent} · Parent`
        : 'Educator ↔ Parent';

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={90}
    >
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.back}>← Back</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>{childName}</Text>
          <Text style={styles.headerSub}>{headerSub}</Text>
        </View>
        <View style={{ width: 60 }} />
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={m => m.id}
          renderItem={renderMessage}
          contentContainerStyle={styles.msgList}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyIcon}>💬</Text>
              <Text style={styles.emptyText}>No messages yet.{'\n'}Start the conversation below.</Text>
            </View>
          }
        />
      )}

      {/* Input bar */}
      <View style={styles.inputBar}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="Type a message..."
          placeholderTextColor={colors.textMuted}
          style={styles.input}
          multiline
          maxLength={500}
          returnKeyType="default"
        />
        <TouchableOpacity
          onPress={handleSend}
          disabled={!text.trim() || sending}
          style={[styles.sendBtn, (!text.trim() || sending) && styles.sendBtnDisabled]}
        >
          {sending
            ? <ActivityIndicator color={colors.white} size="small" />
            : <Text style={styles.sendBtnText}>↑</Text>
          }
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: spacing.lg, paddingTop: spacing.xl,
    backgroundColor: colors.surface,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  back: { fontSize: 15, color: colors.primary, fontWeight: '500', width: 60 },
  headerCenter: { alignItems: 'center' },
  headerTitle: { fontSize: 16, fontWeight: '600', color: colors.textPrimary },
  headerSub: { fontSize: 12, color: colors.textSecondary },
  loadingWrap: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  msgList: { padding: spacing.lg, paddingBottom: spacing.xl },
  emptyWrap: { paddingTop: 60, alignItems: 'center' },
  emptyIcon: { fontSize: 40, marginBottom: spacing.md },
  emptyText: { fontSize: 15, color: colors.textMuted, textAlign: 'center', lineHeight: 22 },
  msgWrap: { marginBottom: spacing.sm, alignItems: 'flex-start', maxWidth: '80%' },
  msgWrapMe: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  msgSender: { fontSize: 11, color: colors.textMuted, marginBottom: 3, marginLeft: spacing.sm },
  bubble: {
    backgroundColor: colors.surface, borderRadius: radius.lg,
    borderBottomLeftRadius: 4, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },
  bubbleMe: {
    backgroundColor: colors.primary, borderColor: colors.primary,
    borderBottomLeftRadius: radius.lg, borderBottomRightRadius: 4,
  },
  bubbleText: { fontSize: 15, color: colors.textPrimary, lineHeight: 20 },
  bubbleTextMe: { color: colors.white },
  msgTime: { fontSize: 11, color: colors.textMuted, marginTop: 3, marginLeft: spacing.sm },
  msgTimeMe: { marginLeft: 0, marginRight: spacing.sm },
  inputBar: {
    flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm,
    padding: spacing.md, paddingBottom: spacing.xl,
    backgroundColor: colors.surface,
    borderTopWidth: 1, borderTopColor: colors.border,
  },
  input: {
    flex: 1, backgroundColor: colors.bg,
    borderRadius: radius.xl, borderWidth: 1.5, borderColor: colors.border,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    fontSize: 15, color: colors.textPrimary,
    maxHeight: 100, minHeight: 42,
  },
  sendBtn: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  sendBtnDisabled: { backgroundColor: colors.border },
  sendBtnText: { fontSize: 20, color: colors.white, fontWeight: '700', marginTop: -2 },
});
