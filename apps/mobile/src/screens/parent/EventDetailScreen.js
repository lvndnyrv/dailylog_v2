import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { format } from 'date-fns';
import { useAuth } from '../../hooks/useAuth';
import { sendEventRsvp } from '../../hooks/useStaffVisibility';
import { supabase } from '../../lib/supabase';
import { Button, EmptyState } from '../../components/ui';
import { showToast } from '../../components/Toast';
import { colors, fonts, radius, spacing } from '../../theme';

const RESPONSES = [
  { key: 'yes', label: 'Yes', subtitle: "We'll be there", icon: 'checkmark-circle-outline' },
  { key: 'maybe', label: 'Maybe', subtitle: 'Not sure yet', icon: 'help-circle-outline' },
  { key: 'no', label: 'No', subtitle: "Can't make it", icon: 'close-circle-outline' },
];

export default function EventDetailScreen({ navigation, route }) {
  const { profile } = useAuth();
  const announcementId = route.params?.announcementId || route.params?.announcement?.id;
  const [event, setEvent] = useState(route.params?.announcement || null);
  const [response, setResponse] = useState(null);
  const [guests, setGuests] = useState(1);
  const [loading, setLoading] = useState(!route.params?.announcement);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { load(); }, [announcementId, profile?.id]);

  async function load() {
    if (!announcementId || !profile?.id) {
      setError('This event could not be identified.');
      setLoading(false);
      return;
    }
    setError('');
    const { data, error: loadError } = await supabase
      .from('announcements')
      .select('*, classroom:classrooms(name), rsvps:announcement_rsvps(profile_id,response,guests,updated_at)')
      .eq('id', announcementId)
      .single();
    if (loadError) {
      setError(loadError.message || 'This event is not available.');
      setLoading(false);
      return;
    }
    setEvent(data);
    const own = data.rsvps?.find((item) => item.profile_id === profile.id);
    if (own) {
      setResponse(own.response);
      setGuests(Math.max(1, own.guests || 1));
    }
    setLoading(false);

    await supabase.from('announcement_reads').upsert({
      announcement_id: announcementId,
      profile_id: profile.id,
      read_at: new Date().toISOString(),
    }, { onConflict: 'announcement_id,profile_id' });
  }

  async function save() {
    if (!response) {
      Alert.alert('Choose a response', 'Let the center know if your family can attend.');
      return;
    }
    setSaving(true);
    try {
      const saved = await sendEventRsvp(announcementId, response, response === 'no' ? 0 : guests);
      setResponse(saved.response);
      setGuests(Math.max(1, saved.guests || 1));
      showToast('Your RSVP was saved', 'success');
      navigation.goBack();
    } catch (saveError) {
      Alert.alert('Could not save RSVP', saveError.message || 'Please try again.');
    } finally {
      setSaving(false);
    }
  }

  const starts = event?.event_at ? new Date(event.event_at) : null;
  const ends = event?.event_ends_at ? new Date(event.event_ends_at) : null;
  const isPast = starts ? starts <= new Date() : false;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.back} accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Event details</Text>
        <View style={styles.back} />
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>
      ) : error || !event ? (
        <View style={styles.center}><EmptyState icon="📅" message={error || 'This event is not available.'} /></View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.hero}>
            <View style={styles.calendarIcon}>
              <Ionicons name="calendar" size={25} color={colors.primary} />
            </View>
            <Text style={styles.eventLabel}>FAMILY EVENT</Text>
            <Text style={styles.title}>{event.title}</Text>
            <Text style={styles.body}>{event.body}</Text>
          </View>

          <View style={styles.detailsCard}>
            <View style={styles.detailRow}>
              <View style={styles.detailIcon}><Ionicons name="time-outline" size={20} color={colors.primary} /></View>
              <View style={styles.detailCopy}>
                <Text style={styles.detailLabel}>DATE & TIME</Text>
                <Text style={styles.detailValue}>
                  {starts ? format(starts, 'EEEE, MMMM d · h:mm a') : 'To be confirmed'}
                  {ends ? `–${format(ends, 'h:mm a')}` : ''}
                </Text>
              </View>
            </View>
            <View style={styles.detailDivider} />
            <View style={styles.detailRow}>
              <View style={styles.detailIcon}><Ionicons name="location-outline" size={20} color={colors.primary} /></View>
              <View style={styles.detailCopy}>
                <Text style={styles.detailLabel}>LOCATION</Text>
                <Text style={styles.detailValue}>{event.event_location || 'The center will confirm the location'}</Text>
              </View>
            </View>
            {event.classroom?.name ? (
              <>
                <View style={styles.detailDivider} />
                <View style={styles.detailRow}>
                  <View style={styles.detailIcon}><Ionicons name="people-outline" size={20} color={colors.primary} /></View>
                  <View style={styles.detailCopy}>
                    <Text style={styles.detailLabel}>INVITED</Text>
                    <Text style={styles.detailValue}>{event.classroom.name} families</Text>
                  </View>
                </View>
              </>
            ) : null}
          </View>

          <Text style={styles.sectionTitle}>Can your family attend?</Text>
          <View style={styles.responseRow}>
            {RESPONSES.map((option) => {
              const selected = response === option.key;
              return (
                <TouchableOpacity
                  key={option.key}
                  onPress={() => setResponse(option.key)}
                  disabled={isPast}
                  style={[styles.responseCard, selected && styles.responseCardSelected, isPast && styles.disabled]}
                >
                  <Ionicons name={option.icon} size={24} color={selected ? colors.white : colors.primary} />
                  <Text style={[styles.responseLabel, selected && styles.responseLabelSelected]}>{option.label}</Text>
                  <Text style={[styles.responseSub, selected && styles.responseSubSelected]}>{option.subtitle}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {response && response !== 'no' ? (
            <View style={styles.guestsCard}>
              <View style={styles.guestsCopy}>
                <Text style={styles.guestsTitle}>How many are coming?</Text>
                <Text style={styles.guestsSub}>Include your child in the total.</Text>
              </View>
              <View style={styles.stepper}>
                <TouchableOpacity onPress={() => setGuests((value) => Math.max(1, value - 1))} style={styles.stepperButton}>
                  <Ionicons name="remove" size={20} color={colors.primary} />
                </TouchableOpacity>
                <Text style={styles.guestNumber}>{guests}</Text>
                <TouchableOpacity onPress={() => setGuests((value) => Math.min(20, value + 1))} style={styles.stepperButton}>
                  <Ionicons name="add" size={20} color={colors.primary} />
                </TouchableOpacity>
              </View>
            </View>
          ) : null}

          {isPast ? (
            <View style={styles.pastCard}>
              <Ionicons name="information-circle-outline" size={20} color={colors.textMuted} />
              <Text style={styles.pastText}>This event has started, so responses are now closed.</Text>
            </View>
          ) : (
            <Button label="Send RSVP" onPress={save} loading={saving} style={styles.saveButton} />
          )}

          <Text style={styles.footer}>You can update your response any time before the event starts.</Text>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  header: { minHeight: 66, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, borderBottomWidth: 1.5, borderBottomColor: colors.primaryLight },
  back: { width: 40, height: 44, justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontFamily: fonts.bold, color: colors.textPrimary },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl },
  content: { padding: spacing.xl, paddingBottom: 52 },
  hero: { alignItems: 'center', paddingVertical: spacing.lg },
  calendarIcon: { width: 54, height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primaryLight, marginBottom: spacing.md },
  eventLabel: { fontSize: 11, letterSpacing: 1, fontFamily: fonts.bold, color: colors.primary },
  title: { marginTop: spacing.sm, textAlign: 'center', fontSize: 25, lineHeight: 31, fontFamily: fonts.black, color: colors.textPrimary },
  body: { marginTop: spacing.md, textAlign: 'center', fontSize: 14, lineHeight: 22, fontFamily: fonts.regular, color: colors.textMuted },
  detailsCard: { marginTop: spacing.md, borderWidth: 1.5, borderColor: colors.border, borderRadius: 18, backgroundColor: colors.surface, overflow: 'hidden' },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg },
  detailIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primarySoft },
  detailCopy: { flex: 1 },
  detailLabel: { fontSize: 10.5, letterSpacing: 0.8, fontFamily: fonts.bold, color: colors.textFaint },
  detailValue: { marginTop: 4, fontSize: 14, lineHeight: 20, fontFamily: fonts.bold, color: colors.textPrimary },
  detailDivider: { height: 1, marginHorizontal: spacing.lg, backgroundColor: colors.primarySoft },
  sectionTitle: { marginTop: spacing.xl, marginBottom: spacing.md, fontSize: 17, fontFamily: fonts.black, color: colors.textPrimary },
  responseRow: { flexDirection: 'row', gap: spacing.sm },
  responseCard: { flex: 1, minHeight: 102, alignItems: 'center', justifyContent: 'center', padding: spacing.sm, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface },
  responseCardSelected: { borderColor: colors.primary, backgroundColor: colors.primary },
  responseLabel: { marginTop: 6, fontSize: 14, fontFamily: fonts.bold, color: colors.textPrimary },
  responseLabelSelected: { color: colors.white },
  responseSub: { marginTop: 2, fontSize: 9.5, fontFamily: fonts.regular, color: colors.textMuted, textAlign: 'center' },
  responseSubSelected: { color: '#EAF3FF' },
  disabled: { opacity: 0.55 },
  guestsCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.lg, padding: spacing.lg, borderRadius: radius.md, backgroundColor: colors.primarySoft },
  guestsCopy: { flex: 1 },
  guestsTitle: { fontSize: 14, fontFamily: fonts.bold, color: colors.textPrimary },
  guestsSub: { marginTop: 3, fontSize: 11.5, fontFamily: fonts.regular, color: colors.textMuted },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  stepperButton: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border },
  guestNumber: { minWidth: 24, textAlign: 'center', fontSize: 18, fontFamily: fonts.black, color: colors.textPrimary },
  saveButton: { marginTop: spacing.xl },
  pastCard: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center', marginTop: spacing.xl, padding: spacing.lg, borderRadius: radius.md, backgroundColor: colors.primarySoft },
  pastText: { flex: 1, fontSize: 12.5, lineHeight: 18, fontFamily: fonts.regular, color: colors.textMuted },
  footer: { marginTop: spacing.md, textAlign: 'center', fontSize: 11.5, lineHeight: 17, fontFamily: fonts.regular, color: colors.textFaint },
});
