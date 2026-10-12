import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, RefreshControl, ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import DateTimePicker from '@react-native-community/datetimepicker';
import { format, parseISO } from 'date-fns';

import { showToast } from '../../components/Toast';
import { supabase } from '../../lib/supabase';
import { colors, fonts, radius, spacing } from '../../theme';

const STAGE_LABELS = {
  inquiry: 'Inquiry', tour: 'Tour', application: 'Application', waitlist: 'Waitlist',
  offer: 'Offer', enrolled: 'Enrolled', closed: 'Closed',
};

const DOCUMENTS = [
  { key: 'immunization', label: 'Immunization record' },
  { key: 'emergency_contacts', label: 'Emergency contacts' },
  { key: 'medical', label: 'Allergy & medical form' },
  { key: 'handbook', label: 'Signed parent handbook' },
];

const TOUR_OUTCOMES = [
  { key: 'attended', label: 'Attended', icon: 'checkmark-circle-outline' },
  { key: 'no_show', label: 'No-show', icon: 'alert-circle-outline' },
  { key: 'rescheduled', label: 'Reschedule', icon: 'calendar-outline' },
];

function dateLabel(value, includeTime = false) {
  if (!value) return 'Not provided';
  const date = parseISO(value);
  return Number.isNaN(date.getTime()) ? value : format(date, includeTime ? 'MMM d, yyyy · h:mm a' : 'MMM d, yyyy');
}

function childName(row) {
  return [row.child_first_name, row.child_last_name].filter(Boolean).join(' ') || 'Child name pending';
}

function money(cents = 0) {
  return (Number(cents) / 100).toLocaleString('en-CA', { style: 'currency', currency: 'CAD' });
}

function dollarsToCents(value) {
  const normalized = String(value || '').replace(/[$,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  const [dollars, cents = ''] = normalized.split('.');
  return Number(dollars) * 100 + Number(cents.padEnd(2, '0'));
}

function safeDate(value) {
  const date = value ? parseISO(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function documentRows(value) {
  const statuses = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return DOCUMENTS.map(document => {
    const raw = statuses[document.key];
    const detail = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    return {
      ...document,
      status: typeof raw === 'string' ? raw : detail.status || 'missing',
      receivedAt: detail.received_at || null,
    };
  });
}

function jsonObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function Sheet({ visible, title, subtitle, busy, onClose, children }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={() => !busy && onClose()}>
      <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.modalCard}>
          <View style={styles.modalHandle} />
          <View style={styles.modalHeader}>
            <View style={styles.flex}><Text style={styles.modalTitle}>{title}</Text><Text style={styles.modalSubtitle}>{subtitle}</Text></View>
            <TouchableOpacity onPress={onClose} disabled={busy} style={styles.modalClose} accessibilityLabel={`Close ${title}`}><Ionicons name="close" size={20} color={colors.textPrimary} /></TouchableOpacity>
          </View>
          {children}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function TourBookingSheet({ visible, child, slots, selectedSlotId, busy, onSelect, onClose, onSubmit }) {
  return (
    <Sheet visible={visible} title="Schedule a tour" subtitle={`Choose an available visit for ${child}.`} busy={busy} onClose={onClose}>
      <ScrollView style={styles.sheetScroll} contentContainerStyle={styles.sheetList}>
        {slots.map(slot => {
          const selected = slot.id === selectedSlotId;
          return (
            <TouchableOpacity key={slot.id} onPress={() => onSelect(slot.id)} style={[styles.choiceCard, selected && styles.choiceCardActive]} accessibilityRole="radio" accessibilityState={{ checked: selected }}>
              <View style={[styles.radio, selected && styles.radioActive]}>{selected ? <View style={styles.radioDot} /> : null}</View>
              <View style={styles.flex}><Text style={styles.choiceTitle}>{dateLabel(slot.starts_at, true)}</Text><Text style={styles.choiceMeta}>45-minute center visit{slot.classroom_id ? ' · room-specific' : ''}</Text></View>
            </TouchableOpacity>
          );
        })}
        {!slots.length ? <View style={styles.sheetEmpty}><Text style={styles.emptyTitle}>No open tour times</Text><Text style={styles.emptyText}>Create tour availability from the admin web calendar, then return here to book it.</Text></View> : null}
      </ScrollView>
      <View style={styles.modalActions}>
        <TouchableOpacity onPress={onClose} disabled={busy} style={styles.secondaryButton}><Text style={styles.secondaryText}>Cancel</Text></TouchableOpacity>
        <TouchableOpacity onPress={onSubmit} disabled={busy || !selectedSlotId} style={[styles.primaryButton, (busy || !selectedSlotId) && styles.disabledButton]}>{busy ? <ActivityIndicator color={colors.white} /> : <Text style={styles.primaryText}>Book tour</Text>}</TouchableOpacity>
      </View>
    </Sheet>
  );
}

function DocumentRequestSheet({ visible, child, documents, canRequestHandbook, selectedKeys, message, busy, onToggle, onMessage, onClose, onSubmit }) {
  const missing = documents.filter(document => document.status !== 'received' && (document.key !== 'handbook' || canRequestHandbook));
  return (
    <Sheet visible={visible} title="Request documents" subtitle={`Ask ${child}'s family for missing forms.`} busy={busy} onClose={onClose}>
      <ScrollView style={styles.sheetScroll} contentContainerStyle={styles.sheetList} keyboardShouldPersistTaps="handled">
        {missing.map(document => {
          const selected = selectedKeys.includes(document.key);
          return (
            <TouchableOpacity key={document.key} onPress={() => onToggle(document.key)} style={[styles.choiceCard, selected && styles.choiceCardActive]} accessibilityRole="checkbox" accessibilityState={{ checked: selected }}>
              <Ionicons name={selected ? 'checkbox' : 'square-outline'} size={22} color={selected ? colors.primary : colors.textFaint} />
              <View style={styles.flex}><Text style={styles.choiceTitle}>{document.label}</Text><Text style={styles.choiceMeta}>{document.status === 'requested' ? 'Already requested · send a follow-up' : 'Missing from the application'}</Text></View>
            </TouchableOpacity>
          );
        })}
        {!missing.length ? <View style={styles.sheetEmpty}><Text style={styles.emptyTitle}>Documents complete</Text><Text style={styles.emptyText}>All requestable application documents have been received.</Text></View> : null}
        <Text style={styles.fieldLabel}>Message to family *</Text>
        <TextInput value={message} onChangeText={onMessage} multiline maxLength={2000} style={styles.messageInput} placeholder="Explain what is needed and when." placeholderTextColor={colors.textFaint} textAlignVertical="top" />
      </ScrollView>
      <View style={styles.modalActions}>
        <TouchableOpacity onPress={onClose} disabled={busy} style={styles.secondaryButton}><Text style={styles.secondaryText}>Cancel</Text></TouchableOpacity>
        <TouchableOpacity onPress={onSubmit} disabled={busy || !selectedKeys.length || !message.trim()} style={[styles.primaryButton, (busy || !selectedKeys.length || !message.trim()) && styles.disabledButton]}>{busy ? <ActivityIndicator color={colors.white} /> : <Text style={styles.primaryText}>Send request</Text>}</TouchableOpacity>
      </View>
    </Sheet>
  );
}

function TourOutcomeSheet({ visible, child, outcome, notes, sendApplication, busy, onOutcome, onNotes, onSendApplication, onClose, onSubmit }) {
  return (
    <Sheet visible={visible} title="Record tour outcome" subtitle={`Complete the visit follow-up for ${child}.`} busy={busy} onClose={onClose}>
      <View style={styles.outcomeGrid}>
        {TOUR_OUTCOMES.map(option => (
          <TouchableOpacity key={option.key} onPress={() => onOutcome(option.key)} style={[styles.outcomeChoice, outcome === option.key && styles.choiceCardActive]} accessibilityRole="radio" accessibilityState={{ checked: outcome === option.key }}>
            <Ionicons name={option.icon} size={22} color={outcome === option.key ? colors.primary : colors.textMuted} /><Text style={[styles.outcomeText, outcome === option.key && styles.outcomeTextActive]}>{option.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <Text style={styles.fieldLabel}>Visit notes</Text>
      <TextInput value={notes} onChangeText={onNotes} multiline maxLength={2000} style={styles.messageInput} placeholder="What did the family ask about?" placeholderTextColor={colors.textFaint} textAlignVertical="top" />
      {outcome === 'attended' ? <TouchableOpacity onPress={() => onSendApplication(!sendApplication)} style={styles.checkboxRow} accessibilityRole="checkbox" accessibilityState={{ checked: sendApplication }}><Ionicons name={sendApplication ? 'checkbox' : 'square-outline'} size={22} color={sendApplication ? colors.primary : colors.textFaint} /><Text style={styles.checkboxText}>Send the family their application link now</Text></TouchableOpacity> : null}
      <View style={styles.modalActions}>
        <TouchableOpacity onPress={onClose} disabled={busy} style={styles.secondaryButton}><Text style={styles.secondaryText}>Cancel</Text></TouchableOpacity>
        <TouchableOpacity onPress={onSubmit} disabled={busy || !outcome} style={[styles.primaryButton, (busy || !outcome) && styles.disabledButton]}>{busy ? <ActivityIndicator color={colors.white} /> : <Text style={styles.primaryText}>Save outcome</Text>}</TouchableOpacity>
      </View>
    </Sheet>
  );
}

function RoomChoices({ rooms, selectedId, error, onSelect }) {
  return (
    <>
      <Text style={styles.fieldLabel}>Program *</Text>
      <View style={[styles.roomGrid, error && styles.fieldGroupError]}>
        {rooms.map(room => {
          const selected = room.id === selectedId;
          return <TouchableOpacity key={room.id} onPress={() => onSelect(room.id)} style={[styles.roomChoice, selected && styles.choiceCardActive]} accessibilityRole="radio" accessibilityState={{ checked: selected }}><Text style={[styles.roomChoiceText, selected && styles.outcomeTextActive]}>{room.name}</Text><Text style={styles.roomChoiceMeta}>{room.capacity ? `Capacity ${room.capacity}` : 'Capacity set by center'}</Text></TouchableOpacity>;
        })}
      </View>
      {error ? <Text style={styles.fieldError}>{error}</Text> : null}
    </>
  );
}

function OfferSheet({ visible, child, rooms, form, errors, busy, onChange, onClose, onSubmit }) {
  return (
    <Sheet visible={visible} title="Send an enrollment offer" subtitle={`Confirm the terms being offered to ${child}'s family.`} busy={busy} onClose={onClose}>
      <ScrollView style={styles.sheetScroll} contentContainerStyle={styles.sheetList} keyboardShouldPersistTaps="handled">
        <RoomChoices rooms={rooms} selectedId={form.classroomId} error={errors.classroomId} onSelect={value => onChange('classroomId', value)} />
        <Text style={styles.fieldLabel}>First day *</Text>
        <View style={[styles.dateField, errors.startOn && styles.inputError]}><DateTimePicker value={safeDate(form.startOn)} mode="date" minimumDate={new Date()} display={Platform.OS === 'ios' ? 'compact' : 'default'} onChange={(_event, value) => value && onChange('startOn', format(value, 'yyyy-MM-dd'))} /><Text style={styles.dateValue}>{form.startOn ? dateLabel(form.startOn) : 'Choose a date'}</Text></View>
        {errors.startOn ? <Text style={styles.fieldError}>{errors.startOn}</Text> : null}
        <View style={styles.twoColumns}>
          <View style={styles.flex}><Text style={styles.fieldLabel}>Tuition / month *</Text><View style={[styles.moneyField, errors.tuition && styles.inputError]}><Text style={styles.currency}>$</Text><TextInput value={form.tuition} onChangeText={value => onChange('tuition', value)} keyboardType="decimal-pad" textContentType="none" autoComplete="off" style={styles.moneyInput} placeholder="1180" placeholderTextColor={colors.textFaint} /></View>{errors.tuition ? <Text style={styles.fieldError}>{errors.tuition}</Text> : null}</View>
          <View style={styles.flex}><Text style={styles.fieldLabel}>Deposit *</Text><View style={[styles.moneyField, errors.deposit && styles.inputError]}><Text style={styles.currency}>$</Text><TextInput value={form.deposit} onChangeText={value => onChange('deposit', value)} keyboardType="decimal-pad" textContentType="none" autoComplete="off" style={styles.moneyInput} placeholder="500" placeholderTextColor={colors.textFaint} /></View>{errors.deposit ? <Text style={styles.fieldError}>{errors.deposit}</Text> : null}</View>
        </View>
        <Text style={styles.fieldLabel}>Family response window *</Text>
        <View style={styles.windowChoices}>{[48, 168, 336].map(hours => <TouchableOpacity key={hours} onPress={() => onChange('windowHours', hours)} style={[styles.windowChoice, form.windowHours === hours && styles.choiceCardActive]} accessibilityRole="radio" accessibilityState={{ checked: form.windowHours === hours }}><Text style={[styles.windowText, form.windowHours === hours && styles.outcomeTextActive]}>{hours === 48 ? '48 hours' : hours === 168 ? '1 week' : '2 weeks'}</Text></TouchableOpacity>)}</View>
        <View style={styles.guardNotice}><Ionicons name="shield-checkmark-outline" size={19} color={colors.success} /><Text style={styles.guardNoticeText}>Capacity, age fit, center closures, and this first day are checked again when the offer is sent.</Text></View>
      </ScrollView>
      <View style={styles.modalActions}><TouchableOpacity onPress={onClose} disabled={busy} style={styles.secondaryButton}><Text style={styles.secondaryText}>Cancel</Text></TouchableOpacity><TouchableOpacity onPress={onSubmit} disabled={busy} style={[styles.primaryButton, busy && styles.disabledButton]}>{busy ? <ActivityIndicator color={colors.white} /> : <Text style={styles.primaryText}>Send offer</Text>}</TouchableOpacity></View>
    </Sheet>
  );
}

function WaitlistSheet({ visible, child, rooms, form, errors, busy, onChange, onClose, onSubmit }) {
  return (
    <Sheet visible={visible} title="Add to waitlist" subtitle={`Keep ${child}'s requested start and program together.`} busy={busy} onClose={onClose}>
      <ScrollView style={styles.sheetScroll} contentContainerStyle={styles.sheetList}>
        <RoomChoices rooms={rooms} selectedId={form.classroomId} error={errors.classroomId} onSelect={value => onChange('classroomId', value)} />
        <Text style={styles.fieldLabel}>Desired start *</Text>
        <View style={[styles.dateField, errors.startOn && styles.inputError]}><DateTimePicker value={safeDate(form.startOn)} mode="date" display={Platform.OS === 'ios' ? 'compact' : 'default'} onChange={(_event, value) => value && onChange('startOn', format(value, 'yyyy-MM-dd'))} /><Text style={styles.dateValue}>{form.startOn ? dateLabel(form.startOn) : 'Choose a date'}</Text></View>
        {errors.startOn ? <Text style={styles.fieldError}>{errors.startOn}</Text> : null}
        <TouchableOpacity onPress={() => onChange('siblingPriority', !form.siblingPriority)} style={styles.checkboxRow} accessibilityRole="checkbox" accessibilityState={{ checked: form.siblingPriority }}><Ionicons name={form.siblingPriority ? 'checkbox' : 'square-outline'} size={22} color={form.siblingPriority ? colors.primary : colors.textFaint} /><View style={styles.flex}><Text style={styles.checkboxTitle}>Sibling priority</Text><Text style={styles.checkboxText}>Apply the center's configured sibling ordering rule.</Text></View></TouchableOpacity>
      </ScrollView>
      <View style={styles.modalActions}><TouchableOpacity onPress={onClose} disabled={busy} style={styles.secondaryButton}><Text style={styles.secondaryText}>Cancel</Text></TouchableOpacity><TouchableOpacity onPress={onSubmit} disabled={busy} style={[styles.primaryButton, busy && styles.disabledButton]}>{busy ? <ActivityIndicator color={colors.white} /> : <Text style={styles.primaryText}>Add to waitlist</Text>}</TouchableOpacity></View>
    </Sheet>
  );
}

function CompleteEnrollmentSheet({ visible, child, lastName, error, busy, onLastName, onClose, onSubmit }) {
  return (
    <Sheet visible={visible} title="Complete enrollment" subtitle={`Create ${child}'s center record from the accepted offer.`} busy={busy} onClose={onClose}>
      <View style={styles.guardNotice}><Ionicons name="git-merge-outline" size={19} color={colors.primary} /><Text style={styles.guardNoticeText}>The accepted room, family link, billing handoff, and child record are created together. This cannot run until the offer is accepted.</Text></View>
      <Text style={styles.fieldLabel}>Child's last name *</Text>
      <TextInput value={lastName} onChangeText={onLastName} autoCapitalize="words" style={[styles.textField, error && styles.inputError]} placeholder="Last name" placeholderTextColor={colors.textFaint} />
      {error ? <Text style={styles.fieldError}>{error}</Text> : null}
      <View style={styles.modalActions}><TouchableOpacity onPress={onClose} disabled={busy} style={styles.secondaryButton}><Text style={styles.secondaryText}>Cancel</Text></TouchableOpacity><TouchableOpacity onPress={onSubmit} disabled={busy} style={[styles.primaryButton, busy && styles.disabledButton]}>{busy ? <ActivityIndicator color={colors.white} /> : <Text style={styles.primaryText}>Create child record</Text>}</TouchableOpacity></View>
    </Sheet>
  );
}

function WithdrawOfferSheet({ visible, child, reason, keepOnWaitlist, error, busy, onReason, onKeep, onClose, onSubmit }) {
  return (
    <Sheet visible={visible} title="Withdraw offer" subtitle={`End ${child}'s current offer with a clear family record.`} busy={busy} onClose={onClose}>
      <View style={styles.dangerNotice}><Ionicons name="alert-circle-outline" size={19} color={colors.danger} /><Text style={styles.guardNoticeText}>The held spot is released immediately. The next family is never offered the spot without administrator review.</Text></View>
      <Text style={styles.fieldLabel}>Reason *</Text>
      <TextInput value={reason} onChangeText={onReason} multiline maxLength={500} style={[styles.messageInput, error && styles.inputError]} placeholder="Explain why this offer is being withdrawn." placeholderTextColor={colors.textFaint} textAlignVertical="top" />
      {error ? <Text style={styles.fieldError}>{error}</Text> : null}
      <TouchableOpacity onPress={() => onKeep(!keepOnWaitlist)} style={styles.checkboxRow} accessibilityRole="checkbox" accessibilityState={{ checked: keepOnWaitlist }}><Ionicons name={keepOnWaitlist ? 'checkbox' : 'square-outline'} size={22} color={keepOnWaitlist ? colors.primary : colors.textFaint} /><View style={styles.flex}><Text style={styles.checkboxTitle}>Keep this family on the waitlist</Text><Text style={styles.checkboxText}>Preserve their requested program and start-date priority.</Text></View></TouchableOpacity>
      <View style={styles.modalActions}><TouchableOpacity onPress={onClose} disabled={busy} style={styles.secondaryButton}><Text style={styles.secondaryText}>Keep offer</Text></TouchableOpacity><TouchableOpacity onPress={onSubmit} disabled={busy} style={[styles.dangerButton, busy && styles.disabledButton]}>{busy ? <ActivityIndicator color={colors.white} /> : <Text style={styles.primaryText}>Withdraw offer</Text>}</TouchableOpacity></View>
    </Sheet>
  );
}

function OnboardingSheet({ visible, child, roomName, educators, form, errors, busy, onChange, onClose, onSubmit }) {
  return (
    <Sheet visible={visible} title="Complete room handoff" subtitle={`Prepare ${child}'s first day in ${roomName || 'their room'}.`} busy={busy} onClose={onClose}>
      <ScrollView style={styles.sheetScroll} contentContainerStyle={styles.sheetList} keyboardShouldPersistTaps="handled">
        <Text style={styles.fieldLabel}>Primary educator *</Text>
        <View style={[styles.educatorList, errors.educatorId && styles.fieldGroupError]}>
          {educators.map(educator => {
            const selected = educator.id === form.educatorId;
            return (
              <TouchableOpacity key={educator.id} onPress={() => onChange('educatorId', educator.id)} style={[styles.choiceCard, selected && styles.choiceCardActive]} accessibilityRole="radio" accessibilityState={{ checked: selected }}>
                <View style={[styles.educatorAvatar, selected && styles.educatorAvatarActive]}><Text style={[styles.educatorInitials, selected && styles.educatorInitialsActive]}>{educator.full_name?.split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase() || 'ED'}</Text></View>
                <View style={styles.flex}><Text style={styles.choiceTitle}>{educator.full_name}</Text><Text style={styles.choiceMeta}>Assigned to {roomName || 'this room'}</Text></View>
                {selected ? <Ionicons name="checkmark-circle" size={21} color={colors.primary} /> : null}
              </TouchableOpacity>
            );
          })}
          {!educators.length ? <View style={styles.sheetEmpty}><Text style={styles.emptyTitle}>No room educator available</Text><Text style={styles.emptyText}>Assign an active educator to {roomName || 'this room'} from Staff before completing this handoff.</Text></View> : null}
        </View>
        {errors.educatorId ? <Text style={styles.fieldError}>{errors.educatorId}</Text> : null}

        <Text style={styles.fieldLabel}>Cubby label *</Text>
        <TextInput value={form.cubbyLabel} onChangeText={value => onChange('cubbyLabel', value)} maxLength={30} autoCapitalize="characters" style={[styles.textField, errors.cubbyLabel && styles.inputError]} placeholder="e.g. C-12" placeholderTextColor={colors.textFaint} />
        {errors.cubbyLabel ? <Text style={styles.fieldError}>{errors.cubbyLabel}</Text> : null}

        <TouchableOpacity onPress={() => onChange('sendWelcome', !form.sendWelcome)} style={styles.checkboxRow} accessibilityRole="checkbox" accessibilityState={{ checked: form.sendWelcome }}>
          <Ionicons name={form.sendWelcome ? 'checkbox' : 'square-outline'} size={22} color={form.sendWelcome ? colors.primary : colors.textFaint} />
          <View style={styles.flex}><Text style={styles.checkboxTitle}>Schedule the family welcome</Text><Text style={styles.checkboxText}>Send it three days before the first day, or now if that date has passed.</Text></View>
        </TouchableOpacity>
        <View style={styles.guardNotice}><Ionicons name="shield-checkmark-outline" size={19} color={colors.primary} /><Text style={styles.guardNoticeText}>The room, educator, cubby, and welcome are saved together. Educator roster and attendance access still begin on the agreed first day.</Text></View>
      </ScrollView>
      <View style={styles.modalActions}><TouchableOpacity onPress={onClose} disabled={busy} style={styles.secondaryButton}><Text style={styles.secondaryText}>Cancel</Text></TouchableOpacity><TouchableOpacity onPress={onSubmit} disabled={busy || !educators.length} style={[styles.primaryButton, (busy || !educators.length) && styles.disabledButton]}>{busy ? <ActivityIndicator color={colors.white} /> : <Text style={styles.primaryText}>Save handoff</Text>}</TouchableOpacity></View>
    </Sheet>
  );
}

function InfoRow({ label, value, last }) {
  return (
    <View style={[styles.infoRow, !last && styles.infoRowBorder]}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value || 'Not provided'}</Text>
    </View>
  );
}

function ReadinessRow({ complete, number, title, detail, last }) {
  return (
    <View style={[styles.readinessRow, !last && styles.infoRowBorder]}>
      <View style={[styles.readinessMarker, complete && styles.readinessMarkerComplete]}>
        {complete ? <Ionicons name="checkmark" size={14} color={colors.white} /> : <Text style={styles.readinessNumber}>{number}</Text>}
      </View>
      <View style={styles.flex}><Text style={styles.readinessTitle}>{title}</Text><Text style={styles.readinessDetail}>{detail}</Text></View>
    </View>
  );
}

function ApplicationCard({ enrollment, focused, onPress }) {
  const progress = Math.max(0, Math.min(100, Number(enrollment.application_progress || 0)));
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.applicationCard, focused && styles.applicationFocused]}
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityLabel={`Review application for ${childName(enrollment)}`}
    >
      <View style={styles.avatar}><Text style={styles.avatarText}>{enrollment.child_first_name?.[0]?.toUpperCase() || '?'}</Text></View>
      <View style={styles.flex}>
        <View style={styles.applicationTop}>
          <Text style={styles.childName}>{childName(enrollment)}</Text>
          <View style={styles.stageBadge}><Text style={styles.stageText}>{STAGE_LABELS[enrollment.stage] || enrollment.stage}</Text></View>
        </View>
        <Text style={styles.guardian}>{enrollment.guardian_name || enrollment.guardian_email || 'Family contact pending'}</Text>
        <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${progress}%` }]} /></View>
        <Text style={styles.progressText}>{progress}% of application complete</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
    </TouchableOpacity>
  );
}

export default function AdminEnrollmentReviewScreen({ navigation, route }) {
  const [enrollments, setEnrollments] = useState([]);
  const [selectedId, setSelectedId] = useState(route.params?.enrollmentId || null);
  const [fit, setFit] = useState(null);
  const [tourSlots, setTourSlots] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [educators, setEducators] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const [selectedSlotId, setSelectedSlotId] = useState(null);
  const [documentsOpen, setDocumentsOpen] = useState(false);
  const [selectedDocuments, setSelectedDocuments] = useState([]);
  const [documentMessage, setDocumentMessage] = useState('');
  const [outcomeOpen, setOutcomeOpen] = useState(false);
  const [tourOutcome, setTourOutcome] = useState('');
  const [tourNotes, setTourNotes] = useState('');
  const [sendApplication, setSendApplication] = useState(true);
  const [offerOpen, setOfferOpen] = useState(false);
  const [offerForm, setOfferForm] = useState({ classroomId: '', startOn: '', tuition: '1180.00', deposit: '500.00', windowHours: 48 });
  const [offerErrors, setOfferErrors] = useState({});
  const [waitlistOpen, setWaitlistOpen] = useState(false);
  const [waitlistForm, setWaitlistForm] = useState({ classroomId: '', startOn: '', siblingPriority: false });
  const [waitlistErrors, setWaitlistErrors] = useState({});
  const [completeOpen, setCompleteOpen] = useState(false);
  const [lastName, setLastName] = useState('');
  const [lastNameError, setLastNameError] = useState('');
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [withdrawReason, setWithdrawReason] = useState('');
  const [keepOnWaitlist, setKeepOnWaitlist] = useState(true);
  const [withdrawError, setWithdrawError] = useState('');
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [onboardingForm, setOnboardingForm] = useState({ educatorId: '', cubbyLabel: '', sendWelcome: true });
  const [onboardingErrors, setOnboardingErrors] = useState({});

  const load = useCallback(async ({ refresh = false } = {}) => {
    refresh ? setRefreshing(true) : setLoading(true);
    setError('');
    const [result, slotsResult, roomsResult, educatorsResult, assignmentsResult] = await Promise.all([
      supabase.from('enrollments').select('*').order('created_at', { ascending: false }).limit(60),
      supabase.from('enrollment_tour_slots').select('*').eq('status', 'open').gte('starts_at', new Date().toISOString()).order('starts_at').limit(30),
      supabase.from('classrooms').select('id, name, capacity, archived_at').is('archived_at', null).order('name'),
      supabase.from('profiles').select('id, full_name, classroom_id, role, archived_at').eq('role', 'educator').is('archived_at', null).order('full_name'),
      supabase.from('educator_classrooms').select('educator_id, classroom_id'),
    ]);
    setEnrollments(result.data || []);
    setTourSlots(slotsResult.data || []);
    setRooms(roomsResult.data || []);
    const assignments = assignmentsResult.data || [];
    setEducators((educatorsResult.data || []).map(educator => ({
      ...educator,
      classroomIds: Array.from(new Set([educator.classroom_id, ...assignments.filter(item => item.educator_id === educator.id).map(item => item.classroom_id)].filter(Boolean))),
    })));
    setError(result.error?.message || slotsResult.error?.message || roomsResult.error?.message || educatorsResult.error?.message || assignmentsResult.error?.message || '');
    const focusId = route.params?.enrollmentId || selectedId;
    if (focusId) {
      const fitResult = await supabase.rpc('get_enrollment_fit_check', { p_enrollment_id: focusId });
      setFit(Array.isArray(fitResult.data) ? fitResult.data[0] : fitResult.data);
    }
    setLoading(false);
    setRefreshing(false);
  }, [route.params?.enrollmentId, selectedId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const selected = useMemo(
    () => enrollments.find(row => row.id === (route.params?.enrollmentId || selectedId)) || null,
    [enrollments, route.params?.enrollmentId, selectedId],
  );

  function select(row) {
    setSelectedId(row.id);
    navigation.setParams({ enrollmentId: row.id });
  }

  const documents = useMemo(() => documentRows(selected?.documents_status), [selected?.documents_status]);
  const missingDocuments = documents.filter(document => document.status !== 'received' && (document.key !== 'handbook' || Boolean(selected?.child_id)));
  const onboardingSteps = jsonObject(selected?.onboarding_steps);
  const roomSchedule = jsonObject(onboardingSteps.room_schedule);
  const selectedRoom = rooms.find(room => room.id === selected?.classroom_id);
  const eligibleEducators = educators.filter(educator => educator.classroomIds.includes(selected?.classroom_id));
  const onboardingEducatorId = String(roomSchedule.primary_educator_id || onboardingSteps.primary_educator_id || '');
  const onboardingEducatorName = String(roomSchedule.primary_educator_name || onboardingSteps.primary_educator_name || '');
  const onboardingCubby = String(roomSchedule.cubby_label || onboardingSteps.cubby_label || '');
  const onboardingReady = Boolean(onboardingEducatorId && onboardingCubby);
  const offerAccepted = selected?.offer_status === 'accepted' || selected?.stage === 'enrolled';
  const depositPaid = Number(selected?.offer_deposit_cents || 0) === 0 || selected?.deposit_status === 'paid';
  const paperworkReady = documents.every(document => document.status === 'received');
  const firstDayStarted = Boolean(selected?.stage === 'enrolled' && selected?.child_id && selected?.desired_start_date && selected.desired_start_date <= format(new Date(), 'yyyy-MM-dd'));

  function setOnboardingValue(key, value) {
    setOnboardingForm(current => ({ ...current, [key]: value }));
    setOnboardingErrors(current => ({ ...current, [key]: '' }));
  }

  function openOnboarding() {
    setOnboardingForm({ educatorId: onboardingEducatorId, cubbyLabel: onboardingCubby, sendWelcome: true });
    setOnboardingErrors({});
    setOnboardingOpen(true);
  }

  function saveOnboarding() {
    if (!selected) return;
    const next = {};
    if (!onboardingForm.educatorId) next.educatorId = 'Choose the primary educator.';
    if (!onboardingForm.cubbyLabel.trim()) next.cubbyLabel = 'Enter the cubby label.';
    setOnboardingErrors(next);
    if (Object.keys(next).length) return;
    const educator = eligibleEducators.find(item => item.id === onboardingForm.educatorId);
    Alert.alert('Save this room handoff?', `${educator?.full_name || 'The selected educator'} will be ${childName(selected)}'s primary educator, and cubby ${onboardingForm.cubbyLabel.trim()} will be reserved.`, [
      { text: 'Review again', style: 'cancel' },
      { text: 'Save handoff', onPress: async () => {
        setBusy(true);
        const { error: actionError } = await supabase.rpc('save_enrollment_onboarding', { p_enrollment_id: selected.id, p_primary_educator_id: onboardingForm.educatorId, p_cubby_label: onboardingForm.cubbyLabel.trim(), p_send_welcome: onboardingForm.sendWelcome });
        setBusy(false);
        if (actionError) return Alert.alert('Could not save room handoff', actionError.message);
        setOnboardingOpen(false);
        showToast('Room handoff saved', 'success');
        await load({ refresh: true });
      } },
    ]);
  }

  function openDocuments() {
    const initial = missingDocuments.find(document => document.status !== 'requested') || missingDocuments[0];
    setSelectedDocuments(initial ? [initial.key] : []);
    setDocumentMessage(`Hi ${selected?.guardian_name?.split(' ')[0] || 'there'} — please upload the missing form for ${selected?.child_first_name || 'your child'} from your application. Thank you!`);
    setDocumentsOpen(true);
  }

  function toggleDocument(key) {
    setSelectedDocuments(current => current.includes(key) ? current.filter(item => item !== key) : [...current, key]);
  }

  function openTourOutcome() {
    setTourOutcome('');
    setTourNotes(selected?.tour_notes || '');
    setSendApplication(true);
    setOutcomeOpen(true);
  }

  async function bookTour() {
    const slot = tourSlots.find(item => item.id === selectedSlotId);
    if (!selected || !slot) return;
    Alert.alert('Book this tour?', `${dateLabel(slot.starts_at, true)} for ${childName(selected)}. The family will receive the scheduled visit details.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Book tour', onPress: async () => {
        setBusy(true);
        const { error: actionError } = await supabase.rpc('book_admin_enrollment_tour', { p_enrollment_id: selected.id, p_slot_id: slot.id });
        setBusy(false);
        if (actionError) return Alert.alert('Could not book tour', actionError.message);
        setTourOpen(false);
        setSelectedSlotId(null);
        showToast('Tour booked', 'success');
        await load({ refresh: true });
      } },
    ]);
  }

  async function requestDocuments() {
    if (!selected || !selectedDocuments.length || !documentMessage.trim()) return;
    Alert.alert('Send document request?', `Request ${selectedDocuments.length} document${selectedDocuments.length === 1 ? '' : 's'} from ${selected.guardian_name || 'this family'}.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Send request', onPress: async () => {
        setBusy(true);
        const { error: actionError } = await supabase.rpc('request_enrollment_documents', { p_enrollment_id: selected.id, p_documents: selectedDocuments, p_message: documentMessage.trim() });
        setBusy(false);
        if (actionError) return Alert.alert('Could not request documents', actionError.message);
        setDocumentsOpen(false);
        showToast('Document request sent', 'success');
        await load({ refresh: true });
      } },
    ]);
  }

  async function saveTourOutcome() {
    if (!selected || !tourOutcome) return;
    Alert.alert('Save tour outcome?', `${TOUR_OUTCOMES.find(item => item.key === tourOutcome)?.label} will be recorded for ${childName(selected)}.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Save outcome', onPress: async () => {
        setBusy(true);
        const { error: actionError } = await supabase.rpc('record_admin_enrollment_tour_outcome', { p_enrollment_id: selected.id, p_outcome: tourOutcome, p_notes: tourNotes.trim() || undefined, p_send_application: tourOutcome === 'attended' && sendApplication });
        setBusy(false);
        if (actionError) return Alert.alert('Could not save outcome', actionError.message);
        setOutcomeOpen(false);
        showToast('Tour outcome saved', 'success');
        await load({ refresh: true });
      } },
    ]);
  }

  function cancelTour() {
    if (!selected?.tour_at) return;
    Alert.alert('Cancel this tour?', `The scheduled visit on ${dateLabel(selected.tour_at, true)} will be cancelled and the family notified.`, [
      { text: 'Keep tour', style: 'cancel' },
      { text: 'Cancel tour', style: 'destructive', onPress: async () => {
        setBusy(true);
        const { error: actionError } = await supabase.rpc('cancel_admin_enrollment_tour', { p_enrollment_id: selected.id });
        setBusy(false);
        if (actionError) return Alert.alert('Could not cancel tour', actionError.message);
        showToast('Tour cancelled', 'success');
        await load({ refresh: true });
      } },
    ]);
  }

  function setOfferValue(key, value) {
    setOfferForm(current => ({ ...current, [key]: value }));
    setOfferErrors(current => ({ ...current, [key]: '' }));
  }

  function openOffer() {
    setOfferForm({
      classroomId: selected?.classroom_id || rooms[0]?.id || '',
      startOn: selected?.desired_start_date && selected.desired_start_date >= format(new Date(), 'yyyy-MM-dd') ? selected.desired_start_date : format(new Date(Date.now() + 86400000), 'yyyy-MM-dd'),
      tuition: ((selected?.offer_tuition_cents || 118000) / 100).toFixed(2),
      deposit: ((selected?.offer_deposit_cents || 50000) / 100).toFixed(2),
      windowHours: 48,
    });
    setOfferErrors({});
    setOfferOpen(true);
  }

  function setWaitlistValue(key, value) {
    setWaitlistForm(current => ({ ...current, [key]: value }));
    setWaitlistErrors(current => ({ ...current, [key]: '' }));
  }

  function openWaitlist() {
    setWaitlistForm({ classroomId: selected?.classroom_id || rooms[0]?.id || '', startOn: selected?.desired_start_date || format(new Date(), 'yyyy-MM-dd'), siblingPriority: selected?.waitlist_priority === 'sibling' });
    setWaitlistErrors({});
    setWaitlistOpen(true);
  }

  function validateOffer() {
    const next = {};
    const tuitionCents = dollarsToCents(offerForm.tuition);
    const depositCents = dollarsToCents(offerForm.deposit);
    if (!offerForm.classroomId) next.classroomId = 'Choose a program.';
    if (!offerForm.startOn) next.startOn = 'Choose the first day.';
    else if (offerForm.startOn < format(new Date(), 'yyyy-MM-dd')) next.startOn = 'The first day cannot be in the past.';
    if (tuitionCents === null) next.tuition = 'Enter a valid monthly amount.';
    if (depositCents === null) next.deposit = 'Enter a valid deposit.';
    setOfferErrors(next);
    return { valid: !Object.keys(next).length, tuitionCents, depositCents };
  }

  function sendOffer() {
    if (!selected) return;
    const { valid, tuitionCents, depositCents } = validateOffer();
    if (!valid) return;
    const room = rooms.find(item => item.id === offerForm.classroomId);
    Alert.alert('Send this offer?', `${room?.name || 'Program'} · ${dateLabel(offerForm.startOn)} · ${money(tuitionCents)} per month. The family will have ${offerForm.windowHours === 48 ? '48 hours' : `${offerForm.windowHours / 24} days`} to respond.`, [
      { text: 'Review again', style: 'cancel' },
      { text: 'Send offer', onPress: async () => {
        setBusy(true);
        const { error: actionError } = await supabase.rpc('send_reviewed_enrollment_offer', { p_enrollment_id: selected.id, p_classroom_id: offerForm.classroomId, p_start_on: offerForm.startOn, p_window_hours: offerForm.windowHours, p_tuition_cents: tuitionCents, p_deposit_cents: depositCents });
        setBusy(false);
        if (actionError) return Alert.alert('Could not send offer', actionError.message);
        setOfferOpen(false);
        showToast('Enrollment offer sent', 'success');
        await load({ refresh: true });
      } },
    ]);
  }

  function addToWaitlist() {
    if (!selected) return;
    const next = {};
    if (!waitlistForm.classroomId) next.classroomId = 'Choose a program.';
    if (!waitlistForm.startOn) next.startOn = 'Choose the desired start date.';
    setWaitlistErrors(next);
    if (Object.keys(next).length) return;
    const room = rooms.find(item => item.id === waitlistForm.classroomId);
    Alert.alert('Add to waitlist?', `${childName(selected)} will join ${room?.name || 'the selected program'} for a ${dateLabel(waitlistForm.startOn)} start.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Add to waitlist', onPress: async () => {
        setBusy(true);
        const { error: actionError } = await supabase.rpc('add_enrollment_to_waitlist', { p_enrollment_id: selected.id, p_classroom_id: waitlistForm.classroomId, p_desired_start: waitlistForm.startOn, p_sibling_priority: waitlistForm.siblingPriority });
        setBusy(false);
        if (actionError) return Alert.alert('Could not add to waitlist', actionError.message);
        setWaitlistOpen(false);
        showToast('Added to waitlist', 'success');
        await load({ refresh: true });
      } },
    ]);
  }

  function openCompleteEnrollment() {
    setLastName(selected?.child_last_name || '');
    setLastNameError('');
    setCompleteOpen(true);
  }

  function completeEnrollment() {
    if (!selected) return;
    if (!lastName.trim()) {
      setLastNameError("Enter the child's last name.");
      return;
    }
    if (!selected.classroom_id) {
      setLastNameError('The accepted offer does not include a program.');
      return;
    }
    Alert.alert('Create this child record?', `${childName(selected)} will become an enrolled child in the accepted program. The family and billing handoffs are created at the same time.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Complete enrollment', onPress: async () => {
        setBusy(true);
        const { error: actionError } = await supabase.rpc('enroll_from_pipeline', { p_enrollment_id: selected.id, p_classroom_id: selected.classroom_id, p_last_name: lastName.trim() });
        setBusy(false);
        if (actionError) return Alert.alert('Could not complete enrollment', actionError.message);
        setCompleteOpen(false);
        showToast('Child record created', 'success');
        await load({ refresh: true });
      } },
    ]);
  }

  function openWithdrawOffer() {
    setWithdrawReason('');
    setKeepOnWaitlist(true);
    setWithdrawError('');
    setWithdrawOpen(true);
  }

  function withdrawOffer() {
    if (!selected) return;
    if (!withdrawReason.trim()) {
      setWithdrawError('Enter a reason for the family record.');
      return;
    }
    Alert.alert('Withdraw this offer?', `The held spot for ${childName(selected)} will be released${keepOnWaitlist ? ', and the family will remain on the waitlist' : ''}.`, [
      { text: 'Keep offer', style: 'cancel' },
      { text: 'Withdraw offer', style: 'destructive', onPress: async () => {
        setBusy(true);
        const { error: actionError } = await supabase.rpc('withdraw_enrollment_offer', { p_enrollment_id: selected.id, p_keep_on_waitlist: keepOnWaitlist, p_reason: withdrawReason.trim() });
        setBusy(false);
        if (actionError) return Alert.alert('Could not withdraw offer', actionError.message);
        setWithdrawOpen(false);
        showToast('Offer withdrawn', 'success');
        await load({ refresh: true });
      } },
    ]);
  }

  if (loading && !enrollments.length) {
    return <View style={styles.loading}><ActivityIndicator size="large" color={colors.primary} /></View>;
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.back} accessibilityLabel="Go back">
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={styles.headerCopy}>
          <Text style={styles.title}>{selected ? childName(selected) : 'Enrollment pipeline'}</Text>
          <Text style={styles.subtitle}>{selected ? `${selected.guardian_name || 'Family'} · application review` : `${enrollments.length} active and recent applications`}</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load({ refresh: true })} tintColor={colors.primary} />}
      >
        {error ? <TouchableOpacity style={styles.errorCard} onPress={() => load()}><Text style={styles.errorText}>{error} Tap to retry.</Text></TouchableOpacity> : null}

        {selected ? (
          <>
            <TouchableOpacity onPress={() => { setSelectedId(null); navigation.setParams({ enrollmentId: undefined }); }} style={styles.pipelineLink}>
              <Ionicons name="arrow-back" size={16} color={colors.primary} />
              <Text style={styles.pipelineLinkText}>All applications</Text>
            </TouchableOpacity>

            <View style={styles.heroCard}>
              <View style={styles.heroTop}>
                <View style={styles.heroIcon}><Ionicons name="document-text-outline" size={23} color={colors.primary} /></View>
                <View style={styles.flex}>
                  <Text style={styles.heroTitle}>{childName(selected)}</Text>
                  <Text style={styles.heroSubtitle}>Applying for {fit?.room_name || 'placement'} · wants to start {dateLabel(selected.desired_start_date)}</Text>
                </View>
                <View style={styles.stageBadge}><Text style={styles.stageText}>{STAGE_LABELS[selected.stage] || selected.stage}</Text></View>
              </View>
              <View style={styles.progressTrackLarge}><View style={[styles.progressFill, { width: `${Math.max(0, Math.min(100, Number(selected.application_progress || 0)))}%` }]} /></View>
              <Text style={styles.heroProgress}>{selected.application_progress || 0}% complete{selected.application_submitted_at ? ' · submitted' : ''}</Text>
            </View>

            <Text style={styles.sectionTitle}>Family application</Text>
            <View style={styles.infoCard}>
              <InfoRow label="Parent or guardian" value={selected.guardian_name} />
              <InfoRow label="Email" value={selected.guardian_email} />
              <InfoRow label="Phone" value={selected.guardian_phone} />
              <InfoRow label="Child date of birth" value={dateLabel(selected.child_date_of_birth)} />
              <InfoRow label="Desired start" value={dateLabel(selected.desired_start_date)} last />
            </View>

            <Text style={styles.sectionTitle}>Fit check</Text>
            <View style={styles.fitCard}>
              {fit ? (
                <>
                  <FitRow label="Age" status={fit.age_status} text={fit.age_message} />
                  <FitRow label="Capacity" status={fit.capacity_status} text={fit.capacity_message} />
                  <FitRow label="Staffing" status={fit.staffing_status} text={fit.staffing_message} last />
                </>
              ) : <Text style={styles.emptyText}>A fit check becomes available once a room and start date are selected.</Text>}
            </View>

            <Text style={styles.sectionTitle}>Enrollment decision</Text>
            <View style={styles.decisionCard}>
              <View style={styles.workflowTop}>
                <View style={[styles.workflowIcon, selected.offer_status === 'accepted' && styles.successIcon]}><Ionicons name={selected.offer_status === 'accepted' ? 'checkmark' : selected.stage === 'waitlist' ? 'hourglass-outline' : 'paper-plane-outline'} size={22} color={selected.offer_status === 'accepted' ? colors.success : colors.primary} /></View>
                <View style={styles.flex}>
                  <Text style={styles.workflowTitle}>{selected.offer_status === 'accepted' ? 'Offer accepted' : ['sent', 'viewed'].includes(selected.offer_status) ? `Offer ${selected.offer_status}` : selected.stage === 'waitlist' ? `Waitlist${selected.waitlist_position ? ` · #${selected.waitlist_position}` : ''}` : selected.stage === 'enrolled' ? 'Enrollment complete' : 'Ready for a decision'}</Text>
                  <Text style={styles.workflowMeta}>{selected.offer_status === 'accepted' ? `${money(selected.offer_tuition_cents)} monthly · ${money(selected.offer_deposit_cents)} deposit` : ['sent', 'viewed'].includes(selected.offer_status) ? `Expires ${dateLabel(selected.offer_expires_at, true)} · ${money(selected.offer_tuition_cents)} monthly` : selected.stage === 'waitlist' ? `Desired start ${dateLabel(selected.desired_start_date)}${selected.waitlist_last_contact_at ? ` · checked in ${dateLabel(selected.waitlist_last_contact_at)}` : ''}` : selected.stage === 'enrolled' ? 'The family and child record are connected.' : 'Offer a safe opening or preserve the family on the waitlist.'}</Text>
                </View>
              </View>
              {selected.offer_status === 'accepted' && selected.stage !== 'enrolled' ? <TouchableOpacity onPress={openCompleteEnrollment} style={styles.primaryWide}><Text style={styles.primaryText}>Complete enrollment</Text></TouchableOpacity> : null}
              {!['accepted', 'sent', 'viewed'].includes(selected.offer_status) && !['enrolled', 'closed'].includes(selected.stage) ? <View style={styles.workflowActions}><TouchableOpacity onPress={openOffer} style={styles.primarySmall}><Text style={styles.primarySmallText}>Send offer</Text></TouchableOpacity><TouchableOpacity onPress={openWaitlist} style={styles.secondarySmall}><Text style={styles.secondarySmallText}>{selected.stage === 'waitlist' ? 'Update waitlist' : 'Add to waitlist'}</Text></TouchableOpacity></View> : null}
              {['sent', 'viewed'].includes(selected.offer_status) ? <View style={styles.offerTerms}><InfoRow label="Program" value={rooms.find(room => room.id === selected.classroom_id)?.name} /><InfoRow label="First day" value={dateLabel(selected.desired_start_date)} /><InfoRow label="Tuition" value={`${money(selected.offer_tuition_cents)} / month`} /><InfoRow label="Deposit" value={money(selected.offer_deposit_cents)} last /></View> : null}
              {['sent', 'viewed'].includes(selected.offer_status) ? <TouchableOpacity onPress={openWithdrawOffer} style={styles.withdrawLink}><Text style={styles.withdrawLinkText}>Withdraw offer</Text></TouchableOpacity> : null}
            </View>

            {offerAccepted ? (
              <>
                <View style={styles.sectionHeadingRow}>
                  <Text style={[styles.sectionTitle, styles.sectionTitleInline]}>First-day readiness</Text>
                  <View style={styles.readinessCount}><Text style={styles.readinessCountText}>{[offerAccepted, depositPaid, paperworkReady, onboardingReady, firstDayStarted].filter(Boolean).length} of 5</Text></View>
                </View>
                <View style={styles.infoCard}>
                  <ReadinessRow complete={offerAccepted} number={1} title="Offer accepted" detail={selected.offer_accepted_at ? `Accepted ${dateLabel(selected.offer_accepted_at, true)}` : 'The family accepted their placement.'} />
                  <ReadinessRow complete={depositPaid} number={2} title="Deposit paid" detail={depositPaid ? `${money(selected.offer_deposit_cents)} paid and credited` : `${money(selected.offer_deposit_cents)} is still due`} />
                  <ReadinessRow complete={paperworkReady} number={3} title="Paperwork complete" detail={`${documents.filter(document => document.status === 'received').length} of ${documents.length} required documents received`} />
                  <ReadinessRow complete={onboardingReady} number={4} title="Room & schedule" detail={onboardingReady ? `${onboardingEducatorName || 'Primary educator assigned'} · cubby ${onboardingCubby} · ${String(roomSchedule.schedule_label || 'family schedule saved')}` : 'Assign a primary educator and cubby before the first day.'} />
                  <ReadinessRow complete={firstDayStarted} number={5} title="First day" detail={selected.desired_start_date ? firstDayStarted ? `${dateLabel(selected.desired_start_date)} · educator roster and check-in are active` : `${dateLabel(selected.desired_start_date)} · educator access and attendance begin that day` : 'Choose a first day.'} last />
                  {selected.stage === 'enrolled' && selected.child_id ? <TouchableOpacity onPress={openOnboarding} style={styles.inlineAction}><Ionicons name="school-outline" size={17} color={colors.primary} /><Text style={styles.inlineActionText}>{onboardingReady ? 'Update room handoff' : 'Complete room handoff'}</Text></TouchableOpacity> : <View style={styles.readinessNotice}><Ionicons name="information-circle-outline" size={18} color={colors.primary} /><Text style={styles.readinessNoticeText}>{selected.stage === 'enrolled' ? 'This older enrollment is missing its linked child record. Reconcile the family record before the room handoff.' : 'Complete the accepted enrollment before assigning the educator and cubby.'}</Text></View>}
                </View>
              </>
            ) : null}

            <Text style={styles.sectionTitle}>Documents</Text>
            <View style={styles.infoCard}>
              {documents.map((document, index) => {
                const received = document.status === 'received';
                const requested = document.status === 'requested';
                return (
                  <View key={document.key} style={[styles.documentRow, index < documents.length - 1 && styles.infoRowBorder]}>
                    <Ionicons name={received ? 'checkmark-circle' : requested ? 'time-outline' : 'remove-circle-outline'} size={20} color={received ? colors.success : requested ? colors.amber : colors.textFaint} />
                    <View style={styles.flex}><Text style={styles.documentTitle}>{document.label}</Text><Text style={styles.documentMeta}>{received ? `Received${document.receivedAt ? ` ${dateLabel(document.receivedAt)}` : ''}` : requested ? 'Requested from family' : 'Missing'}</Text></View>
                  </View>
                );
              })}
              {missingDocuments.length ? <TouchableOpacity onPress={openDocuments} style={styles.inlineAction}><Ionicons name="mail-outline" size={17} color={colors.primary} /><Text style={styles.inlineActionText}>Request missing documents</Text></TouchableOpacity> : null}
            </View>

            <Text style={styles.sectionTitle}>Tour & follow-up</Text>
            <View style={styles.workflowCard}>
              {selected.tour_at ? (
                <>
                  <View style={styles.workflowTop}><View style={styles.workflowIcon}><Ionicons name="calendar-outline" size={22} color={colors.primary} /></View><View style={styles.flex}><Text style={styles.workflowTitle}>Tour {selected.tour_outcome ? STAGE_LABELS[selected.tour_outcome] || selected.tour_outcome.replace('_', '-') : 'scheduled'}</Text><Text style={styles.workflowMeta}>{dateLabel(selected.tour_at, true)}{selected.tour_notes ? ` · ${selected.tour_notes}` : ''}</Text></View></View>
                  {!selected.tour_outcome ? <View style={styles.workflowActions}><TouchableOpacity onPress={openTourOutcome} style={styles.primarySmall}><Text style={styles.primarySmallText}>Record outcome</Text></TouchableOpacity><TouchableOpacity onPress={cancelTour} disabled={busy} style={styles.secondarySmall}><Text style={styles.secondarySmallText}>Cancel tour</Text></TouchableOpacity></View> : null}
                </>
              ) : (
                <>
                  <View style={styles.workflowTop}><View style={styles.workflowIcon}><Ionicons name="calendar-outline" size={22} color={colors.primary} /></View><View style={styles.flex}><Text style={styles.workflowTitle}>No tour booked</Text><Text style={styles.workflowMeta}>Choose from the center's open visit times.</Text></View></View>
                  <TouchableOpacity onPress={() => { setSelectedSlotId(null); setTourOpen(true); }} style={styles.primaryWide}><Text style={styles.primaryText}>Schedule a tour</Text></TouchableOpacity>
                </>
              )}
            </View>

            {selected.notes ? <View style={styles.noteCard}><Text style={styles.noteLabel}>CENTER NOTES</Text><Text style={styles.noteText}>{selected.notes}</Text></View> : null}
            <View style={styles.webNotice}>
              <Ionicons name="shield-checkmark-outline" size={19} color={colors.primary} />
              <Text style={styles.webNoticeText}>Every progression action uses the same guarded workflow as the web pipeline. Changes remain visible to the family and administrator in both apps.</Text>
            </View>
          </>
        ) : (
          <>
            <Text style={styles.sectionTitle}>Applications</Text>
            {!enrollments.length ? (
              <View style={styles.emptyCard}><Text style={styles.emptyTitle}>No applications yet</Text><Text style={styles.emptyText}>New family inquiries and applications will appear here.</Text></View>
            ) : enrollments.map(row => <ApplicationCard key={row.id} enrollment={row} focused={row.id === route.params?.enrollmentId} onPress={() => select(row)} />)}
          </>
        )}
      </ScrollView>
      <TourBookingSheet visible={tourOpen} child={selected ? childName(selected) : 'this child'} slots={tourSlots} selectedSlotId={selectedSlotId} busy={busy} onSelect={setSelectedSlotId} onClose={() => setTourOpen(false)} onSubmit={bookTour} />
      <DocumentRequestSheet visible={documentsOpen} child={selected ? childName(selected) : 'this child'} documents={documents} canRequestHandbook={Boolean(selected?.child_id)} selectedKeys={selectedDocuments} message={documentMessage} busy={busy} onToggle={toggleDocument} onMessage={setDocumentMessage} onClose={() => setDocumentsOpen(false)} onSubmit={requestDocuments} />
      <TourOutcomeSheet visible={outcomeOpen} child={selected ? childName(selected) : 'this child'} outcome={tourOutcome} notes={tourNotes} sendApplication={sendApplication} busy={busy} onOutcome={setTourOutcome} onNotes={setTourNotes} onSendApplication={setSendApplication} onClose={() => setOutcomeOpen(false)} onSubmit={saveTourOutcome} />
      <OfferSheet visible={offerOpen} child={selected ? childName(selected) : 'this child'} rooms={rooms} form={offerForm} errors={offerErrors} busy={busy} onChange={setOfferValue} onClose={() => setOfferOpen(false)} onSubmit={sendOffer} />
      <WaitlistSheet visible={waitlistOpen} child={selected ? childName(selected) : 'this child'} rooms={rooms} form={waitlistForm} errors={waitlistErrors} busy={busy} onChange={setWaitlistValue} onClose={() => setWaitlistOpen(false)} onSubmit={addToWaitlist} />
      <CompleteEnrollmentSheet visible={completeOpen} child={selected ? childName(selected) : 'this child'} lastName={lastName} error={lastNameError} busy={busy} onLastName={value => { setLastName(value); setLastNameError(''); }} onClose={() => setCompleteOpen(false)} onSubmit={completeEnrollment} />
      <WithdrawOfferSheet visible={withdrawOpen} child={selected ? childName(selected) : 'this child'} reason={withdrawReason} keepOnWaitlist={keepOnWaitlist} error={withdrawError} busy={busy} onReason={value => { setWithdrawReason(value); setWithdrawError(''); }} onKeep={setKeepOnWaitlist} onClose={() => setWithdrawOpen(false)} onSubmit={withdrawOffer} />
      <OnboardingSheet visible={onboardingOpen} child={selected ? childName(selected) : 'this child'} roomName={selectedRoom?.name} educators={eligibleEducators} form={onboardingForm} errors={onboardingErrors} busy={busy} onChange={setOnboardingValue} onClose={() => setOnboardingOpen(false)} onSubmit={saveOnboarding} />
    </SafeAreaView>
  );
}

function FitRow({ label, status, text, last }) {
  const pass = status === 'pass';
  const fail = status === 'fail';
  const color = pass ? colors.success : fail ? colors.danger : colors.amber;
  return (
    <View style={[styles.fitRow, !last && styles.infoRowBorder]}>
      <Ionicons name={pass ? 'checkmark-circle' : fail ? 'close-circle' : 'alert-circle'} size={20} color={color} />
      <View style={styles.flex}><Text style={styles.fitLabel}>{label}</Text><Text style={styles.fitText}>{text}</Text></View>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  header: { minHeight: 78, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.xl, borderBottomWidth: 1, borderBottomColor: colors.borderSoft, backgroundColor: colors.surface },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.borderSoft, borderRadius: 20 },
  headerCopy: { flex: 1, minWidth: 0 },
  title: { color: colors.textPrimary, fontFamily: fonts.black, fontSize: 20 },
  subtitle: { marginTop: 2, color: colors.textMuted, fontFamily: fonts.regular, fontSize: 11.5 },
  content: { padding: spacing.xl, paddingBottom: 44 },
  flex: { flex: 1, minWidth: 0 },
  sectionTitle: { marginBottom: spacing.md, color: colors.textPrimary, fontFamily: fonts.black, fontSize: 17 },
  sectionHeadingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  sectionTitleInline: { marginBottom: 0 },
  readinessCount: { paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.full, backgroundColor: colors.primaryLight },
  readinessCountText: { color: colors.primary, fontFamily: fonts.bold, fontSize: 10.5 },
  pipelineLink: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: spacing.md },
  pipelineLinkText: { color: colors.primary, fontFamily: fonts.bold, fontSize: 12.5 },
  heroCard: { padding: spacing.lg, marginBottom: spacing.xl, borderRadius: radius.xl, backgroundColor: colors.primaryLight },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  heroIcon: { width: 46, height: 46, alignItems: 'center', justifyContent: 'center', borderRadius: radius.lg, backgroundColor: colors.surface },
  heroTitle: { color: colors.textPrimary, fontFamily: fonts.black, fontSize: 18 },
  heroSubtitle: { marginTop: 3, color: colors.textSecondary, fontFamily: fonts.regular, fontSize: 11.5, lineHeight: 16 },
  heroProgress: { marginTop: spacing.xs, color: colors.primary, fontFamily: fonts.bold, fontSize: 10.5 },
  stageBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.full, backgroundColor: colors.purpleLight },
  stageText: { color: colors.purple, fontFamily: fonts.bold, fontSize: 9.5, textTransform: 'capitalize' },
  progressTrack: { height: 5, marginTop: spacing.sm, overflow: 'hidden', borderRadius: 3, backgroundColor: colors.borderSoft },
  progressTrackLarge: { height: 7, marginTop: spacing.lg, overflow: 'hidden', borderRadius: 4, backgroundColor: colors.surface },
  progressFill: { height: '100%', borderRadius: 4, backgroundColor: colors.primary },
  progressText: { marginTop: 4, color: colors.textFaint, fontFamily: fonts.regular, fontSize: 9.5 },
  applicationCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg, marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface },
  applicationFocused: { borderWidth: 2, borderColor: colors.primary, backgroundColor: colors.primarySoft },
  avatar: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22, backgroundColor: colors.primaryLight },
  avatarText: { color: colors.primary, fontFamily: fonts.black, fontSize: 16 },
  applicationTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  childName: { flex: 1, color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 14 },
  guardian: { marginTop: 2, color: colors.textMuted, fontFamily: fonts.regular, fontSize: 11.5 },
  infoCard: { marginBottom: spacing.xl, overflow: 'hidden', borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface },
  infoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, padding: spacing.md },
  infoRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.borderSoft },
  infoLabel: { width: 118, color: colors.textMuted, fontFamily: fonts.regular, fontSize: 11.5 },
  infoValue: { flex: 1, color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 11.5, textAlign: 'right' },
  readinessRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, padding: spacing.md },
  readinessMarker: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: colors.primaryLight },
  readinessMarkerComplete: { backgroundColor: colors.success },
  readinessNumber: { color: colors.primary, fontFamily: fonts.bold, fontSize: 11 },
  readinessTitle: { color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 12.5 },
  readinessDetail: { marginTop: 2, color: colors.textMuted, fontFamily: fonts.regular, fontSize: 10.5, lineHeight: 15 },
  readinessNotice: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.borderSoft, backgroundColor: colors.primarySoft },
  readinessNoticeText: { flex: 1, color: colors.textSecondary, fontFamily: fonts.regular, fontSize: 11, lineHeight: 16 },
  documentRow: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md },
  documentTitle: { color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 12.5 },
  documentMeta: { marginTop: 2, color: colors.textMuted, fontFamily: fonts.regular, fontSize: 10.5 },
  inlineAction: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, borderTopWidth: 1, borderTopColor: colors.borderSoft, backgroundColor: colors.primarySoft },
  inlineActionText: { color: colors.primary, fontFamily: fonts.bold, fontSize: 12.5 },
  fitCard: { marginBottom: spacing.xl, overflow: 'hidden', borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface },
  fitRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, padding: spacing.md },
  fitLabel: { color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 12.5 },
  fitText: { marginTop: 2, color: colors.textMuted, fontFamily: fonts.regular, fontSize: 11.5, lineHeight: 16 },
  noteCard: { padding: spacing.lg, marginBottom: spacing.md, borderRadius: radius.lg, backgroundColor: colors.amberLight },
  noteLabel: { color: colors.amber, fontFamily: fonts.bold, fontSize: 10, letterSpacing: 0.8 },
  noteText: { marginTop: spacing.sm, color: colors.textSecondary, fontFamily: fonts.regular, fontSize: 12.5, lineHeight: 18 },
  webNotice: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.primaryLight },
  webNoticeText: { flex: 1, color: colors.textSecondary, fontFamily: fonts.regular, fontSize: 11.5, lineHeight: 16 },
  errorCard: { padding: spacing.md, marginBottom: spacing.md, borderRadius: radius.md, backgroundColor: colors.dangerLight },
  errorText: { color: colors.danger, fontFamily: fonts.bold, fontSize: 11.5 },
  emptyCard: { alignItems: 'center', padding: spacing.xxl, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface },
  emptyTitle: { color: colors.textPrimary, fontFamily: fonts.black, fontSize: 16 },
  emptyText: { marginTop: spacing.xs, color: colors.textMuted, fontFamily: fonts.regular, fontSize: 12, lineHeight: 17 },
  workflowCard: { padding: spacing.lg, marginBottom: spacing.xl, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface },
  decisionCard: { padding: spacing.lg, marginBottom: spacing.xl, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface },
  successIcon: { backgroundColor: colors.successLight },
  offerTerms: { overflow: 'hidden', marginTop: spacing.lg, borderWidth: 1, borderColor: colors.borderSoft, borderRadius: radius.md, backgroundColor: colors.bg },
  withdrawLink: { alignSelf: 'center', paddingHorizontal: spacing.md, paddingTop: spacing.md },
  withdrawLinkText: { color: colors.danger, fontFamily: fonts.bold, fontSize: 11.5 },
  workflowTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  workflowIcon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22, backgroundColor: colors.primaryLight },
  workflowTitle: { color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 13.5, textTransform: 'capitalize' },
  workflowMeta: { marginTop: 3, color: colors.textMuted, fontFamily: fonts.regular, fontSize: 11.5, lineHeight: 16 },
  workflowActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  primaryWide: { minHeight: 46, alignItems: 'center', justifyContent: 'center', marginTop: spacing.lg, borderRadius: radius.md, backgroundColor: colors.primary },
  primarySmall: { flex: 1.3, minHeight: 42, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, backgroundColor: colors.primary },
  primarySmallText: { color: colors.white, fontFamily: fonts.bold, fontSize: 12 },
  secondarySmall: { flex: 1, minHeight: 42, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: radius.md },
  secondarySmallText: { color: colors.textSecondary, fontFamily: fonts.bold, fontSize: 12 },
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(23,51,91,0.35)' },
  modalCard: { maxHeight: '88%', paddingHorizontal: spacing.xl, paddingTop: spacing.sm, paddingBottom: 34, borderTopLeftRadius: 24, borderTopRightRadius: 24, backgroundColor: colors.surface },
  modalHandle: { alignSelf: 'center', width: 42, height: 5, marginBottom: spacing.lg, borderRadius: 3, backgroundColor: colors.border },
  modalHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.lg },
  modalTitle: { color: colors.textPrimary, fontFamily: fonts.black, fontSize: 20 },
  modalSubtitle: { marginTop: 2, color: colors.textMuted, fontFamily: fonts.regular, fontSize: 11.5 },
  modalClose: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.borderSoft, borderRadius: 19 },
  sheetScroll: { maxHeight: 440 },
  sheetList: { paddingBottom: spacing.md },
  choiceCard: { minHeight: 62, flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface },
  choiceCardActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  choiceTitle: { color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 12.5 },
  choiceMeta: { marginTop: 2, color: colors.textMuted, fontFamily: fonts.regular, fontSize: 10.5 },
  educatorList: { padding: 2, borderRadius: radius.md },
  educatorAvatar: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 19, backgroundColor: colors.primaryLight },
  educatorAvatarActive: { backgroundColor: colors.primary },
  educatorInitials: { color: colors.primary, fontFamily: fonts.black, fontSize: 11 },
  educatorInitialsActive: { color: colors.white },
  roomGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, padding: 2, borderRadius: radius.md },
  fieldGroupError: { borderWidth: 1, borderColor: colors.danger },
  roomChoice: { width: '48%', minHeight: 58, justifyContent: 'center', padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md },
  roomChoiceText: { color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 12 },
  roomChoiceMeta: { marginTop: 2, color: colors.textFaint, fontFamily: fonts.regular, fontSize: 9.5 },
  radio: { width: 20, height: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: colors.border, borderRadius: 10 },
  radioActive: { borderColor: colors.primary },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary },
  sheetEmpty: { alignItems: 'center', padding: spacing.xl, marginBottom: spacing.md, borderRadius: radius.md, backgroundColor: colors.bg },
  fieldLabel: { marginTop: spacing.sm, marginBottom: spacing.sm, color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 12.5 },
  fieldError: { marginTop: 3, marginBottom: spacing.xs, color: colors.danger, fontFamily: fonts.bold, fontSize: 10.5 },
  inputError: { borderColor: colors.danger },
  dateField: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.sm, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md },
  dateValue: { flex: 1, color: colors.textSecondary, fontFamily: fonts.regular, fontSize: 11.5, textAlign: 'right' },
  twoColumns: { flexDirection: 'row', gap: spacing.sm },
  moneyField: { height: 50, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md },
  currency: { marginRight: 4, color: colors.textMuted, fontFamily: fonts.bold, fontSize: 14 },
  moneyInput: { flex: 1, color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 13 },
  textField: { height: 52, paddingHorizontal: spacing.md, marginBottom: spacing.xs, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md, color: colors.textPrimary, fontFamily: fonts.regular, fontSize: 13 },
  windowChoices: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg },
  windowChoice: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: radius.md },
  windowText: { color: colors.textSecondary, fontFamily: fonts.bold, fontSize: 10.5 },
  guardNotice: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, padding: spacing.md, marginBottom: spacing.lg, borderRadius: radius.md, backgroundColor: colors.primarySoft },
  dangerNotice: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, padding: spacing.md, marginBottom: spacing.lg, borderRadius: radius.md, backgroundColor: colors.dangerLight },
  guardNoticeText: { flex: 1, color: colors.textSecondary, fontFamily: fonts.regular, fontSize: 11, lineHeight: 16 },
  messageInput: { minHeight: 96, padding: spacing.md, marginBottom: spacing.lg, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md, color: colors.textPrimary, fontFamily: fonts.regular, fontSize: 12.5, lineHeight: 18 },
  modalActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  secondaryButton: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: radius.md },
  secondaryText: { color: colors.textSecondary, fontFamily: fonts.bold, fontSize: 13 },
  primaryButton: { flex: 1.4, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, backgroundColor: colors.primary },
  dangerButton: { flex: 1.4, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, backgroundColor: colors.danger },
  primaryText: { color: colors.white, fontFamily: fonts.bold, fontSize: 13 },
  disabledButton: { opacity: 0.45 },
  outcomeGrid: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg },
  outcomeChoice: { flex: 1, minHeight: 78, alignItems: 'center', justifyContent: 'center', gap: spacing.xs, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md },
  outcomeText: { color: colors.textSecondary, fontFamily: fonts.bold, fontSize: 10.5 },
  outcomeTextActive: { color: colors.primary },
  checkboxRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, marginBottom: spacing.sm, borderRadius: radius.md, backgroundColor: colors.primarySoft },
  checkboxTitle: { color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 12 },
  checkboxText: { flex: 1, color: colors.textSecondary, fontFamily: fonts.regular, fontSize: 11.5, lineHeight: 16 },
});
