import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  RefreshControl,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { KeyboardAwareScrollView } from '../../components/KeyboardAwareScrollView';
import { addDays, format, isToday, isYesterday } from 'date-fns';
import { isStaffRole } from '@dailylog/shared';
import { useAuth } from '../../hooks/useAuth';
import { useClassroom } from '../../hooks/useClassroom';
import { supabase } from '../../lib/supabase';
import { getLocalizedAnnouncement, listLocalizedAnnouncements } from '../../lib/localizedAnnouncements';
import { Button, EmptyState, Input } from '../../components/ui';
import { DatePickerField } from '../../components/DatePickerField';
import { showToast } from '../../components/Toast';
import { colors, fonts, radius, spacing } from '../../theme';
import FamilyScreenHeader from '../parent/FamilyScreenHeader';

function announcementTime(value) {
  const date = new Date(value);
  if (isToday(date)) return format(date, 'h:mm a');
  if (isYesterday(date)) return 'Yesterday';
  return format(date, 'MMM d');
}

const ANNOUNCEMENT_SELECT = `
  *,
  author:profiles!announcements_author_id_fkey(id, full_name),
  daycare:daycares(name),
  classroom:classrooms(name),
  rsvps:announcement_rsvps(profile_id, response, guests, child_id)
`;

export default function AnnouncementsScreen({ navigation, route }) {
  const { profile } = useAuth();
  const classroomContext = useClassroom();
  const classrooms = classroomContext?.classrooms || [];
  const [items, setItems] = useState([]);
  const [readIds, setReadIds] = useState(new Set());
  const [deliveryMetrics, setDeliveryMetrics] = useState({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [centerName, setCenterName] = useState('Your daycare');
  const [composing, setComposing] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [pinned, setPinned] = useState(false);
  const [urgent, setUrgent] = useState(false);
  const [audienceType, setAudienceType] = useState('families');
  const [rsvpEnabled, setRsvpEnabled] = useState(false);
  const [eventDate, setEventDate] = useState(format(addDays(new Date(), 14), 'yyyy-MM-dd'));
  const [eventStart, setEventStart] = useState('11:00');
  const [eventEnd, setEventEnd] = useState('14:00');
  const [eventLocation, setEventLocation] = useState('');
  const [targetClassroom, setTargetClassroom] = useState(null);
  const [sending, setSending] = useState(false);
  const [canEditBroadcasts, setCanEditBroadcasts] = useState(false);
  const [canApproveBroadcasts, setCanApproveBroadcasts] = useState(false);
  const listRef = useRef(null);

  const isStaff = isStaffRole(profile?.role);
  const canViewMetrics = isStaff;
  const focusAnnouncementId = route?.params?.announcementId || null;

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!profile?.id) return;
    if (silent) setRefreshing(true);
    else setLoading(true);
    setLoadError('');
    let announcements;
    try {
      if (isStaff) {
        const [{ data: canEdit }, { data: canApprove }] = await Promise.all([
          supabase.rpc('has_permission', { p_area: 'broadcasts', p_action: 'edit' }),
          supabase.rpc('has_permission', { p_area: 'broadcasts', p_action: 'approve' }),
        ]);
        setCanEditBroadcasts(canEdit === true);
        setCanApproveBroadcasts(canApprove === true);
        const { data, error } = await supabase
          .from('announcements')
          .select(ANNOUNCEMENT_SELECT)
          .order('pinned', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(50);
        if (error) throw error;
        announcements = data || [];

        if (focusAnnouncementId && !announcements.some((item) => item.id === focusAnnouncementId)) {
          const { data: focused, error: focusError } = await supabase
            .from('announcements')
            .select(ANNOUNCEMENT_SELECT)
            .eq('id', focusAnnouncementId)
            .maybeSingle();
          if (focusError) throw focusError;
          if (focused) announcements = [focused, ...announcements];
        }
      } else {
        announcements = await listLocalizedAnnouncements(50);
        if (focusAnnouncementId && !announcements.some((item) => item.id === focusAnnouncementId)) {
          const focused = await getLocalizedAnnouncement(focusAnnouncementId);
          if (focused) announcements = [focused, ...announcements];
        }
      }
    } catch (error) {
      setLoadError(error.message || 'We could not load announcements.');
      setLoading(false);
      setRefreshing(false);
      return;
    }
    setItems(focusAnnouncementId && !isStaff
      ? [
        ...announcements.filter((item) => item.id === focusAnnouncementId),
        ...announcements.filter((item) => item.id !== focusAnnouncementId),
      ]
      : announcements);
    if (canViewMetrics && announcements.length) {
      const { data: metrics } = await supabase.rpc('list_broadcast_delivery_metrics', {
        p_announcement_ids: announcements.map((item) => item.id),
      });
      setDeliveryMetrics(Object.fromEntries(
        (metrics || []).map((metric) => [metric.announcement_id, metric]),
      ));
    } else {
      setDeliveryMetrics({});
    }
    if (announcements[0]?.daycare?.name) {
      setCenterName(announcements[0].daycare.name);
    } else if (profile.daycare_id) {
      const { data: daycare } = await supabase
        .from('daycares')
        .select('name')
        .eq('id', profile.daycare_id)
        .maybeSingle();
      if (daycare?.name) setCenterName(daycare.name);
    }
    if (announcements.length) {
      const { data: reads } = await supabase
        .from('announcement_reads')
        .select('announcement_id')
        .eq('profile_id', profile.id)
        .in('announcement_id', announcements.map((item) => item.id));
      setReadIds(new Set((reads || []).map((item) => item.announcement_id)));
    } else {
      setReadIds(new Set());
    }
    setLoading(false);
    setRefreshing(false);
  }, [canViewMetrics, focusAnnouncementId, isStaff, profile?.daycare_id, profile?.id]);

  useFocusEffect(useCallback(() => {
    load();
  }, [load]));

  useEffect(() => {
    if (!profile?.id) return undefined;
    const instance = `${Date.now()}:${Math.random().toString(36).slice(2)}`;
    const channel = supabase
      .channel(`announcements:${profile.id}:${instance}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'announcements',
      }, () => load({ silent: true }))
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'announcement_rsvps',
      }, () => load({ silent: true }))
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [load, profile?.id]);

  useEffect(() => {
    if (!focusAnnouncementId || !items.length) return;
    const index = items.findIndex((item) => item.id === focusAnnouncementId);
    if (index < 0) return;
    requestAnimationFrame(() => {
      listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.15 });
    });
  }, [focusAnnouncementId, items, route?.params?.linkedAt]);

  async function handleSend() {
    if (!title.trim() || !body.trim()) {
      Alert.alert('Required', 'Please enter both a title and a message.');
      return;
    }
    let eventAt = null;
    let eventEndsAt = null;
    if (rsvpEnabled && audienceType === 'families' && !urgent) {
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
      classroom_id: audienceType === 'families' ? targetClassroom?.id || null : null,
      author_id: profile.id,
      audience_type: audienceType,
      title: title.trim(),
      body: body.trim(),
      pinned: urgent || pinned,
      priority: urgent ? 'urgent' : 'normal',
      published_at: new Date().toISOString(),
      rsvp_enabled: audienceType === 'families' && !urgent && rsvpEnabled,
      event_at: eventAt,
      event_ends_at: eventEndsAt,
      event_location: rsvpEnabled ? eventLocation.trim() : null,
    };
    const { error } = await supabase
      .from('announcements')
      .insert(row);
    setSending(false);
    if (error) {
      Alert.alert('Could not send announcement', error.message);
      return;
    }

    setComposing(false);
    setTitle('');
    setBody('');
    setPinned(false);
    setUrgent(false);
    setAudienceType('families');
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
    Alert.alert('Delete scheduled announcement', `Delete "${item.title}" before it is sent?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          const { error } = await supabase.from('announcements').delete().eq('id', item.id);
          if (error) {
            Alert.alert('Could not delete announcement', error.message);
            return;
          }
          showToast('Announcement deleted', 'success');
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

  function renderParentItem({ item }) {
    const isRead = readIds.has(item.id);
    const isUrgent = item.priority === 'urgent';
    const myRsvp = item.rsvps?.find((rsvp) => rsvp.profile_id === profile.id)?.response;
    const eventIsPast = item.rsvp_enabled && item.event_at && new Date(item.event_at) <= new Date();
    const roomLabel = item.classroom?.name ? item.classroom.name.toUpperCase() : 'ALL ROOMS';
    function openEvent() {
      if (!isRead) markRead(item);
      navigation.navigate('EventDetail', { announcement: item });
    }
    return (
      <TouchableOpacity
        style={[
          styles.parentCard,
          isUrgent && styles.urgentCard,
          item.id === focusAnnouncementId && styles.focusedCard,
        ]}
        onPress={item.rsvp_enabled ? openEvent : isUrgent && !isRead ? () => markRead(item) : undefined}
        activeOpacity={item.rsvp_enabled || (isUrgent && !isRead) ? 0.76 : 1}
      >
        {item.rsvp_enabled ? (
          <View style={styles.eventBanner}>
            <View style={styles.eventBannerIcon}>
              <Ionicons name="calendar" size={25} color={colors.white} />
            </View>
            <View style={styles.eventBannerCopy}>
              <Text style={styles.eventBannerEyebrow}>FAMILY EVENT</Text>
              <Text style={styles.eventBannerDate}>
                {item.event_at ? format(new Date(item.event_at), 'EEEE, MMMM d') : 'Date to be confirmed'}
              </Text>
            </View>
          </View>
        ) : null}
        <View style={styles.parentCardContent}>
          <View style={styles.metaRow}>
            {isUrgent ? (
              <View style={styles.urgentBadge}>
                <Ionicons name="warning" size={12} color={colors.white} />
                <Text style={styles.urgentBadgeText}>URGENT</Text>
              </View>
            ) : item.rsvp_enabled ? (
              <View style={styles.eventBadge}>
                <Text style={styles.eventBadgeText}>EVENT · RSVP</Text>
              </View>
            ) : item.pinned ? (
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
            </Text>
            {!isRead ? <View style={styles.unreadDot} /> : null}
          </View>
          <Text style={[styles.parentCardTitle, isUrgent && styles.urgentTitle]}>{item.title}</Text>
          <Text style={styles.parentCardBody} numberOfLines={item.rsvp_enabled ? 3 : 5}>{item.body}</Text>

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
                onPress={openEvent}
                activeOpacity={0.78}
              >
                <Text style={styles.rsvpPrimaryText}>
                  {eventIsPast
                    ? 'Event ended · View details'
                    : myRsvp
                      ? `RSVP: ${myRsvp === 'yes' ? 'Going' : myRsvp === 'no' ? "Can't attend" : 'Maybe'} · Edit`
                      : 'RSVP now'}
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
    const staffOnly = item.audience_type === 'staff';
    const isRead = readIds.has(item.id);
    const isUrgent = item.priority === 'urgent';
    const metrics = deliveryMetrics[item.id];
    const canDelete = !item.published_at
      && !item.cancelled_at
      && canEditBroadcasts
      && (item.author?.id === profile.id || canApproveBroadcasts);
    function openItem() {
      if (!isRead) markRead(item);
      if (item.rsvp_enabled) navigation.navigate('EventRsvps', { announcementId: item.id });
    }
    return (
      <TouchableOpacity
        style={[
          styles.staffCard,
          item.pinned && styles.staffCardPinned,
          isUrgent && styles.urgentCard,
          item.id === focusAnnouncementId && styles.focusedCard,
        ]}
        onPress={openItem}
        onLongPress={canDelete ? () => handleDelete(item) : undefined}
        activeOpacity={0.72}
      >
        <View style={styles.metaRow}>
          {isUrgent && (
            <View style={styles.urgentBadge}>
              <Ionicons name="warning" size={12} color={colors.white} />
              <Text style={styles.urgentBadgeText}>URGENT</Text>
            </View>
          )}
          {item.pinned && !isUrgent && (
            <View style={styles.pinnedBadge}>
              <Text style={styles.pinnedBadgeText}>PINNED</Text>
            </View>
          )}
          {staffOnly && (
            <View style={styles.staffAudienceBadge}>
              <Text style={styles.staffAudienceBadgeText}>STAFF ONLY</Text>
            </View>
          )}
          <Text style={styles.metaText}>
            {staffOnly ? 'Team update' : item.classroom?.name || 'All rooms'} · {announcementTime(item.created_at)}
          </Text>
          {!isRead ? <View style={[styles.unreadDot, isUrgent && styles.urgentUnreadDot]} /> : null}
        </View>
        <Text style={styles.parentCardTitle}>{item.title}</Text>
        <Text style={styles.parentCardBody}>{item.body}</Text>
        <Text style={styles.staffFooter}>
          {item.author?.full_name || 'Staff'}
          {item.rsvp_enabled ? ` · ${item.rsvps?.filter((rsvp) => rsvp.response === 'yes').length || 0} attending` : ''}
        </Text>
        {metrics ? (
          <Text style={styles.deliveryStatus}>
            Read {Number(metrics.read_count || 0)}/{Number(metrics.recipient_count || 0)} · Push delivered{' '}
            {Number(metrics.push_delivered || 0)}/{Number(metrics.push_queued || 0)}
          </Text>
        ) : null}
        {item.rsvp_enabled ? (
          <View style={styles.responsesLink}>
            <Text style={styles.responsesLinkText}>View family responses</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.primary} />
          </View>
        ) : null}
        {!isRead ? (
          <TouchableOpacity onPress={() => markRead(item)} style={styles.markReadButton}>
            <Text style={styles.markReadText}>Mark as read</Text>
          </TouchableOpacity>
        ) : null}
      </TouchableOpacity>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.container}>
        {isStaff ? <View style={styles.header}>
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
              {isStaff ? 'Family and team updates' : centerName}
            </Text>
          </View>
          {isStaff && canEditBroadcasts ? (
            <TouchableOpacity onPress={() => setComposing(true)} style={styles.newButton}>
              <Ionicons name="add" size={18} color={colors.white} />
              <Text style={styles.newButtonText}>New</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.megaphoneIcon}>
              <Ionicons name="megaphone-outline" size={18} color={colors.primary} />
            </View>
          )}
        </View> : <FamilyScreenHeader navigation={navigation} title="Center news" subtitle={centerName} />}

        {loading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={colors.primary} size="large" />
          </View>
        ) : loadError ? (
          <View style={styles.loadingWrap}>
            <EmptyState icon="📢" message={loadError} />
            <TouchableOpacity onPress={() => load()} style={styles.retryButton}>
              <Text style={styles.retryText}>Try again</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={items}
            keyExtractor={(item) => item.id}
            renderItem={isStaff ? renderStaffItem : renderParentItem}
            contentContainerStyle={styles.list}
            ListEmptyComponent={<EmptyState icon="📢" message="No announcements yet." />}
            refreshControl={(
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => load({ silent: true })}
                tintColor={colors.primary}
              />
            )}
            onScrollToIndexFailed={({ index }) => {
              setTimeout(() => listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.15 }), 120);
            }}
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
                  onPress={() => {
                    setAudienceType('families');
                    setTargetClassroom(null);
                  }}
                  style={[
                    styles.audienceChip,
                    audienceType === 'families' && !targetClassroom && styles.audienceChipActive,
                  ]}
                >
                  <Text style={[
                    styles.audienceText,
                    audienceType === 'families' && !targetClassroom && styles.audienceTextActive,
                  ]}>
                    Whole daycare
                  </Text>
                </TouchableOpacity>
                {classrooms.map((classroom) => (
                  <TouchableOpacity
                    key={classroom.id}
                    onPress={() => {
                      setAudienceType('families');
                      setTargetClassroom(classroom);
                    }}
                    style={[
                      styles.audienceChip,
                      audienceType === 'families'
                        && targetClassroom?.id === classroom.id
                        && styles.audienceChipActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.audienceText,
                        audienceType === 'families'
                          && targetClassroom?.id === classroom.id
                          && styles.audienceTextActive,
                      ]}
                    >
                      {classroom.name}
                    </Text>
                  </TouchableOpacity>
                ))}
                <TouchableOpacity
                  onPress={() => {
                    setAudienceType('staff');
                    setTargetClassroom(null);
                    setRsvpEnabled(false);
                  }}
                  style={[
                    styles.audienceChip,
                    audienceType === 'staff' && styles.audienceChipActive,
                  ]}
                >
                  <Text style={[
                    styles.audienceText,
                    audienceType === 'staff' && styles.audienceTextActive,
                  ]}>
                    Staff only
                  </Text>
                </TouchableOpacity>
              </View>

              <View style={[styles.urgentToggle, urgent && styles.urgentToggleActive]}>
                <View style={styles.eventToggleCopy}>
                  <Text style={styles.urgentToggleTitle}>Urgent alert</Text>
                  <Text style={styles.eventToggleHint}>
                    Sends now. Family alerts also notify center staff and email unread families after 15 minutes.
                  </Text>
                </View>
                <Switch
                  value={urgent}
                  onValueChange={(value) => {
                    setUrgent(value);
                    if (value) {
                      setPinned(true);
                      setRsvpEnabled(false);
                    }
                  }}
                  trackColor={{ false: colors.border, true: colors.danger }}
                />
              </View>

              {!urgent ? <View style={styles.pinRow}>
                <Text style={styles.fieldLabel}>Pin to top</Text>
                <Switch
                  value={pinned}
                  onValueChange={setPinned}
                  trackColor={{ false: colors.border, true: colors.primary }}
                />
              </View> : null}

              {audienceType === 'families' && !urgent ? <View style={styles.pinRow}>
                <View style={styles.eventToggleCopy}>
                  <Text style={styles.fieldLabel}>Collect family RSVPs</Text>
                  <Text style={styles.eventToggleHint}>Adds an event detail page and response tracking.</Text>
                </View>
                <Switch
                  value={rsvpEnabled}
                  onValueChange={setRsvpEnabled}
                  trackColor={{ false: colors.border, true: colors.primary }}
                />
              </View> : null}

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
                label={urgent ? 'Send urgent alert' : rsvpEnabled ? 'Publish event' : 'Send announcement'}
                onPress={handleSend}
                loading={sending}
                style={{ marginTop: spacing.lg }}
              />
              <Text style={styles.pushHint}>
                {urgent
                  ? audienceType === 'staff'
                    ? 'Active center staff will receive this urgent alert immediately.'
                    : `Families in ${targetClassroom ? targetClassroom.name : 'the whole daycare'} and active center staff will receive this immediately.`
                  : audienceType === 'staff'
                    ? 'Active center staff will receive this update.'
                    : `Families in ${targetClassroom ? targetClassroom.name : 'the whole daycare'} will receive this update.`}
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
  urgentCard: { borderColor: colors.danger, backgroundColor: '#FFF8F8' },
  focusedCard: { borderColor: colors.primary, borderWidth: 2.5 },
  urgentBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: radius.full,
    backgroundColor: colors.danger,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  urgentBadgeText: { fontSize: 10.5, letterSpacing: 0.7, fontFamily: fonts.black, color: colors.white },
  urgentTitle: { color: colors.danger },
  eventBanner: {
    minHeight: 104,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
    backgroundColor: colors.primary,
  },
  eventBannerIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  eventBannerCopy: { flex: 1 },
  eventBannerEyebrow: { fontSize: 10.5, letterSpacing: 1.1, fontFamily: fonts.bold, color: '#DCEBFF' },
  eventBannerDate: { marginTop: 5, fontSize: 18, lineHeight: 23, fontFamily: fonts.black, color: colors.white },
  parentCardContent: { padding: spacing.lg },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  pinnedBadge: {
    borderRadius: radius.full,
    backgroundColor: colors.primaryLight,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  pinnedBadgeText: { fontSize: 11, letterSpacing: 0.6, fontFamily: fonts.bold, color: colors.primary },
  staffAudienceBadge: {
    borderRadius: radius.full,
    backgroundColor: '#EDF2F9',
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  staffAudienceBadgeText: {
    fontSize: 11,
    letterSpacing: 0.6,
    fontFamily: fonts.bold,
    color: colors.textMuted,
  },
  eventBadge: {
    borderRadius: radius.full,
    backgroundColor: colors.successLight,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  eventBadgeText: { fontSize: 11, letterSpacing: 0.5, fontFamily: fonts.bold, color: colors.success },
  roomBadge: {
    borderRadius: radius.full,
    backgroundColor: colors.amberLight,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  roomBadgeText: { fontSize: 11, letterSpacing: 0.5, fontFamily: fonts.bold, color: colors.amber },
  metaText: { flex: 1, fontSize: 12, fontFamily: fonts.regular, color: colors.textFaint },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary },
  urgentUnreadDot: { backgroundColor: colors.danger },
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
  deliveryStatus: {
    marginTop: spacing.sm,
    fontSize: 11.5,
    fontFamily: fonts.bold,
    color: colors.textSecondary,
  },
  responsesLink: { flexDirection: 'row', alignItems: 'center', gap: 3, alignSelf: 'flex-start', marginTop: spacing.sm },
  responsesLinkText: { fontSize: 12.5, fontFamily: fonts.bold, color: colors.primary },
  retryButton: {
    marginTop: spacing.md,
    borderWidth: 1.5,
    borderColor: colors.primary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
  },
  retryText: { fontSize: 13.5, fontFamily: fonts.bold, color: colors.primary },
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
  urgentToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    padding: spacing.md,
  },
  urgentToggleActive: { borderColor: colors.danger, backgroundColor: colors.dangerLight },
  urgentToggleTitle: { marginBottom: spacing.sm, fontSize: 13, fontFamily: fonts.bold, color: colors.textPrimary },
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
