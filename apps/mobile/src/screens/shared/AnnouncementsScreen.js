import React, { useState, useEffect } from 'react';
import {
  View, Text, FlatList, TouchableOpacity,
  StyleSheet, Alert, ActivityIndicator, Modal, Switch
} from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import { useAuth } from '../../hooks/useAuth';
import { useClassroom } from '../../hooks/useClassroom';
import { supabase } from '../../lib/supabase';
import { notifyAnnouncement } from '../../hooks/usePushNotifications';
import { Input, Button, EmptyState } from '../../components/ui';
import { showToast } from '../../components/Toast';
import { colors, spacing, radius } from '../../theme';
import { format } from 'date-fns';

/**
 * Announcements — staff (educator/admin) can compose daycare- or
 * classroom-wide broadcasts; parents see the ones relevant to them.
 */
export default function AnnouncementsScreen({ navigation }) {
  const { profile } = useAuth();
  const classroomCtx = useClassroom();
  const classrooms = classroomCtx?.classrooms || [];

  const [items, setItems]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [composing, setComposing] = useState(false);
  const [title, setTitle]       = useState('');
  const [body, setBody]         = useState('');
  const [pinned, setPinned]     = useState(false);
  const [targetClassroom, setTargetClassroom] = useState(null); // null = whole daycare
  const [sending, setSending]   = useState(false);

  const isStaff = profile?.role === 'educator' || profile?.role === 'admin';

  useEffect(() => { load(); }, []);

  async function load() {
    const { data } = await supabase
      .from('announcements')
      .select('*, author:profiles(full_name), classroom:classrooms(name)')
      .order('pinned', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(50);
    setItems(data || []);
    setLoading(false);
  }

  async function handleSend() {
    if (!title.trim() || !body.trim()) {
      Alert.alert('Required', 'Please enter both a title and a message.');
      return;
    }
    setSending(true);

    const row = {
      daycare_id: profile.daycare_id,
      classroom_id: targetClassroom?.id || null,
      author_id: profile.id,
      title: title.trim(),
      body: body.trim(),
      pinned,
    };

    const { data, error } = await supabase
      .from('announcements')
      .insert(row)
      .select('id')
      .single();

    setSending(false);
    if (error) { Alert.alert('Error', error.message); return; }

    // Fire push fan-out (fire-and-forget)
    notifyAnnouncement(profile.daycare_id, targetClassroom?.id || null, title.trim(), body.trim(), data?.id);

    setComposing(false);
    setTitle(''); setBody(''); setPinned(false); setTargetClassroom(null);
    showToast('📢 Announcement sent', 'success');
    load();
  }

  async function handleDelete(item) {
    Alert.alert('Delete announcement', `Delete "${item.title}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          await supabase.from('announcements').delete().eq('id', item.id);
          load();
        },
      },
    ]);
  }

  function renderItem({ item }) {
    return (
      <TouchableOpacity
        style={[styles.card, item.pinned && styles.cardPinned]}
        onLongPress={isStaff ? () => handleDelete(item) : undefined}
        activeOpacity={isStaff ? 0.7 : 1}
      >
        <View style={styles.cardTop}>
          {item.pinned && <Text style={styles.pin}>📌</Text>}
          <Text style={styles.cardTitle}>{item.title}</Text>
        </View>
        <Text style={styles.cardBody}>{item.body}</Text>
        <Text style={styles.cardMeta}>
          {item.classroom?.name ? `🏫 ${item.classroom.name}` : '📣 Whole daycare'}
          {' · '}{item.author?.full_name || 'Staff'}
          {' · '}{format(new Date(item.created_at), 'MMM d, h:mm a')}
        </Text>
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.back}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Announcements</Text>
        {isStaff ? (
          <TouchableOpacity onPress={() => setComposing(true)} style={styles.newBtn}>
            <Text style={styles.newBtnText}>+ New</Text>
          </TouchableOpacity>
        ) : <View style={{ width: 60 }} />}
      </View>

      {loading ? (
        <View style={styles.loadingWrap}><ActivityIndicator color={colors.primary} size="large" /></View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={i => i.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<EmptyState icon="📢" message="No announcements yet." />}
        />
      )}

      {/* Composer modal */}
      <Modal visible={composing} transparent animationType="slide">
        <View style={styles.overlay}>
          <KeyboardAwareScrollView
            style={styles.sheet}
            contentContainerStyle={styles.sheetContent}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.sheetHeader}>
              <TouchableOpacity onPress={() => setComposing(false)}>
                <Text style={styles.sheetCancel}>Cancel</Text>
              </TouchableOpacity>
              <Text style={styles.sheetTitle}>New announcement</Text>
              <View style={{ width: 60 }} />
            </View>

            <Input label="Title *" value={title} onChangeText={setTitle} placeholder="e.g. Closed Friday for PD day" />
            <Input label="Message *" value={body} onChangeText={setBody} placeholder="Details for parents..." multiline />

            {/* Audience */}
            <Text style={styles.fieldLabel}>Audience</Text>
            <View style={styles.audienceWrap}>
              <TouchableOpacity
                onPress={() => setTargetClassroom(null)}
                style={[styles.audienceChip, !targetClassroom && styles.audienceChipActive]}
              >
                <Text style={[styles.audienceText, !targetClassroom && styles.audienceTextActive]}>📣 Whole daycare</Text>
              </TouchableOpacity>
              {classrooms.map(room => (
                <TouchableOpacity
                  key={room.id}
                  onPress={() => setTargetClassroom(room)}
                  style={[styles.audienceChip, targetClassroom?.id === room.id && styles.audienceChipActive]}
                >
                  <Text style={[styles.audienceText, targetClassroom?.id === room.id && styles.audienceTextActive]}>
                    🏫 {room.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Pin */}
            <View style={styles.pinRow}>
              <Text style={styles.fieldLabel}>Pin to top</Text>
              <Switch value={pinned} onValueChange={setPinned} trackColor={{ true: colors.primary }} />
            </View>

            <Button
              label={sending ? 'Sending...' : '📢 Send announcement'}
              onPress={handleSend}
              loading={sending}
              style={{ marginTop: spacing.lg }}
            />
            <Text style={styles.pushHint}>
              Parents of {targetClassroom ? `the ${targetClassroom.name} room` : 'the whole daycare'} will get a push notification.
            </Text>
          </KeyboardAwareScrollView>
        </View>
      </Modal>
    </View>
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
  headerTitle: { fontSize: 17, fontWeight: '600', color: colors.textPrimary },
  newBtn: {
    backgroundColor: colors.primary, paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2, borderRadius: radius.full, minWidth: 60, alignItems: 'center',
  },
  newBtnText: { fontSize: 13, color: colors.white, fontWeight: '600' },
  loadingWrap: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  list: { padding: spacing.lg },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border,
    padding: spacing.lg, marginBottom: spacing.sm,
  },
  cardPinned: { borderColor: colors.amber, backgroundColor: colors.amberLight + '55' },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs },
  pin: { fontSize: 14 },
  cardTitle: { fontSize: 15, fontWeight: '700', color: colors.textPrimary, flex: 1 },
  cardBody: { fontSize: 14, color: colors.textSecondary, lineHeight: 20, marginBottom: spacing.sm },
  cardMeta: { fontSize: 11, color: colors.textMuted },
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    maxHeight: '85%',
  },
  sheetContent: { padding: spacing.xl, paddingBottom: 48 },
  sheetHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: spacing.lg,
  },
  sheetCancel: { fontSize: 15, color: colors.textSecondary, width: 60 },
  sheetTitle: { fontSize: 17, fontWeight: '600', color: colors.textPrimary },
  fieldLabel: { fontSize: 13, fontWeight: '500', color: colors.textSecondary, marginBottom: spacing.sm },
  audienceWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.lg },
  audienceChip: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: radius.full, borderWidth: 1.5, borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  audienceChipActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  audienceText: { fontSize: 13, color: colors.textSecondary, fontWeight: '500' },
  audienceTextActive: { color: colors.primary, fontWeight: '600' },
  pinRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginTop: spacing.sm,
  },
  pushHint: { fontSize: 12, color: colors.textMuted, textAlign: 'center', marginTop: spacing.md, lineHeight: 17 },
});

