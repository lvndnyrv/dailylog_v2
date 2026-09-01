import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  KeyboardAvoidingView,
  Linking,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { format, formatDistanceToNowStrict, isThisWeek, isNextWeek } from 'date-fns';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DatePickerField } from '../../components/DatePickerField';
import { Button, Input } from '../../components/ui';
import { useEnrollmentOffer } from '../../hooks/useEnrollmentOffer';
import { useParentInquiryJourney } from '../../hooks/useParentInquiryJourney';
import { colors, fonts, radius, spacing } from '../../theme';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function replyWindow(hours) {
  const value = Number(hours);
  if (!Number.isFinite(value) || value <= 24) return 'one business day';
  const days = Math.ceil(value / 24);
  return `${days} business days`;
}

function prettyDate(value, pattern = 'EEE, MMM d') {
  if (!value) return 'To be confirmed';
  return format(new Date(value), pattern);
}

function dateOnly(value, pattern = 'MMM d, yyyy') {
  if (!value) return 'To be confirmed';
  return format(new Date(`${value}T12:00:00`), pattern);
}

function CenterIdentity({ center, program }) {
  const initials = String(center?.name || 'DL')
    .split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
  return (
    <View style={styles.centerIdentity}>
      <View style={styles.centerMark}><Text style={styles.centerMarkText}>{initials}</Text></View>
      <View style={styles.flexOne}>
        <Text style={styles.centerName}>{center?.name || 'Your daycare'}</Text>
        <Text style={styles.centerDetail} numberOfLines={1}>
          {program?.name ? `${program.name} · ` : ''}{center?.address || 'Enrollment team'}
        </Text>
      </View>
    </View>
  );
}

function Progress({ active }) {
  const steps = ['Inquiry', 'Tour', 'Waitlist', 'Offer'];
  const activeIndex = steps.indexOf(active);
  return (
    <View style={styles.progress}>
      {steps.map((step, index) => {
        const complete = index < activeIndex;
        const current = index === activeIndex;
        return (
          <View key={step} style={styles.progressStep}>
            <View style={styles.progressRail}>
              <View style={[styles.progressLine, index === 0 && styles.progressLineClear, complete && styles.progressLineDone]} />
              <View style={[styles.progressDot, complete && styles.progressDotDone, current && styles.progressDotCurrent]}>
                {complete ? <Ionicons name="checkmark" size={12} color={colors.white} /> : null}
              </View>
              <View style={[styles.progressLine, index === steps.length - 1 && styles.progressLineClear, (complete || current) && styles.progressLineDone]} />
            </View>
            <Text style={[styles.progressLabel, (complete || current) && styles.progressLabelActive]}>{step}</Text>
          </View>
        );
      })}
    </View>
  );
}

function PageAction({ label, onPress, secondary = false, loading = false, disabled = false, icon, style }) {
  return (
    <TouchableOpacity
      style={[styles.pageAction, secondary && styles.pageActionSecondary, (disabled || loading) && styles.disabled, style]}
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
    >
      {loading ? <ActivityIndicator color={secondary ? colors.primary : colors.white} /> : (
        <>
          {icon ? <Ionicons name={icon} size={18} color={secondary ? colors.primary : colors.white} /> : null}
          <Text style={[styles.pageActionText, secondary && styles.pageActionTextSecondary]}>{label}</Text>
        </>
      )}
    </TouchableOpacity>
  );
}

function InquiryForm({ center, busy, onSubmit }) {
  const programs = center?.programs || [];
  const [childName, setChildName] = useState('');
  const [dob, setDob] = useState('');
  const [desiredStart, setDesiredStart] = useState('');
  const [classroomId, setClassroomId] = useState(programs[0]?.id || '');
  const [guardianName, setGuardianName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [days, setDays] = useState(5);
  const [errors, setErrors] = useState({});

  function clear(key, setter) {
    return (value) => {
      setter(value);
      setErrors((current) => {
        if (!current[key]) return current;
        const next = { ...current };
        delete next[key];
        return next;
      });
    };
  }

  function submit() {
    const next = {};
    if (!childName.trim()) next.childName = "Child's full name is required.";
    if (!dob) next.dob = 'Date of birth is required.';
    if (!desiredStart) next.desiredStart = 'Ideal start date is required.';
    if (!classroomId) next.classroomId = 'Choose a program.';
    if (!guardianName.trim()) next.guardianName = 'Your full name is required.';
    if (!email.trim()) next.email = 'Email is required.';
    else if (!EMAIL.test(email.trim())) next.email = 'Enter a valid email.';
    setErrors(next);
    if (Object.keys(next).length) return;
    onSubmit({
      childName: childName.trim(),
      childDateOfBirth: dob,
      desiredStart,
      classroomId,
      guardianName: guardianName.trim(),
      guardianEmail: email.trim().toLowerCase(),
      guardianPhone: phone.trim(),
      daysPerWeek: days,
    });
  }

  return (
    <View>
      <CenterIdentity center={center} />
      <Text style={styles.eyebrow}>NOW ENROLLING</Text>
      <Text style={styles.title}>Ask about a spot</Text>
      <Text style={styles.subtitle}>
        Tell us a little about your child — {center?.name || 'the center'} will reply within {replyWindow(center?.reply_hours)}. No account needed.
      </Text>

      <Input label="Child's full name (required)" value={childName} onChangeText={clear('childName', setChildName)} placeholder="Nora Adeyemi" error={errors.childName} />
      <DatePickerField label="Date of birth (required)" value={dob} onChange={clear('dob', setDob)} maximumDate={new Date()} error={errors.dob} />
      <DatePickerField
        label="Ideal start (required)"
        value={desiredStart}
        onChange={clear('desiredStart', setDesiredStart)}
        minimumDate={new Date()}
        maximumDate={new Date(new Date().setFullYear(new Date().getFullYear() + 3))}
        placeholder="Choose an ideal start date"
        error={errors.desiredStart}
      />

      <Text style={styles.fieldLabel}>Program (required)</Text>
      <View style={[styles.chipRow, errors.classroomId && styles.fieldGroupError]}>
        {programs.map((program) => (
          <TouchableOpacity
            key={program.id}
            style={[styles.programChip, classroomId === program.id && styles.programChipSelected]}
            onPress={() => clear('classroomId', setClassroomId)(program.id)}
            accessibilityRole="radio"
            accessibilityState={{ selected: classroomId === program.id }}
          >
            <Text style={[styles.programChipText, classroomId === program.id && styles.programChipTextSelected]}>{program.name}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {errors.classroomId ? <Text style={styles.fieldError}>{errors.classroomId}</Text> : null}

      <Text style={styles.fieldLabel}>Schedule</Text>
      <View style={styles.chipRow}>
        {[5, 3, 2].map((value) => (
          <TouchableOpacity
            key={value}
            style={[styles.dayChip, days === value && styles.programChipSelected]}
            onPress={() => setDays(value)}
            accessibilityRole="radio"
            accessibilityState={{ selected: days === value }}
          >
            <Text style={[styles.programChipText, days === value && styles.programChipTextSelected]}>{value} days / week</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Input label="Your full name (required)" value={guardianName} onChangeText={clear('guardianName', setGuardianName)} placeholder="Jane Adeyemi" error={errors.guardianName} autoComplete="name" />
      <Input label="Your email (required)" value={email} onChangeText={clear('email', setEmail)} placeholder="jane@email.com" keyboardType="email-address" autoCapitalize="none" autoComplete="email" error={errors.email} />
      <Input label="Phone number (optional)" value={phone} onChangeText={setPhone} placeholder="905-555-0100" keyboardType="phone-pad" autoComplete="tel" />
      {Object.keys(errors).length ? <Text style={styles.formError}>Check the highlighted required fields.</Text> : null}
      <Button label="Send inquiry" onPress={submit} loading={busy} style={styles.fullButton} />
      <Text style={styles.privacyNote}>Your details are used only to reply about enrollment.</Text>
    </View>
  );
}

function InquiryReceived({ journey, onBook, onContact }) {
  const child = [journey.child?.first_name, journey.child?.last_name].filter(Boolean).join(' ') || 'your child';
  return (
    <View>
      <CenterIdentity center={journey.daycare} program={journey.program} />
      <Text style={styles.title}>Thanks — we&apos;ve got your{`\n`}inquiry for {child}</Text>
      <Text style={styles.subtitle}>We&apos;ll be in touch within {replyWindow(journey.daycare?.reply_hours)}. Here&apos;s what happens next:</Text>
      <Progress active="Tour" />
      <View style={styles.card}>
        <Text style={styles.eyebrow}>NEXT STEP</Text>
        <Text style={styles.cardTitle}>Book a tour</Text>
        <Text style={styles.cardBody}>
          Come see the {journey.program?.name || 'program'} room and meet the team. Pick a time that suits you.
        </Text>
      </View>
      <PageAction label="Book your tour" onPress={onBook} disabled={!journey.open_tour_slots?.length} />
      {!journey.open_tour_slots?.length ? (
        <View style={styles.infoCard}><Text style={styles.infoText}>No online tour times are open yet. The center can add one or arrange another time with you.</Text></View>
      ) : null}
      <TouchableOpacity onPress={onContact} style={styles.textLink}><Text style={styles.textLinkLabel}>Questions? Contact {journey.daycare?.name}</Text></TouchableOpacity>
    </View>
  );
}

function TourBooking({ journey, selected, setSelected, busy, onConfirm, onBack, onContact }) {
  const slots = journey.open_tour_slots || [];
  return (
    <View>
      <Header title="Book a tour" onBack={onBack} />
      <Text style={styles.subtitle}>Choose a time to visit. A team member will meet you at the door.</Text>
      {slots.map((slot, index) => {
        const date = new Date(slot.starts_at);
        const section = isThisWeek(date) ? 'THIS WEEK' : isNextWeek(date) ? 'NEXT WEEK' : 'UPCOMING';
        const previous = index ? new Date(slots[index - 1].starts_at) : null;
        const previousSection = previous ? (isThisWeek(previous) ? 'THIS WEEK' : isNextWeek(previous) ? 'NEXT WEEK' : 'UPCOMING') : null;
        return (
          <React.Fragment key={slot.id}>
            {section !== previousSection ? <Text style={styles.listSection}>{section}</Text> : null}
            <TouchableOpacity
              style={[styles.slotCard, selected === slot.id && styles.slotCardSelected]}
              onPress={() => setSelected(slot.id)}
              accessibilityRole="radio"
              accessibilityState={{ selected: selected === slot.id }}
            >
              <View style={[styles.radio, selected === slot.id && styles.radioSelected]}>
                {selected === slot.id ? <Ionicons name="checkmark" size={13} color={colors.white} /> : null}
              </View>
              <View style={styles.flexOne}>
                <Text style={styles.slotTime}>{prettyDate(slot.starts_at, 'EEE MMM d · h:mm a')}</Text>
                <Text style={styles.slotHost}>Host: {slot.host_name || 'Enrollment team'}{slot.host_title ? ` · ${slot.host_title}` : ''}</Text>
              </View>
            </TouchableOpacity>
          </React.Fragment>
        );
      })}
      {!slots.length ? <View style={styles.card}><Text style={styles.cardBody}>No online tour times are currently open.</Text></View> : null}
      <View style={styles.infoCard}>
        <Ionicons name="calendar-outline" size={18} color={colors.primary} />
        <Text style={styles.infoText}>We&apos;ll email a reminder the evening before.</Text>
      </View>
      <PageAction label="Confirm tour" onPress={() => onConfirm(selected)} loading={busy} disabled={!selected} />
      <TouchableOpacity onPress={onContact} style={styles.textLink}><Text style={styles.textLinkLabel}>None of these work? Ask for another time</Text></TouchableOpacity>
    </View>
  );
}

function TourBooked({ journey, busy, onCalendar, onDirections, onReschedule, onCancel, onContact }) {
  const tour = journey.tour;
  const upcoming = Boolean(tour?.starts_at && new Date(tour.starts_at).getTime() > Date.now());
  return (
    <View style={styles.centered}>
      <View style={upcoming ? styles.successIcon : styles.neutralIcon}>
        <Ionicons name={upcoming ? 'checkmark' : 'time-outline'} size={36} color={upcoming ? colors.success : colors.textMuted} />
      </View>
      <Text style={styles.titleCentered}>{upcoming ? "You're booked!" : 'Your tour time has passed'}</Text>
      <Text style={styles.subtitleCentered}>
        {upcoming
          ? `We look forward to meeting you and ${journey.child?.first_name || 'your child'}.`
          : 'The center will update your next step soon. You can contact them if you need an update.'}
      </Text>
      <Progress active="Waitlist" />
      <View style={[styles.card, styles.fullWidth]}>
        <InfoRow label="When" value={prettyDate(tour?.starts_at, 'EEE MMM d · h:mm a')} />
        <InfoRow label="Host" value={tour?.host_name || 'Enrollment team'} />
        <InfoRow label="Where" value={journey.daycare?.address || 'Center address to follow'} last />
      </View>
      {upcoming ? (
        <>
          <View style={styles.twoActions}>
            <PageAction label="Add to calendar" onPress={onCalendar} secondary icon="calendar-outline" style={styles.halfAction} />
            <PageAction label="Get directions" onPress={onDirections} secondary icon="navigate-outline" style={styles.halfAction} />
          </View>
          <View style={styles.bookingLinks}>
            <TouchableOpacity onPress={onReschedule} style={styles.textLink} disabled={busy}>
              <Text style={styles.textLinkLabelMuted}>Reschedule</Text>
            </TouchableOpacity>
            <View style={styles.bookingLinkDivider} />
            <TouchableOpacity onPress={onCancel} style={styles.textLink} disabled={busy}>
              <Text style={styles.destructiveLink}>{busy ? 'Updating…' : 'Cancel tour'}</Text>
            </TouchableOpacity>
          </View>
        </>
      ) : (
        <PageAction label="Message the center" onPress={onContact} secondary icon="chatbubble-outline" style={styles.fullWidth} />
      )}
      <View style={[styles.infoCard, styles.fullWidth]}><Text style={styles.infoText}>After your visit, the center will let you know about a spot. If none is open yet, you can join the waitlist and track your place here.</Text></View>
    </View>
  );
}

function WaitlistPlace({ journey, onChangePlans, onOffer }) {
  const waitlist = journey.waitlist || {};
  const joined = waitlist.joined_at;
  return (
    <View>
      <Text style={styles.title}>Your waitlist place</Text>
      <Progress active={journey.offer?.available ? 'Offer' : 'Waitlist'} />
      {journey.offer?.available ? (
        <View style={styles.offerCard}>
          <Ionicons name="sparkles" size={24} color={colors.white} />
          <Text style={styles.offerTitle}>{journey.child?.first_name || 'Your child'} has a spot!</Text>
          <Text style={styles.offerBody}>The center is holding an offer for your family.</Text>
          <TouchableOpacity style={styles.offerButton} onPress={onOffer}><Text style={styles.offerButtonText}>Review offer</Text></TouchableOpacity>
        </View>
      ) : (
        <View style={styles.positionCard}>
          <Text style={styles.positionLabel}>YOUR POSITION</Text>
          <Text style={styles.positionNumber}>#{waitlist.position || '—'}</Text>
          <Text style={styles.positionSub}>of {waitlist.total || 0} waiting for {journey.program?.name || 'this program'}</Text>
          <View style={styles.estimatePill}><Text style={styles.estimateText}>Target start: {dateOnly(journey.child?.desired_start_date, 'MMM yyyy')}</Text></View>
        </View>
      )}
      <View style={styles.card}>
        <InfoRow label="Program" value={`${journey.program?.name || 'Program'} · ${dateOnly(journey.child?.desired_start_date, 'MMM yyyy')} start`} />
        <InfoRow label="On the list since" value={dateOnly(joined?.slice(0, 10))} />
        <InfoRow label="Priority" value={waitlist.priority === 'sibling' ? 'Sibling enrolled' : waitlist.priority === 'staff' ? 'Staff family' : 'Public list'} last />
      </View>
      <View style={styles.warmCard}>
        <Ionicons name="notifications-outline" size={18} color={colors.amber} />
        <Text style={styles.warmText}>We&apos;ll notify you when a matching spot opens. Offers are held according to the center&apos;s waitlist rules.</Text>
      </View>
      <TouchableOpacity onPress={onChangePlans} style={styles.textLink}><Text style={styles.textLinkLabelMuted}>Our plans changed →</Text></TouchableOpacity>
    </View>
  );
}

function WaitlistCheckin({ journey, busy, proactive, onKeep, onRemove, onBack }) {
  const waitlist = journey.waitlist || {};
  const waitingSince = waitlist.joined_at
    ? formatDistanceToNowStrict(new Date(waitlist.joined_at))
    : 'a while';
  return (
    <View style={styles.centered}>
      <View style={styles.warmIcon}><Ionicons name="notifications-outline" size={34} color={colors.amber} /></View>
      <Text style={styles.titleCentered}>{proactive ? 'Have your plans changed?' : 'Still interested?'}</Text>
      <Text style={styles.subtitleCentered}>
        You&apos;ve been on the {journey.program?.name || 'program'} waitlist for {waitingSince}. Let the center know whether you&apos;d like to keep your place.
      </Text>
      <View style={styles.placePill}><Text style={styles.placeNumber}>#{waitlist.position || '—'}</Text><Text style={styles.placeText}>Your current place in line</Text></View>
      <PageAction label="Yes, keep my spot" onPress={onKeep} loading={busy} />
      <PageAction label="Remove me from the list" onPress={onRemove} secondary disabled={busy} />
      {proactive ? (
        <TouchableOpacity onPress={onBack} style={styles.textLink} disabled={busy}>
          <Text style={styles.textLinkLabelMuted}>Back to my waitlist place</Text>
        </TouchableOpacity>
      ) : null}
      <Text style={styles.checkinNote}>No reply keeps your spot for now. After {waitlist.archive_after || 2} unanswered check-ins, the entry is archived—not deleted—and the center can restore it later.</Text>
    </View>
  );
}

function ClosedInquiry({ journey, onContact, onFinish }) {
  return (
    <View style={styles.centered}>
      <View style={styles.neutralIcon}><Ionicons name="mail-open-outline" size={32} color={colors.textMuted} /></View>
      <Text style={styles.titleCentered}>This inquiry is closed</Text>
      <Text style={styles.subtitleCentered}>
        {journey.child?.first_name || 'Your child'}&apos;s inquiry is no longer active. The center kept the family record, so you can contact them if your plans change.
      </Text>
      <PageAction label="Contact the center" onPress={onContact} />
      <PageAction label="Return to DailyLog" onPress={onFinish} secondary />
    </View>
  );
}

function EnrollmentComplete({ journey, onFinish }) {
  return (
    <View style={styles.centered}>
      <View style={styles.successIcon}><Ionicons name="checkmark" size={36} color={colors.success} /></View>
      <Text style={styles.titleCentered}>Enrollment complete</Text>
      <Text style={styles.subtitleCentered}>
        {journey.child?.first_name || 'Your child'} is enrolled. Continue to DailyLog to see the family account and next steps.
      </Text>
      <PageAction label="Continue to DailyLog" onPress={onFinish} />
    </View>
  );
}

function Archived({ journey, onContact, onFinish }) {
  return (
    <View style={styles.centered}>
      <View style={styles.neutralIcon}><Ionicons name="archive-outline" size={32} color={colors.textMuted} /></View>
      <Text style={styles.titleCentered}>Waitlist entry archived</Text>
      <Text style={styles.subtitleCentered}>{journey.child?.first_name || 'Your child'} is no longer on the active list. The family record was kept safely.</Text>
      <PageAction label="Contact the center" onPress={onContact} />
      <PageAction label="Return to DailyLog" onPress={onFinish} secondary />
    </View>
  );
}

function Header({ title, onBack }) {
  return (
    <View style={styles.header}>
      <TouchableOpacity onPress={onBack} style={styles.back}><Ionicons name="chevron-back" size={21} color={colors.textPrimary} /></TouchableOpacity>
      <Text style={styles.headerTitle}>{title}</Text>
    </View>
  );
}

function InfoRow({ label, value, last = false }) {
  return (
    <View style={[styles.infoRow, !last && styles.infoRowBorder]}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

export default function ParentInquiryJourneyScreen() {
  const inquiry = useParentInquiryJourney();
  const offer = useEnrollmentOffer();
  const [mode, setMode] = useState(null);
  const [selectedSlot, setSelectedSlot] = useState(null);

  const slotKey = useMemo(
    () => (inquiry.journey?.open_tour_slots || []).map((slot) => slot.id).join('|'),
    [inquiry.journey?.open_tour_slots],
  );

  const naturalMode = useMemo(() => {
    if (!inquiry.code) return 'form';
    if (!inquiry.journey) return 'loading';
    if (inquiry.journey.stage === 'enrolled') return 'enrolled';
    if (
      inquiry.journey.stage === 'withdrawn'
      && inquiry.journey.waitlist?.status === 'archived'
      && !inquiry.journey.waitlist?.joined_at
    ) return 'closed';
    if (inquiry.journey.waitlist?.status === 'archived') return 'archived';
    if (inquiry.journey.waitlist?.checkin_due) return 'checkin';
    if (inquiry.journey.offer?.available || ['active', 'offer'].includes(inquiry.journey.waitlist?.status)) return 'waitlist';
    if (inquiry.journey.tour) return 'booked';
    return 'received';
  }, [inquiry.code, inquiry.journey]);

  useEffect(() => {
    setMode(null);
  }, [inquiry.journey?.id, inquiry.journey?.tour?.id]);

  useEffect(() => {
    const slots = inquiry.journey?.open_tour_slots || [];
    setSelectedSlot((current) => (
      slots.some((slot) => slot.id === current) ? current : (slots[0]?.id || null)
    ));
  }, [inquiry.journey?.id, slotKey]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active' && (inquiry.code || inquiry.centerId)) inquiry.refresh();
    });
    return () => subscription.remove();
  }, [inquiry.centerId, inquiry.code, inquiry.refresh]);

  const visibleMode = mode || naturalMode;

  async function submit(values) {
    try {
      await inquiry.submitInquiry(values);
      setMode('received');
    } catch (error) {
      Alert.alert('Could not send inquiry', error.message);
    }
  }

  async function book(slotId) {
    try {
      await inquiry.bookTour(slotId);
      setMode('booked');
    } catch (error) {
      Alert.alert('Tour unavailable', error.message);
      await inquiry.refresh();
    }
  }

  async function calendar() {
    try { await inquiry.addTourToCalendar(); }
    catch (error) { Alert.alert('Calendar unavailable', error.message); }
  }

  async function directions() {
    try { await inquiry.getDirections(); }
    catch (error) { Alert.alert('Directions unavailable', error.message); }
  }

  function cancelTour() {
    Alert.alert(
      'Cancel this tour?',
      'The time will be released for another family. You can book a different tour later from this same secure link.',
      [
        { text: 'Keep tour', style: 'cancel' },
        {
          text: 'Cancel tour',
          style: 'destructive',
          onPress: async () => {
            try {
              await inquiry.cancelTour();
              setMode('received');
              Alert.alert('Tour cancelled', 'The tour time has been released. You can choose another time whenever you are ready.');
            } catch (error) {
              Alert.alert('Could not cancel tour', error.message);
              await inquiry.refresh();
            }
          },
        },
      ],
    );
  }

  async function contact() {
    const phone = inquiry.journey?.daycare?.phone || inquiry.center?.phone;
    if (!phone) {
      Alert.alert('Contact the center', 'The center has not added a public phone number yet.');
      return;
    }
    const url = `sms:${phone.replace(/[^+\d]/g, '')}`;
    try {
      if (!(await Linking.canOpenURL(url))) throw new Error('Messaging is unavailable.');
      await Linking.openURL(url);
    } catch {
      Alert.alert('Contact the center', `Call ${phone} to speak with the enrollment team.`);
    }
  }

  async function keepSpot() {
    try {
      await inquiry.respondToWaitlist(true);
      setMode('waitlist');
    } catch (error) { Alert.alert('Could not save response', error.message); }
  }

  function removeSpot() {
    Alert.alert(
      'Leave the waitlist?',
      'Your place will be released. The center can restore the archived record if your plans change again.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Leave waitlist', style: 'destructive', onPress: async () => {
          try {
            await inquiry.respondToWaitlist(false);
            setMode('archived');
          } catch (error) { Alert.alert('Could not leave waitlist', error.message); }
        } },
      ],
    );
  }

  async function openOffer() {
    await offer.beginOffer(inquiry.code);
    await inquiry.finishJourney();
  }

  if (inquiry.loading && !inquiry.center && !inquiry.journey) {
    return <SafeAreaView style={styles.safe}><View style={styles.loading}><ActivityIndicator size="large" color={colors.primary} /><Text style={styles.loadingText}>Loading enrollment journey…</Text></View></SafeAreaView>;
  }

  if (inquiry.error && !inquiry.center && !inquiry.journey) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.loading}><Ionicons name="link-outline" size={34} color={colors.danger} /><Text style={styles.titleCentered}>This link isn&apos;t available</Text><Text style={styles.subtitleCentered}>{inquiry.error}</Text><PageAction label="Try again" onPress={inquiry.refresh} /><PageAction label="Return to DailyLog" onPress={inquiry.finishJourney} secondary /></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <KeyboardAvoidingView style={styles.flexOne} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          refreshControl={(
            <RefreshControl
              refreshing={inquiry.loading && Boolean(inquiry.center || inquiry.journey)}
              onRefresh={inquiry.refresh}
              tintColor={colors.primary}
            />
          )}
        >
          {visibleMode === 'form' ? <InquiryForm center={inquiry.center} busy={inquiry.busy} onSubmit={submit} /> : null}
          {visibleMode === 'received' ? <InquiryReceived journey={inquiry.journey} onBook={() => setMode('booking')} onContact={contact} /> : null}
          {visibleMode === 'booking' ? <TourBooking journey={inquiry.journey} selected={selectedSlot} setSelected={setSelectedSlot} busy={inquiry.busy} onConfirm={book} onBack={() => setMode(null)} onContact={contact} /> : null}
          {visibleMode === 'booked' ? <TourBooked journey={inquiry.journey} busy={inquiry.busy} onCalendar={calendar} onDirections={directions} onReschedule={() => setMode('booking')} onCancel={cancelTour} onContact={contact} /> : null}
          {visibleMode === 'waitlist' ? <WaitlistPlace journey={inquiry.journey} onChangePlans={() => setMode('checkin-proactive')} onOffer={openOffer} /> : null}
          {visibleMode === 'checkin' || visibleMode === 'checkin-proactive' ? <WaitlistCheckin journey={inquiry.journey} busy={inquiry.busy} proactive={visibleMode === 'checkin-proactive'} onKeep={keepSpot} onRemove={removeSpot} onBack={() => setMode(null)} /> : null}
          {visibleMode === 'archived' ? <Archived journey={inquiry.journey} onContact={contact} onFinish={inquiry.finishJourney} /> : null}
          {visibleMode === 'closed' ? <ClosedInquiry journey={inquiry.journey} onContact={contact} onFinish={inquiry.finishJourney} /> : null}
          {visibleMode === 'enrolled' ? <EnrollmentComplete journey={inquiry.journey} onFinish={inquiry.finishJourney} /> : null}
          {!['archived', 'closed', 'enrolled'].includes(visibleMode) ? (
            <TouchableOpacity onPress={inquiry.finishJourney} style={styles.exitLink}><Text style={styles.exitText}>Close and return to DailyLog</Text></TouchableOpacity>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  flexOne: { flex: 1 },
  content: { paddingHorizontal: spacing.xxl, paddingTop: spacing.lg, paddingBottom: 48 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl, gap: spacing.md },
  loadingText: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 13 },
  centerIdentity: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.xl },
  centerMark: { width: 42, height: 42, borderRadius: radius.md, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  centerMarkText: { color: colors.primary, fontFamily: fonts.black, fontSize: 14 },
  centerName: { color: colors.textPrimary, fontFamily: fonts.black, fontSize: 14.5 },
  centerDetail: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 12, marginTop: 2 },
  eyebrow: { color: colors.primary, fontFamily: fonts.bold, fontSize: 11, letterSpacing: 1.1, marginBottom: spacing.sm },
  title: { color: colors.textPrimary, fontFamily: fonts.black, fontSize: 24, lineHeight: 30, marginBottom: spacing.sm },
  titleCentered: { color: colors.textPrimary, fontFamily: fonts.black, fontSize: 24, lineHeight: 30, textAlign: 'center' },
  subtitle: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 13.5, lineHeight: 21, marginBottom: spacing.xl },
  subtitleCentered: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 13.5, lineHeight: 21, textAlign: 'center' },
  fieldLabel: { color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 13.5, marginBottom: spacing.sm },
  fieldError: { color: colors.danger, fontFamily: fonts.regular, fontSize: 11.5, marginTop: -spacing.sm, marginBottom: spacing.md },
  fieldGroupError: { borderWidth: 1, borderColor: colors.danger, borderRadius: radius.md, padding: 4 },
  formError: { color: colors.danger, fontFamily: fonts.bold, fontSize: 12, marginBottom: spacing.md },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.lg },
  programChip: { borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.full, backgroundColor: colors.surface, paddingHorizontal: spacing.md, paddingVertical: 9 },
  dayChip: { flexGrow: 1, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.full, backgroundColor: colors.surface, paddingHorizontal: spacing.sm, paddingVertical: 9, alignItems: 'center' },
  programChipSelected: { borderColor: colors.primary, backgroundColor: colors.primary },
  programChipText: { color: colors.textMuted, fontFamily: fonts.bold, fontSize: 11.5 },
  programChipTextSelected: { color: colors.white },
  fullButton: { marginTop: spacing.sm },
  privacyNote: { color: colors.textFaint, fontFamily: fonts.regular, fontSize: 11, textAlign: 'center', lineHeight: 16, marginTop: spacing.md },
  progress: { flexDirection: 'row', marginVertical: spacing.xl },
  progressStep: { flex: 1, alignItems: 'center' },
  progressRail: { flexDirection: 'row', alignItems: 'center', width: '100%' },
  progressLine: { flex: 1, height: 2, backgroundColor: colors.border },
  progressLineDone: { backgroundColor: colors.success },
  progressLineClear: { backgroundColor: 'transparent' },
  progressDot: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.borderStrong, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  progressDotDone: { borderColor: colors.success, backgroundColor: colors.success },
  progressDotCurrent: { borderColor: colors.primary, backgroundColor: colors.primary, shadowColor: colors.primary, shadowOpacity: 0.25, shadowRadius: 5 },
  progressLabel: { color: colors.textFaint, fontFamily: fonts.regular, fontSize: 10, marginTop: 6 },
  progressLabelActive: { color: colors.textPrimary, fontFamily: fonts.bold },
  card: { backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.xl, padding: spacing.lg, marginBottom: spacing.lg },
  cardTitle: { color: colors.textPrimary, fontFamily: fonts.black, fontSize: 16, marginBottom: 4 },
  cardBody: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 12.5, lineHeight: 19 },
  infoCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.primaryLight, borderRadius: radius.lg, padding: spacing.md, marginVertical: spacing.md },
  infoText: { flex: 1, color: colors.textSecondary, fontFamily: fonts.regular, fontSize: 12, lineHeight: 18 },
  pageAction: { minHeight: 52, borderRadius: radius.md, backgroundColor: colors.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, marginTop: spacing.sm },
  pageActionSecondary: { backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border },
  pageActionText: { color: colors.white, fontFamily: fonts.bold, fontSize: 15.5, textAlign: 'center' },
  pageActionTextSecondary: { color: colors.primary, fontSize: 13.5 },
  disabled: { opacity: 0.55 },
  textLink: { alignSelf: 'center', padding: spacing.md },
  textLinkLabel: { color: colors.primary, fontFamily: fonts.bold, fontSize: 13 },
  textLinkLabelMuted: { color: colors.textMuted, fontFamily: fonts.bold, fontSize: 13.5 },
  destructiveLink: { color: colors.danger, fontFamily: fonts.bold, fontSize: 13.5 },
  bookingLinks: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  bookingLinkDivider: { width: 1, height: 18, backgroundColor: colors.border, marginHorizontal: spacing.xs },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.lg },
  back: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: colors.textPrimary, fontFamily: fonts.black, fontSize: 21 },
  listSection: { color: colors.textFaint, fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.8, marginTop: spacing.sm, marginBottom: spacing.sm },
  slotCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.sm },
  slotCardSelected: { borderWidth: 2, borderColor: colors.primary },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center' },
  radioSelected: { borderColor: colors.primary, backgroundColor: colors.primary },
  slotTime: { color: colors.textPrimary, fontFamily: fonts.black, fontSize: 14 },
  slotHost: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 11.5, marginTop: 3 },
  centered: { alignItems: 'center' },
  successIcon: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.successLight, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.lg },
  warmIcon: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.amberLight, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.lg },
  neutralIcon: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.lg },
  fullWidth: { width: '100%' },
  infoRow: { minHeight: 45, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  infoRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.borderSoft },
  infoLabel: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 12.5 },
  infoValue: { flex: 1, color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 12.5, textAlign: 'right' },
  twoActions: { width: '100%', flexDirection: 'row', gap: spacing.sm },
  halfAction: { flex: 1, minWidth: 0, paddingHorizontal: spacing.sm },
  flexOne: { flex: 1, minWidth: 0 },
  positionCard: { backgroundColor: colors.primary, borderRadius: radius.xl, padding: spacing.xl, alignItems: 'center', marginBottom: spacing.lg, shadowColor: colors.primary, shadowOpacity: 0.22, shadowRadius: 12, shadowOffset: { width: 0, height: 6 } },
  positionLabel: { color: '#DDEBFB', fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.8 },
  positionNumber: { color: colors.white, fontFamily: fonts.black, fontSize: 52, lineHeight: 58, marginTop: 4 },
  positionSub: { color: colors.white, fontFamily: fonts.bold, fontSize: 13 },
  estimatePill: { backgroundColor: 'rgba(255,255,255,.16)', borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, marginTop: spacing.md },
  estimateText: { color: colors.white, fontFamily: fonts.bold, fontSize: 12 },
  warmCard: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, backgroundColor: colors.amberLight, borderWidth: 1.5, borderColor: '#EFD9B5', borderRadius: radius.lg, padding: spacing.md },
  warmText: { flex: 1, color: '#8A6D3B', fontFamily: fonts.regular, fontSize: 12.5, lineHeight: 18 },
  placePill: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.primaryLight, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, marginVertical: spacing.lg },
  placeNumber: { color: colors.primary, fontFamily: fonts.black, fontSize: 16 },
  placeText: { color: colors.textSecondary, fontFamily: fonts.regular, fontSize: 12.5 },
  checkinNote: { color: colors.textFaint, fontFamily: fonts.regular, fontSize: 11.5, lineHeight: 17, textAlign: 'center', marginTop: spacing.lg },
  offerCard: { backgroundColor: colors.primary, borderRadius: radius.xl, padding: spacing.xl, alignItems: 'center', marginBottom: spacing.lg },
  offerTitle: { color: colors.white, fontFamily: fonts.black, fontSize: 21, marginTop: spacing.sm },
  offerBody: { color: '#DDEBFB', fontFamily: fonts.regular, fontSize: 12.5, marginTop: 4 },
  offerButton: { backgroundColor: colors.white, borderRadius: radius.md, paddingHorizontal: spacing.xl, paddingVertical: spacing.md, marginTop: spacing.lg },
  offerButtonText: { color: colors.primary, fontFamily: fonts.bold, fontSize: 14 },
  exitLink: { alignSelf: 'center', padding: spacing.lg, marginTop: spacing.xl },
  exitText: { color: colors.textFaint, fontFamily: fonts.regular, fontSize: 12 },
});
