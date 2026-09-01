import React, { useEffect, useRef, useState } from 'react';
import { isStaffRole } from '@dailylog/shared';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { format, isSameDay, isToday, isYesterday } from 'date-fns';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../lib/supabase';
import { mutate } from '../../lib/offlineQueue';
import { newId } from '../../lib/uuid';
import { toastError } from '../../components/Toast';
import { colors, fonts, radius, spacing } from '../../theme';

const QUICK_REPLIES = [
  'Napping now',
  'Ate all their lunch',
  'Photos coming',
  'Doing great',
];

const ATTACHMENT_OPTIONS = [
  { kind: 'photo', label: 'Photo', icon: 'images-outline' },
  { kind: 'camera', label: 'Camera', icon: 'camera-outline' },
  { kind: 'document', label: 'Document', icon: 'document-text-outline' },
  { kind: 'daily_report', label: 'Daily report', icon: 'bar-chart-outline' },
];

function formatMessageTime(value) {
  const date = new Date(value);
  return format(date, 'h:mm a');
}

function formatDay(value) {
  const date = new Date(value);
  if (isToday(date)) return 'Today';
  if (isYesterday(date)) return 'Yesterday';
  return format(date, 'EEEE, MMM d');
}

function safeFileName(value, fallback) {
  return (value || fallback).replace(/[^a-zA-Z0-9._-]/g, '_');
}

function documentMimeType(name, mimeType) {
  if (mimeType) return mimeType;

  const extension = name?.split('.').pop()?.toLowerCase();
  const mimeTypes = {
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    pdf: 'application/pdf',
    txt: 'text/plain',
  };

  return mimeTypes[extension] || 'application/pdf';
}

function relationshipLabel(value) {
  if (!value) return 'parent';
  return value.replace(/_/g, ' ').toLowerCase();
}

export default function MessagingScreen({ route, navigation }) {
  const { childId, childName: routeChildName } = route.params;
  const { profile } = useAuth();
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState([]);
  const [child, setChild] = useState(null);
  const [conversationId, setConversationId] = useState(null);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [trayOpen, setTrayOpen] = useState(false);
  const [pendingAttachment, setPendingAttachment] = useState(null);
  const listRef = useRef(null);

  const isStaff = isStaffRole(profile?.role);
  const linkedParent = child?.parent_links?.[0];
  const otherStaff = messages.find(
    (message) => message.sender_id !== profile?.id && isStaffRole(message.sender?.role),
  )?.sender;
  const childName = child?.first_name || routeChildName || 'Child';
  const roomName = child?.classroom?.name || 'Classroom';
  const parentName = linkedParent?.parent?.full_name || `${childName}'s family`;
  const headerTitle = isStaff
    ? parentName
    : `${roomName} · ${otherStaff?.full_name?.split(' ')[0] || 'Educators'}`;
  const headerSubtitle = isStaff
    ? `${childName}'s ${relationshipLabel(linkedParent?.relationship)} · ${roomName}`
    : 'Educators reply during daycare hours';
  const headerInitial = headerTitle.trim().charAt(0).toUpperCase() || '?';

  useEffect(() => {
    if (!profile?.id) return undefined;
    let active = true;

    async function start() {
      const [childRow, messageRows] = await Promise.all([
        loadChild(),
        loadMessages(),
      ]);
      if (!active) return;
      setChild(childRow);
      setMessages(messageRows);
      setConversationId(messageRows.find((item) => item.conversation_id)?.conversation_id || null);
      setLoading(false);
      await markMessagesAsRead();
      setTimeout(() => listRef.current?.scrollToEnd({ animated: false }), 120);
    }

    start().catch((error) => {
      if (active) {
        setLoading(false);
        toastError('Could not load this conversation', error);
      }
    });

    const channel = supabase
      .channel(`mobile-messages:${childId}:${profile.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `child_id=eq.${childId}`,
        },
        async (payload) => {
          const incoming = await loadMessage(payload.new.id, payload.new);
          if (!active) return;
          setMessages((current) => (
            current.some((message) => message.id === incoming.id)
              ? current.map((message) => (message.id === incoming.id ? incoming : message))
              : [...current, incoming]
          ));
          if (incoming.conversation_id) setConversationId(incoming.conversation_id);
          if (incoming.sender_id !== profile.id) await markMessagesAsRead();
          setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'messages',
          filter: `child_id=eq.${childId}`,
        },
        async (payload) => {
          const updated = await loadMessage(payload.new.id, payload.new);
          if (!active) return;
          setMessages((current) => current.map((message) => (
            message.id === updated.id ? updated : message
          )));
        },
      )
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [childId, profile?.id]);

  async function loadChild() {
    const { data, error } = await supabase
      .from('children')
      .select(`
        *,
        classroom:classrooms(id, name),
        parent_links:parent_children(
          relationship,
          parent:profiles(id, full_name)
        )
      `)
      .eq('id', childId)
      .single();
    if (error) throw error;
    return data;
  }

  async function signedAttachmentUrl(message) {
    if (!message?.attachment_path) return message;
    const { data } = await supabase.storage
      .from('message-attachments')
      .createSignedUrl(message.attachment_path, 3600);
    return { ...message, attachment_url: data?.signedUrl || null };
  }

  async function loadMessage(messageId, fallback) {
    const { data } = await supabase
      .from('messages')
      .select('*, sender:profiles(id, full_name, role)')
      .eq('id', messageId)
      .maybeSingle();
    return signedAttachmentUrl(data || fallback);
  }

  async function loadMessages() {
    const { data, error } = await supabase
      .from('messages')
      .select('*, sender:profiles(id, full_name, role)')
      .eq('child_id', childId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return Promise.all((data || []).map(signedAttachmentUrl));
  }

  async function markMessagesAsRead() {
    const { error } = await supabase.rpc('mark_messages_read', { p_child_id: childId });
    if (error) console.log('Message read receipt failed:', error.message);
  }

  async function ensureConversation() {
    if (conversationId) return conversationId;

    const { data, error } = await supabase
      .rpc('get_or_create_child_conversation', { p_child_id: childId });
    if (error) throw error;
    setConversationId(data);
    return data;
  }

  async function prepareAttachment(option) {
    try {
      if (option.kind === 'photo') {
        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          allowsEditing: false,
          quality: 0.85,
        });
        if (!result.canceled && result.assets?.[0]) {
          const asset = result.assets[0];
          setPendingAttachment({
            kind: 'photo',
            uri: asset.uri,
            name: asset.fileName || 'photo.jpg',
            mimeType: asset.mimeType || 'image/jpeg',
            size: asset.fileSize || null,
          });
        }
      } else if (option.kind === 'camera') {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          Alert.alert('Camera access needed', 'Allow camera access to take a photo for this conversation.');
          return;
        }
        const result = await ImagePicker.launchCameraAsync({
          mediaTypes: ['images'],
          allowsEditing: false,
          quality: 0.85,
        });
        if (!result.canceled && result.assets?.[0]) {
          const asset = result.assets[0];
          setPendingAttachment({
            kind: 'photo',
            uri: asset.uri,
            name: asset.fileName || 'camera-photo.jpg',
            mimeType: asset.mimeType || 'image/jpeg',
            size: asset.fileSize || null,
          });
        }
      } else if (option.kind === 'document') {
        const result = await DocumentPicker.getDocumentAsync({
          type: [
            'application/pdf',
            'text/plain',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          ],
          copyToCacheDirectory: true,
          multiple: false,
        });
        if (!result.canceled && result.assets?.[0]) {
          const asset = result.assets[0];
          if (asset.size && asset.size > 10 * 1024 * 1024) {
            Alert.alert('File is too large', 'Choose a document smaller than 10 MB.');
            return;
          }
          setPendingAttachment({
            kind: 'document',
            uri: asset.uri,
            name: asset.name || 'document',
            mimeType: documentMimeType(asset.name, asset.mimeType),
            size: asset.size || null,
          });
        }
      } else {
        setPendingAttachment({
          kind: 'daily_report',
          uri: null,
          name: `${childName}'s daily report`,
          mimeType: null,
          size: null,
        });
      }
      setTrayOpen(false);
    } catch (error) {
      Alert.alert('Could not add attachment', error.message);
    }
  }

  async function uploadAttachment(attachment, messageId) {
    if (!attachment || attachment.kind === 'daily_report') {
      return {
        attachment_kind: attachment?.kind || null,
        attachment_path: null,
        attachment_name: attachment?.name || null,
        attachment_mime: attachment?.mimeType || null,
      };
    }

    let uploadUri = attachment.uri;
    let mimeType = attachment.mimeType;
    let fileName = attachment.name;

    if (attachment.kind === 'photo') {
      const processed = await ImageManipulator.manipulateAsync(
        attachment.uri,
        [{ resize: { width: 1200 } }],
        { compress: 0.82, format: ImageManipulator.SaveFormat.JPEG },
      );
      uploadUri = processed.uri;
      mimeType = 'image/jpeg';
      fileName = `${safeFileName(attachment.name, 'photo').replace(/\.[^.]+$/, '')}.jpg`;
    }

    const response = await fetch(uploadUri);
    const arrayBuffer = await response.arrayBuffer();
    const path = `${childId}/${profile.id}/${messageId}/${safeFileName(fileName, 'attachment')}`;
    const { error } = await supabase.storage
      .from('message-attachments')
      .upload(path, arrayBuffer, { contentType: mimeType, upsert: false });
    if (error) throw error;

    return {
      attachment_kind: attachment.kind,
      attachment_path: path,
      attachment_name: fileName,
      attachment_mime: mimeType,
    };
  }

  async function handleSend(quickReply) {
    const body = (quickReply ?? text).trim();
    const attachment = quickReply ? null : pendingAttachment;
    if ((!body && !attachment) || sending) return;

    const daycareId = child?.daycare_id || profile?.daycare_id;
    if (!daycareId) {
      Alert.alert('Conversation unavailable', 'The center for this child could not be found.');
      return;
    }

    const previousText = text;
    const previousAttachment = pendingAttachment;
    setSending(true);
    if (!quickReply) {
      setText('');
      setPendingAttachment(null);
    }

    const messageId = newId();
    let uploadedPath = null;
    try {
      const threadId = await ensureConversation();
      const attachmentFields = await uploadAttachment(attachment, messageId);
      uploadedPath = attachmentFields.attachment_path;
      const row = {
        id: messageId,
        daycare_id: daycareId,
        conversation_id: threadId,
        child_id: childId,
        sender_id: profile.id,
        body: body || (
          attachment?.kind === 'photo'
            ? 'Photo'
            : attachment?.kind === 'document'
              ? 'Document'
              : `${childName}'s daily report`
        ),
        ...attachmentFields,
      };
      const optimistic = await signedAttachmentUrl({
        ...row,
        created_at: new Date().toISOString(),
        read_at: null,
        sender: { id: profile.id, full_name: profile.full_name, role: profile.role },
      });
      setMessages((current) => [...current, optimistic]);
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);

      const result = attachment
        ? await supabase.from('messages').insert(row)
        : await mutate({ type: 'insert', table: 'messages', data: row });
      if (result.error) throw result.error;
    } catch (error) {
      setMessages((current) => current.filter((message) => message.id !== messageId));
      if (!quickReply) {
        setText(previousText);
        setPendingAttachment(previousAttachment);
      }
      if (uploadedPath) {
        await supabase.storage.from('message-attachments').remove([uploadedPath]);
      }
      toastError('Message not sent', error);
    } finally {
      setSending(false);
    }
  }

  function openAttachment(message) {
    if (message.attachment_kind === 'daily_report') {
      if (isStaff) {
        navigation.navigate('DailyLog', { child });
      } else {
        navigation.navigate('ParentTabs', { screen: 'ParentHome' });
      }
      return;
    }
    if (message.attachment_url) {
      Linking.openURL(message.attachment_url);
    }
  }

  function renderAttachment(message, isMe) {
    if (message.attachment_kind === 'photo') {
      return message.attachment_url ? (
        <TouchableOpacity onPress={() => openAttachment(message)} activeOpacity={0.85}>
          <Image source={{ uri: message.attachment_url }} style={styles.photoAttachment} />
        </TouchableOpacity>
      ) : (
        <View style={styles.attachmentLoading}>
          <ActivityIndicator color={isMe ? colors.white : colors.primary} />
        </View>
      );
    }

    if (message.attachment_kind === 'document') {
      return (
        <TouchableOpacity
          style={[styles.fileAttachment, isMe && styles.fileAttachmentMe]}
          onPress={() => openAttachment(message)}
          activeOpacity={0.75}
        >
          <Ionicons name="document-text-outline" size={22} color={isMe ? colors.white : colors.primary} />
          <View style={styles.fileAttachmentBody}>
            <Text style={[styles.fileAttachmentName, isMe && styles.fileAttachmentNameMe]} numberOfLines={1}>
              {message.attachment_name || 'Document'}
            </Text>
            <Text style={[styles.fileAttachmentHint, isMe && styles.fileAttachmentHintMe]}>Tap to open</Text>
          </View>
        </TouchableOpacity>
      );
    }

    if (message.attachment_kind === 'daily_report') {
      return (
        <TouchableOpacity
          style={[styles.reportAttachment, isMe && styles.reportAttachmentMe]}
          onPress={() => openAttachment(message)}
          activeOpacity={0.75}
        >
          <View style={[styles.reportIcon, isMe && styles.reportIconMe]}>
            <Ionicons name="bar-chart-outline" size={19} color={isMe ? colors.white : colors.primary} />
          </View>
          <View style={styles.fileAttachmentBody}>
            <Text style={[styles.fileAttachmentName, isMe && styles.fileAttachmentNameMe]}>
              {message.attachment_name || `${childName}'s daily report`}
            </Text>
            <Text style={[styles.fileAttachmentHint, isMe && styles.fileAttachmentHintMe]}>View today's update</Text>
          </View>
        </TouchableOpacity>
      );
    }

    return null;
  }

  function renderMessage({ item, index }) {
    const isMe = item.sender_id === profile.id;
    const previous = messages[index - 1];
    const showDay = !previous || !isSameDay(new Date(previous.created_at), new Date(item.created_at));
    const showSender = !isMe && (!previous || previous.sender_id !== item.sender_id || showDay);
    const attachmentOnly = (
      (item.attachment_kind === 'photo' && item.body === 'Photo')
      || (item.attachment_kind === 'document' && item.body === 'Document')
      || (
        item.attachment_kind === 'daily_report'
        && item.body === `${childName}'s daily report`
      )
    );

    return (
      <View>
        {showDay && (
          <View style={styles.dayPill}>
            <Text style={styles.dayPillText}>{formatDay(item.created_at)}</Text>
          </View>
        )}
        <View style={[styles.messageWrap, isMe && styles.messageWrapMe]}>
          {showSender && (
            <Text style={styles.messageSender}>
              {item.sender?.full_name || (item.sender?.role === 'parent' ? 'Parent' : 'Educator')}
            </Text>
          )}
          <View style={[styles.bubble, isMe && styles.bubbleMe, item.attachment_kind && styles.bubbleAttachment]}>
            {renderAttachment(item, isMe)}
            {!attachmentOnly && (
              <Text style={[styles.bubbleText, isMe && styles.bubbleTextMe]}>{item.body}</Text>
            )}
          </View>
          <Text style={[styles.messageTime, isMe && styles.messageTimeMe]}>
            {isMe && item.read_at ? 'Read · ' : ''}{formatMessageTime(item.created_at)}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'height' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top : 0}
      >
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={styles.headerIconButton}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <Ionicons name="chevron-back" size={23} color={colors.textPrimary} />
          </TouchableOpacity>
          <View style={styles.headerAvatar}>
            <Text style={styles.headerAvatarText}>{headerInitial}</Text>
            {!isStaff && <View style={styles.onlineDot} />}
          </View>
          <View style={styles.headerCopy}>
            <Text style={styles.headerTitle} numberOfLines={1}>{headerTitle}</Text>
            <Text style={[styles.headerSubtitle, !isStaff && styles.headerSubtitleOnline]} numberOfLines={1}>
              {headerSubtitle}
            </Text>
          </View>
          {isStaff && child ? (
            <TouchableOpacity
              onPress={() => navigation.navigate('ChildProfile', { child })}
              style={styles.profileButton}
              accessibilityRole="button"
            >
              <Text style={styles.profileButtonText}>Profile</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={styles.headerIconButton} accessibilityRole="button" accessibilityLabel="Conversation options">
              <Ionicons name="ellipsis-vertical" size={19} color={colors.textMuted} />
            </TouchableOpacity>
          )}
        </View>

        {loading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={colors.primary} size="large" />
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(message) => message.id}
            renderItem={renderMessage}
            contentContainerStyle={[styles.messageList, !messages.length && styles.messageListEmpty]}
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={
              <View style={styles.emptyWrap}>
                <View style={styles.emptyIconDisc}>
                  <Ionicons name="chatbubble-ellipses-outline" size={30} color={colors.primary} />
                </View>
                <Text style={styles.emptyTitle}>Start the conversation</Text>
                <Text style={styles.emptyText}>Send a quick update or answer a question about {childName}.</Text>
              </View>
            }
          />
        )}

        <View style={styles.composer}>
          {isStaff && !trayOpen && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.quickReplies}
              keyboardShouldPersistTaps="handled"
            >
              {QUICK_REPLIES.map((reply) => (
                <TouchableOpacity
                  key={reply}
                  style={styles.quickReply}
                  onPress={() => handleSend(reply)}
                  disabled={sending}
                  activeOpacity={0.75}
                >
                  <Text style={styles.quickReplyText}>
                    {reply}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}

          {trayOpen && (
            <View style={styles.attachmentTray}>
              <View style={styles.trayHandle} />
              <View style={styles.attachmentOptions}>
                {ATTACHMENT_OPTIONS.map((option) => (
                  <TouchableOpacity
                    key={option.kind}
                    style={styles.attachmentOption}
                    onPress={() => prepareAttachment(option)}
                    activeOpacity={0.75}
                  >
                    <View style={styles.attachmentOptionIcon}>
                      <Ionicons name={option.icon} size={22} color={colors.primary} />
                    </View>
                    <Text style={styles.attachmentOptionText}>{option.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          {pendingAttachment && (
            <View style={styles.pendingAttachment}>
              {pendingAttachment.kind === 'photo' ? (
                <Image source={{ uri: pendingAttachment.uri }} style={styles.pendingThumbnail} />
              ) : (
                <View style={styles.pendingIcon}>
                  <Ionicons
                    name={pendingAttachment.kind === 'document' ? 'document-text-outline' : 'bar-chart-outline'}
                    size={20}
                    color={colors.primary}
                  />
                </View>
              )}
              <View style={styles.pendingCopy}>
                <Text style={styles.pendingName} numberOfLines={1}>{pendingAttachment.name}</Text>
                <Text style={styles.pendingHint}>Ready to send</Text>
              </View>
              <TouchableOpacity
                onPress={() => setPendingAttachment(null)}
                style={styles.pendingRemove}
                accessibilityRole="button"
                accessibilityLabel="Remove attachment"
              >
                <Ionicons name="close" size={19} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
          )}

          <View style={styles.inputRow}>
            <TouchableOpacity
              onPress={() => setTrayOpen((current) => !current)}
              style={[styles.addButton, trayOpen && styles.addButtonOpen]}
              disabled={sending}
              accessibilityRole="button"
              accessibilityLabel={trayOpen ? 'Close attachments' : 'Add attachment'}
            >
              <Ionicons
                name={trayOpen ? 'close' : 'add'}
                size={23}
                color={trayOpen ? colors.white : colors.primary}
              />
            </TouchableOpacity>
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder={`Message ${isStaff ? parentName.split(' ')[0] : roomName}…`}
              placeholderTextColor={colors.textFaint}
              style={styles.input}
              multiline
              maxLength={1000}
              returnKeyType="default"
            />
            <TouchableOpacity
              onPress={() => handleSend()}
              disabled={(!text.trim() && !pendingAttachment) || sending}
              style={[
                styles.sendButton,
                (!text.trim() && !pendingAttachment) && styles.sendButtonDisabled,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Send message"
            >
              {sending ? (
                <ActivityIndicator color={colors.white} size="small" />
              ) : (
                <Ionicons name="paper-plane-outline" size={19} color={colors.white} />
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    minHeight: 70,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1.5,
    borderBottomColor: colors.primaryLight,
  },
  headerIconButton: {
    width: 34,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerAvatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerAvatarText: { fontSize: 14, fontFamily: fonts.bold, color: colors.primary },
  onlineDot: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 11,
    height: 11,
    borderRadius: 6,
    backgroundColor: colors.success,
    borderWidth: 2.5,
    borderColor: colors.bg,
  },
  headerCopy: { flex: 1, minWidth: 0 },
  headerTitle: { fontSize: 15, fontFamily: fonts.bold, color: colors.textPrimary },
  headerSubtitle: { marginTop: 2, fontSize: 12, fontFamily: fonts.regular, color: colors.textMuted },
  headerSubtitleOnline: { color: colors.success },
  profileButton: {
    borderRadius: radius.full,
    backgroundColor: colors.primaryLight,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  profileButtonText: { fontSize: 12, fontFamily: fonts.bold, color: colors.primary },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  messageList: { paddingHorizontal: spacing.xl, paddingVertical: spacing.lg },
  messageListEmpty: { flexGrow: 1 },
  dayPill: { alignSelf: 'center', marginBottom: spacing.md, marginTop: spacing.xs },
  dayPillText: {
    borderRadius: radius.full,
    backgroundColor: colors.primarySoft,
    paddingHorizontal: 14,
    paddingVertical: 5,
    fontSize: 11,
    fontFamily: fonts.bold,
    color: colors.textFaint,
  },
  messageWrap: { alignItems: 'flex-start', maxWidth: '82%', marginBottom: spacing.md },
  messageWrapMe: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  messageSender: {
    marginBottom: 4,
    marginLeft: 6,
    fontSize: 11,
    fontFamily: fonts.regular,
    color: colors.textFaint,
  },
  bubble: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 18,
    borderBottomLeftRadius: 6,
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
    paddingVertical: 11,
    overflow: 'hidden',
  },
  bubbleMe: {
    borderColor: colors.primary,
    borderBottomLeftRadius: 18,
    borderBottomRightRadius: 6,
    backgroundColor: colors.primary,
  },
  bubbleAttachment: { padding: 8 },
  bubbleText: { fontSize: 14, lineHeight: 21, fontFamily: fonts.regular, color: colors.textPrimary },
  bubbleTextMe: { color: colors.white },
  messageTime: {
    marginTop: 4,
    marginLeft: 6,
    fontSize: 11,
    fontFamily: fonts.regular,
    color: colors.textFaint,
  },
  messageTimeMe: { marginLeft: 0, marginRight: 6 },
  photoAttachment: { width: 230, height: 150, borderRadius: 12, marginBottom: 6 },
  attachmentLoading: { width: 230, height: 100, alignItems: 'center', justifyContent: 'center' },
  fileAttachment: { minWidth: 220, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  fileAttachmentMe: {},
  fileAttachmentBody: { flex: 1, minWidth: 0 },
  fileAttachmentName: { fontSize: 13, fontFamily: fonts.bold, color: colors.textPrimary },
  fileAttachmentNameMe: { color: colors.white },
  fileAttachmentHint: { marginTop: 2, fontSize: 11, fontFamily: fonts.regular, color: colors.textMuted },
  fileAttachmentHintMe: { color: colors.primaryLight },
  reportAttachment: { minWidth: 220, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  reportAttachmentMe: {},
  reportIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reportIconMe: { backgroundColor: 'rgba(255,255,255,0.18)' },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 44 },
  emptyIconDisc: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  emptyTitle: { fontSize: 18, fontFamily: fonts.bold, color: colors.textPrimary, marginBottom: spacing.sm },
  emptyText: {
    fontSize: 14,
    lineHeight: 21,
    fontFamily: fonts.regular,
    color: colors.textMuted,
    textAlign: 'center',
  },
  composer: {
    borderTopWidth: 1.5,
    borderTopColor: colors.primaryLight,
    backgroundColor: colors.surface,
    paddingTop: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  quickReplies: { gap: spacing.sm, paddingBottom: spacing.md },
  quickReply: {
    borderRadius: radius.full,
    backgroundColor: colors.primaryLight,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  quickReplyText: { fontSize: 12.5, fontFamily: fonts.bold, color: colors.primary },
  attachmentTray: { paddingBottom: spacing.md },
  trayHandle: {
    width: 44,
    height: 5,
    borderRadius: radius.full,
    backgroundColor: colors.border,
    alignSelf: 'center',
    marginTop: -5,
    marginBottom: spacing.lg,
  },
  attachmentOptions: { flexDirection: 'row', justifyContent: 'space-between' },
  attachmentOption: { width: '24%', alignItems: 'center', gap: 7 },
  attachmentOptionIcon: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachmentOptionText: {
    fontSize: 11.5,
    fontFamily: fonts.bold,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  pendingAttachment: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radius.lg,
    backgroundColor: colors.primarySoft,
    padding: spacing.sm,
    marginBottom: spacing.sm,
  },
  pendingThumbnail: { width: 46, height: 46, borderRadius: radius.md },
  pendingIcon: {
    width: 46,
    height: 46,
    borderRadius: radius.md,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pendingCopy: { flex: 1, minWidth: 0 },
  pendingName: { fontSize: 13, fontFamily: fonts.bold, color: colors.textPrimary },
  pendingHint: { marginTop: 2, fontSize: 11, fontFamily: fonts.regular, color: colors.textMuted },
  pendingRemove: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
  addButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addButtonOpen: { backgroundColor: colors.primary },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 100,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 20,
    backgroundColor: colors.bg,
    paddingHorizontal: spacing.lg,
    paddingVertical: 9,
    fontSize: 14,
    lineHeight: 20,
    fontFamily: fonts.regular,
    color: colors.textPrimary,
  },
  sendButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: { backgroundColor: colors.borderStrong },
});
