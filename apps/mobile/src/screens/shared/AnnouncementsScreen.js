import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Modal,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import { addDays, format, isToday, isYesterday } from 'date-fns';
import { isStaffRole } from '@dailylog/shared';
import { useAuth } from '../../hooks/useAuth';
import { useClassroom } from '../../hooks/useClassroom';
import { supabase } from '../../lib/supabase';
import { notifyAnnouncement } from '../../hooks/usePushNotifications';
import { Button, EmptyState, Input } from '../../components/ui';
import { DatePickerField } from '../../components/DatePickerField';
import { showToast } from '../../components/Toast';
import { colors, fonts, radius, spacing } from '../../theme';

const ANNOUNCEMENT_IMAGE = require('../../../assets/onboarding/child-day.jpg');

function announcementTime(value) {
  const date = new Date(value);
  if (isToday(date)) return format(date, 'h:mm a');
  if (isYesterday(date)) return 'Yesterday';
  return format(date, 'MMM d');
}

export default function AnnouncementsScreen({ navigation }) {
  const { profile } = useAuth();
  const classroomContext = useClassroom();
  const classrooms = classroomContext?.classrooms || [];
  const [items, setItems] = useState([]);
  const [readIds, setReadIds] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [composing, setComposing] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [pinned, setPinned] = useState(false);
  const [rsvpEnabled, setRsvpEnabled] = useState(false);
  const [eventDate, setEventDate] = useState(format(addDays(new Date(), 14), 'yyyy-MM-dd'));
  const [eventStart, setEventStart] = useState('11:00');
  const [eventEnd, setEventEnd] = useState('14:00');
  const [eventLocation, setEventLocation] = useState('');
  const [targetClassroom, setTargetClassroom] = useState(null);
  const [sending, setSending] = useState(false);

  const isStaff = isStaffRole(profile?.role);

  useEffect(() => {
    if (profile?.id) load();
  }, [profile?.id]);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from('announcements')
      .select(`
        *,
        author:profiles!announcements_author_id_fkey(full_name),
        classroom:classrooms(name),
        rsvps:announcement_rsvps(profile_id, response)
      `)
      .order('pinned', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) {
      Alert.alert('Could not load announcements', error.message);
      setItems([]);
      setLoading(false);
      return;
    }

    const announcements = data || [];
    setItems(announcements);
    if (!isStaff && announcements.length) {
      const { data: reads } = await supabase
        .from('announcement_reads')
        .select('announcement_id')
        .eq('profile_id', profile.id)
        .in('announcement_id', announcements.map((item) => item.id));
      setReadIds(new Set((reads || []).map((item) => item.announcement_id)));
    }
    setLoading(false);
  }

  async function handleSend() {
    if (!title.trim() || !body.trim()) {
      Alert.alert('Required', 'Please enter both a title and a message.');
      return;
    }
    let eventAt = null;
    let eventEndsAt = null;
    if (rsvpEnabled) {
      if (!eventDate || !/^([01]\d|2[0-3]):[0-5]\d$/.test(eventStart)
          || !/^([01]\d|2[0-3]):[0-5]\d$/.test(eventEnd)
          || !eventLocation.trim()) {
        Alert.alert('Event details required', 'Add a date, valid start/end times, and a location.');
        return;
      }
      const starts = new Date(`${eventDate}T${eventStart}:00`);
      const ends = new Date(`${eventDate}T${eventEnd}:00`);
      if (Number.isNaN(starts.getTime()) || Number.isNaN(ends.getTime()) || ends <= starts) {
        Alert.alert('Check event time', 'The event end time must be after its start time.');
        return;
      }
      if (starts <= new Date()) {
        Alert.alert('Choose a future event', 'The event start must be in the future.');
        return;
      }
      eventAt = starts.toISOString();
      eventEndsAt = ends.toISOString();
    }
    setSending(true);
    const row = {
      daycare_id: profile.daycare_id,
      classroom_id: targetClassroom?.id || null,
      author_id: profile.id,
      title: title.trim(),
      body: body.trim(),
      pinned,
      rsvp_enabled: rsvpEnabled,
      event_at: eventAt,
      event_ends_at: eventEndsAt,
      event_location: rsvpEnabled ? eventLocation.trim() : null,
    };
    const { data, error } = await supabase
      .from('announcements')
      .insert(row)
      .select('id')
      .single();
    setSending(false);
    if (error) {
      Alert.alert('Could not send announcement', error.message);
      return;
    }

    notifyAnnouncement(
      profile.daycare_id,
      targetClassroom?.id || null,
      row.title,
      row.body,
      data?.id,
    );
    setComposing(false);
    setTitle('');
    setBody('');
    setPinned(false);
    setRsvpEnabled(false);
    setEventDate(format(addDays(new Date(), 14), 'yyyy-MM-dd'));
    setEventStart('11:00');
    setEventEnd('14:00');
    setEventLocation('');
    setTargetClassroom(null);
    showToast('Announcement sent', 'success');
    load();
  }

  async function handleDelete(item) {
    Alert.alert('Delete announcement', `Delete "${item.title}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await supabase.from('announcements').delete().eq('id', item.id);
          load();
        },
      },
    ]);
  }

  async function markRead(item) {
    setReadIds((current) => new Set([...current, item.id]));
    const { error } = await supabase.from('announcement_reads').upsert(
      {
        announcement_id: item.id,
        profile_id: profile.id,
        read_at: new Date().toISOString(),
      },
      { onConflict: 'announcement_id,profile_id' },
    );
    if (error) {
      setReadIds((current) => {
        const next = new Set(current);
        next.delete(item.id);
        return next;
      });
      Alert.alert('Could not mark as read', error.message);
    }
  }

  function renderParentItem({ item, index }) {
    const isRead = readIds.has(item.id);
    const myRsvp = item.rsvps?.find((rsvp) => rsvp.profile_id === profile.id)?.response;
    const roomLabel = item.classroom?.name ? item.classroom.name.toUpperCase() : 'ALL ROOMS';
    return (
      <TouchableOpacity
        style={[styles.parentCard, isRead && styles.parentCardRead]}
        onPress={item.rsvp_enabled ? () => navigation.navigate('EventDetail', { announcement: item }) : undefined}
        activeOpacity={item.rsvp_enabled ? 0.76 : 1}
      >
        {item.pinned && index === 0 && (
          <Image source={ANNOUNCEMENT_IMAGE} style={styles.announcementImage} resizeMode="cover" />
        )}
        <View style={styles.parentCardContent}>
          <View style={styles.metaRow}>
            {item.pinned ? (
              <View style={styles.pinnedBadge}>
                <Text style={styles.pinnedBadgeText}>PINNED</Text>
              </View>
            ) : (
              <View style={styles.roomBadge}>
                <Text style={styles.roomBadgeText}>{roomLabel}</Text>
              </View>
            )}
            <Text style={styles.metaText}>
              {item.classroom?.name || 'All rooms'} · {announcementTime(item.created_at)}
              {isRead ? ' · Read' : ''}
            </Text>
          </View>
          <Text style={styles.parentCardTitle}>{item.title}</Text>
          <Text style={styles.parentCardBody}>{item.body}</Text>

          {item.rsvp_enabled && (
            <View>
              <View style={styles.eventMetaRow}>
                <Ionicons name="calendar-outline" size={16} color={colors.primary} />
                <Text style={styles.eventMetaText}>
                  {item.event_at ? format(new Date(item.event_at), 'EEE, MMM d · h:mm a') : 'Date to be confirmed'}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.rsvpPrimary}
                onPress={() => navigation.navigate('EventDetail', { announcement: item })}
                activeOpacity={0.78}
              >
                <Text style={styles.rsvpPrimaryText}>
                  {myRsvp ? `RSVP: ${myRsvp === 'yes' ? 'Going' : myRsvp === 'no' ? "Can't attend" : 'Maybe'} · Edit` : 'RSVP now'}
                </Text>
                <Ionicons name="chevron-forward" size={17} color={colors.white} />
              </TouchableOpacity>
            </View>
          )}

          {!isRead && !item.rsvp_enabled && (
            <TouchableOpacity onPress={() => markRead(item)} style={styles.markReadButton}>
              <Text style={styles.markReadText}>Mark as read</Text>
            </TouchableOpacity>
          )}
        </View>
      </TouchableOpacity>
    );
  }

  function renderStaffItem({ item }) {
    return (
      <TouchableOpacity
        style={[styles.staffCard, item.pinned && styles.staffCardPinned]}
        onPress={item.rsvp_enabled ? () => navigation.navigate('EventRsvps', { announcementId: item.id }) : undefined}
        onLongPress={() => handleDelete(item)}
        activeOpacity={0.72}
      >
        <View style={styles.metaRow}>
          {item.pinned && (
            <View style={styles.pinnedBadge}>
              <Text style={styles.pinnedBadgeText}>PINNED</Text>
            </View>
          )}
          <Text style={styles.metaText}>
            {item.classroom?.name || 'All rooms'} · {announcementTime(item.created_at)}
          </Text>
        </View>
        <Text style={styles.parentCardTitle}>{item.title}</Text>
        <Text style={styles.parentCardBody}>{item.body}</Text>
        <Text style={styles.staffFooter}>
          {item.author?.full_name || 'Staff'}
          {item.rsvp_enabled ? ` · ${item.rsvps?.filter((rsvp) => rsvp.response === 'yes').length || 0} attending` : ''}
        </Text>
        {item.rsvp_enabled ? (
          <View style={styles.responsesLink}>
            <Text style={styles.responsesLinkText}>View family responses</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.primary} />
          </View>
        ) : null}
      </TouchableOpacity>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={styles.headerButton}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <Ionicons name="chevron-back" size={23} color={colors.textPrimary} />
          </TouchableOpacity>
          <View style={styles.headerCopy}>
            <Text style={styles.headerTitle}>Announcements</Text>
            <Text style={styles.headerSubtitle}>
              {isStaff ? 'Updates sent to families' : 'Sunny Grove Early Learning'}
            </Text>
          </View>
          {isStaff ? (
            <TouchableOpacity onPress={() => setComposing(true)} style={styles.newButton}>
              <Ionicons name="add" size={18} color={colors.white} />
              <Text style={styles.newButtonText}>New</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.megaphoneIcon}>
              <Ionicons name="megaphone-outline" size={18} color={colors.primary} />
            </View>
          )}
        </View>

        {loading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={colors.primary} size="large" />
          </View>
        ) : (
          <FlatList
            data={items}
            keyExtractor={(item) => item.id}
            renderItem={isStaff ? renderStaffItem : renderParentItem}
            contentContainerStyle={styles.list}
            ListEmptyComponent={<EmptyState icon="📢" message="No announcements yet." />}
          />
        )}

        <Modal
          visible={composing}
          transparent
          animationType="slide"
          onRequestClose={() => setComposing(false)}
        >
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

              <Input
                label="Title *"
                value={title}
                onChangeText={setTitle}
                placeholder="e.g. Closed Friday for PD day"
              />
              <Input
                label="Message *"
                value={body}
                onChangeText={setBody}
                placeholder="Details for families…"
                multiline
              />

              <Text style={styles.fieldLabel}>Audience</Text>
              <View style={styles.audienceWrap}>
                <TouchableOpacity
                  onPress={() => setTargetClassroom(null)}
                  style={[styles.audienceChip, !targetClassroom && styles.audienceChipActive]}
                >
                  <Text style={[styles.audienceText, !targetClassroom && styles.audienceTextActive]}>
                    Whole daycare
                  </Text>
                </TouchableOpacity>
                {classrooms.map((classroom) => (
                  <TouchableOpacity
                    key={classroom.id}
                    onPress={() => setTargetClassroom(classroom)}
                    style={[
                      styles.audienceChip,
                      targetClassroom?.id === classroom.id && styles.audienceChipActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.audienceText,
                        targetClassroom?.id === classroom.id && styles.audienceTextActive,
                      ]}
                    >
                      {classroom.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <View style={styles.pinRow}>
                <Text style={styles.fieldLabel}>Pin to top</Text>
                <Switch
                  value={pinned}
                  onValueChange={setPinned}
                  trackColor={{ false: colors.border, true: colors.primary }}
                />
              </View>

              <View style={styles.pinRow}>
                <View style={styles.eventToggleCopy}>
                  <Text style={styles.fieldLabel}>Collect family RSVPs</Text>
                  <Text style={styles.eventToggleHint}>Adds an event detail page and response tracking.</Text>
                </View>
                <Switch
                  value={rsvpEnabled}
                  onValueChange={setRsvpEnabled}
                  trackColor={{ false: colors.border, true: colors.primary }}
                />
              </View>

              {rsvpEnabled ? (
                <View style={styles.eventFields}>
                  <DatePickerField
                    label="Event date *"
                    value={eventDate}
                    onChange={setEventDate}
                    minimumDate={new Date()}
                    maximumDate={addDays(new Date(), 730)}
                    placeholder="Select event date"
                  />
                  <View style={styles.timeRow}>
                    <Input
                      label="Starts *"
                      value={eventStart}
                      onChangeText={setEventStart}
                      placeholder="11:00"
                      keyboardType="numbers-and-punctuation"
                      style={styles.timeField}
                    />
                    <Input
                      label="Ends *"
                      value={eventEnd}
                      onChangeText={setEventEnd}
                      placeholder="14:00"
                      keyboardType="numbers-and-punctuation"
                      style={styles.timeField}
                    />
                  </View>
                  <Input
                    label="Location *"
                    value={eventLocation}
                    onChangeText={setEventLocation}
                    placeholder="e.g. Fairy Lake Park · North shelter"
                    maxLength={240}
                  />
                  <Text style={styles.eventFormatHint}>Use 24-hour time, for example 09:30 or 14:00.</Text>
                </View>
              ) : null}

              <Button
                label={rsvpEnabled ? 'Publish event' : 'Send announcement'}
                onPress={handleSend}
                loading={sending}
                style={{ marginTop: spacing.lg }}
              />
              <Text style={styles.pushHint}>
                Families in {targetClassroom ? targetClassroom.name : 'the whole daycare'} will receive this update.
              </Text>
            </KeyboardAwareScrollView>
          </View>
        </Modal>
      </View>
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
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1.5,
    borderBottomColor: colors.primaryLight,
  },
  headerButton: { width: 34, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerCopy: { flex: 1 },
  headerTitle: { fontSize: 16, fontFamily: fonts.bold, color: colors.textPrimary },
  headerSubtitle: { marginTop: 2, fontSize: 12, fontFamily: fonts.regular, color: colors.textMuted },
  megaphoneIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  newButton: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
  },
  newButtonText: { fontSize: 13, fontFamily: fonts.bold, color: colors.white },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: spacing.xl, paddingBottom: 48 },
  parentCard: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 20,
    backgroundColor: colors.surface,
    overflow: 'hidden',
    marginBottom: spacing.md,
  },
  parentCardRead: { opacity: 0.68 },
  announcementImage: { width: '100%', height: 140 },
  parentCardContent: { padding: spacing.lg },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  pinnedBadge: {
    borderRadius: radius.full,
    backgroundColor: colors.primaryLight,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  pinnedBadgeText: { fontSize: 11, letterSpacing: 0.6, fontFamily: fonts.bold, color: colors.primary },
  roomBadge: {
    borderRadius: radius.full,
    backgroundColor: colors.amberLight,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  roomBadgeText: { fontSize: 11, letterSpacing: 0.5, fontFamily: fonts.bold, color: colors.amber },
  metaText: { flex: 1, fontSize: 12, fontFamily: fonts.regular, color: colors.textFaint },
  parentCardTitle: {
    fontSize: 17,
    lineHeight: 23,
    fontFamily: fonts.black,
    color: colors.textPrimary,
  },
  parentCardBody: {
    marginTop: spacing.sm,
    fontSize: 13.5,
    lineHeight: 21,
    fontFamily: fonts.regular,
    color: colors.textMuted,
  },
  eventMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.md },
  eventMetaText: { fontSize: 12.5, fontFamily: fonts.bold, color: colors.primary },
  rsvpPrimary: {
    minHeight: 44,
    flexDirection: 'row',
    gap: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    marginTop: spacing.md,
  },
  rsvpPrimaryText: { fontSize: 13.5, fontFamily: fonts.bold, color: colors.white },
  markReadButton: { alignSelf: 'flex-start', marginTop: spacing.md, paddingVertical: 3 },
  markReadText: { fontSize: 13, fontFamily: fonts.bold, color: colors.primary },
  staffCard: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 18,
    backgroundColor: colors.surface,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  staffCardPinned: { borderColor: colors.amber, backgroundColor: '#FFFCF7' },
  staffFooter: { marginTop: spacing.md, fontSize: 11.5, fontFamily: fonts.regular, color: colors.textFaint },
  responsesLink: { flexDirection: 'row', alignItems: 'center', gap: 3, alignSelf: 'flex-start', marginTop: spacing.sm },
  responsesLinkText: { fontSize: 12.5, fontFamily: fonts.bold, color: colors.primary },
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(23,51,91,0.5)' },
  sheet: {
    maxHeight: '88%',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: colors.surface,
  },
  sheetContent: { padding: spacing.xl, paddingBottom: 48 },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.lg,
  },
  sheetCancel: { width: 60, fontSize: 15, fontFamily: fonts.regular, color: colors.textSecondary },
  sheetTitle: { fontSize: 17, fontFamily: fonts.bold, color: colors.textPrimary },
  fieldLabel: { marginBottom: spacing.sm, fontSize: 13, fontFamily: fonts.bold, color: colors.textSecondary },
  audienceWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.lg },
  audienceChip: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  audienceChipActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  audienceText: { fontSize: 13, fontFamily: fonts.regular, color: colors.textSecondary },
  audienceTextActive: { fontFamily: fonts.bold, color: colors.primary },
  pinRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.sm },
  eventToggleCopy: { flex: 1, paddingRight: spacing.lg },
  eventToggleHint: { marginTop: -4, fontSize: 11.5, lineHeight: 17, fontFamily: fonts.regular, color: colors.textMuted },
  eventFields: { marginTop: spacing.lg, padding: spacing.lg, borderRadius: radius.md, backgroundColor: colors.primarySoft },
  timeRow: { flexDirection: 'row', gap: spacing.md },
  timeField: { flex: 1, minWidth: 0 },
  eventFormatHint: { marginTop: -spacing.sm, fontSize: 10.5, fontFamily: fonts.regular, color: colors.textFaint },
  pushHint: {
    marginTop: spacing.md,
    fontSize: 12,
    lineHeight: 17,
    fontFamily: fonts.regular,
    color: colors.textMuted,
    textAlign: 'center',
  },
});
