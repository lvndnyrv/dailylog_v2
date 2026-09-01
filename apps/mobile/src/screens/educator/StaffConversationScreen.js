import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../lib/supabase';
import { colors, fonts, radius, spacing } from '../../theme';

const ROLE_LABELS = { owner_admin: 'Owner admin', admin: 'Administrator', educator: 'Educator' };

export default function StaffConversationScreen({ navigation, route }) {
  const { profile } = useAuth();
  const conversationId = route.params?.conversationId;
  const [other, setOther] = useState({
    id: route.params?.otherProfileId || null,
    full_name: route.params?.otherName || 'Team member',
    role: route.params?.otherRole || 'educator',
  });
  const [messages, setMessages] = useState([]);
  const [body, setBody] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const scrollRef = useRef(null);

  const load = useCallback(async () => {
    if (!conversationId) {
      setLoading(false);
      setError('This conversation link is incomplete.');
      return;
    }
    const [{ data: rows, error: messageError }, { data: summaries, error: summaryError }] = await Promise.all([
      supabase
        .from('messages')
        .select('id, body, created_at, read_at, sender_id, sender:profiles(id, full_name, role)')
        .eq('conversation_id', conversationId)
        .order('created_at'),
      supabase.rpc('list_my_staff_conversations'),
    ]);
    setLoading(false);
    if (messageError || summaryError) {
      setError(messageError?.message || summaryError?.message || 'Could not open this conversation.');
      return;
    }
    const summary = (summaries || []).find((item) => item.conversation_id === conversationId);
    if (summary) {
      setOther({ id: summary.other_profile_id, full_name: summary.other_full_name, role: summary.other_role });
    }
    setMessages(rows || []);
    setError(null);
    await supabase.rpc('mark_staff_conversation_read', { p_conversation_id: conversationId });
  }, [conversationId]);

  useEffect(() => {
    void load();
    if (!conversationId) return undefined;
    const channel = supabase
      .channel(`staff-thread:${conversationId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` },
        () => void load(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [conversationId, load]);

  useEffect(() => {
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  }, [messages]);

  async function send() {
    const message = body.trim();
    if (!message || sending || !conversationId) return;
    setSending(true);
    setError(null);
    const { error: sendError } = await supabase.rpc('send_staff_message', {
      p_conversation_id: conversationId,
      p_body: message,
    });
    setSending(false);
    if (sendError) {
      setError(sendError.message);
      return;
    }
    setBody('');
    await load();
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton} accessibilityLabel="Go back">
            <Ionicons name="chevron-back" size={23} color={colors.textPrimary} />
          </TouchableOpacity>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials(other.full_name)}</Text>
          </View>
          <View style={styles.headerCopy}>
            <Text numberOfLines={1} style={styles.name}>{other.full_name}</Text>
            <Text style={styles.role}>{ROLE_LABELS[other.role] || other.role} · private</Text>
          </View>
          <Ionicons name="lock-closed" size={17} color={colors.textFaint} />
        </View>

        {loading ? (
          <View style={styles.centered}><ActivityIndicator size="large" color={colors.primary} /></View>
        ) : error && messages.length === 0 ? (
          <View style={styles.centered}>
            <Ionicons name="alert-circle-outline" size={36} color={colors.textFaint} />
            <Text style={styles.errorTitle}>Could not open messages</Text>
            <Text style={styles.errorBody}>{error}</Text>
            <TouchableOpacity onPress={load} style={styles.retryButton}><Text style={styles.retryText}>Try again</Text></TouchableOpacity>
          </View>
        ) : (
          <ScrollView
            ref={scrollRef}
            style={styles.messages}
            contentContainerStyle={[styles.messagesContent, messages.length === 0 && styles.emptyMessages]}
            keyboardShouldPersistTaps="handled"
            onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
          >
            {messages.length === 0 ? (
              <View style={styles.emptyState}>
                <View style={styles.emptyIcon}><Ionicons name="chatbubble-ellipses-outline" size={32} color={colors.primary} /></View>
                <Text style={styles.emptyTitle}>Start the conversation</Text>
                <Text style={styles.emptyBody}>Coordinate schedules, room coverage, or a private follow-up.</Text>
              </View>
            ) : messages.map((message) => {
              const mine = message.sender_id === profile?.id;
              return (
                <View key={message.id} style={[styles.messageGroup, mine ? styles.mineGroup : styles.theirGroup]}>
                  <Text style={[styles.messageMeta, mine && styles.mineMeta]}>
                    {mine ? 'You' : message.sender?.full_name || other.full_name} · {formatMessageTime(message.created_at)}
                  </Text>
                  <View style={[styles.bubble, mine ? styles.mineBubble : styles.theirBubble]}>
                    <Text style={[styles.messageText, mine && styles.mineText]}>{message.body}</Text>
                  </View>
                </View>
              );
            })}
          </ScrollView>
        )}

        <View style={styles.composerWrap}>
          {error && messages.length > 0 && <Text style={styles.inlineError}>{error}</Text>}
          <View style={styles.composer}>
            <TextInput
              value={body}
              onChangeText={setBody}
              placeholder={`Message ${other.full_name}…`}
              placeholderTextColor={colors.textFaint}
              multiline
              maxLength={4000}
              style={styles.input}
              accessibilityLabel={`Message ${other.full_name}`}
            />
            <TouchableOpacity
              onPress={send}
              disabled={!body.trim() || sending}
              style={[styles.sendButton, (!body.trim() || sending) && styles.sendButtonDisabled]}
              accessibilityRole="button"
              accessibilityLabel="Send message"
            >
              {sending
                ? <ActivityIndicator size="small" color={colors.white} />
                : <Ionicons name="arrow-up" size={20} color={colors.white} />}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function initials(name) {
  return String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '?';
}

function formatMessageTime(timestamp) {
  if (!timestamp) return 'now';
  return new Date(timestamp).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safeArea: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.borderSoft, backgroundColor: colors.surface },
  backButton: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  avatar: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primaryLight },
  avatarText: { color: colors.primary, fontSize: 13.5, fontFamily: fonts.bold },
  headerCopy: { flex: 1, minWidth: 0 },
  name: { fontSize: 16.5, fontFamily: fonts.black, color: colors.textPrimary },
  role: { marginTop: 2, fontSize: 11.5, fontFamily: fonts.regular, color: colors.textMuted },
  messages: { flex: 1 },
  messagesContent: { flexGrow: 1, padding: spacing.lg, gap: spacing.md },
  emptyMessages: { justifyContent: 'center' },
  messageGroup: { maxWidth: '82%' },
  mineGroup: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  theirGroup: { alignSelf: 'flex-start', alignItems: 'flex-start' },
  messageMeta: { marginHorizontal: spacing.sm, marginBottom: 4, fontSize: 10.5, fontFamily: fonts.regular, color: colors.textFaint },
  mineMeta: { textAlign: 'right' },
  bubble: { paddingHorizontal: spacing.md, paddingVertical: 10, borderRadius: 18 },
  mineBubble: { borderBottomRightRadius: 5, backgroundColor: colors.primary },
  theirBubble: { borderBottomLeftRadius: 5, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderSoft },
  messageText: { fontSize: 14, lineHeight: 20, fontFamily: fonts.regular, color: colors.textPrimary },
  mineText: { color: colors.white },
  composerWrap: { borderTopWidth: 1, borderTopColor: colors.borderSoft, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md, backgroundColor: colors.surface },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
  input: { flex: 1, maxHeight: 110, minHeight: 44, paddingHorizontal: spacing.md, paddingVertical: 11, borderRadius: radius.lg, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.bg, color: colors.textPrimary, fontSize: 14, fontFamily: fonts.regular },
  sendButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary },
  sendButtonDisabled: { opacity: 0.42 },
  inlineError: { marginBottom: spacing.sm, color: colors.danger, fontSize: 11.5, fontFamily: fonts.bold },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxxl },
  errorTitle: { marginTop: spacing.md, fontSize: 18, fontFamily: fonts.black, color: colors.textPrimary },
  errorBody: { marginTop: spacing.sm, textAlign: 'center', fontSize: 13, lineHeight: 18, fontFamily: fonts.regular, color: colors.textSecondary },
  retryButton: { marginTop: spacing.lg, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.primary, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  retryText: { color: colors.primary, fontFamily: fonts.bold },
  emptyState: { alignItems: 'center', paddingHorizontal: spacing.xl },
  emptyIcon: { width: 68, height: 68, borderRadius: 34, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primaryLight },
  emptyTitle: { marginTop: spacing.lg, fontSize: 18, fontFamily: fonts.black, color: colors.textPrimary },
  emptyBody: { marginTop: spacing.sm, maxWidth: 290, textAlign: 'center', fontSize: 13.5, lineHeight: 19, fontFamily: fonts.regular, color: colors.textSecondary },
});
