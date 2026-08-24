import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import {
  addDays,
  differenceInCalendarDays,
  format,
  isToday,
  isTomorrow,
  parseISO,
} from 'date-fns';
import { isStaffRole } from '@dailylog/shared';

import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../lib/supabase';
import { Button, Input } from '../../components/ui';
import { ChildAvatar } from '../../components/ChildAvatar';
import { DatePickerField } from '../../components/DatePickerField';
import { showToast } from '../../components/Toast';
import { colors, fonts, radius, spacing } from '../../theme';

const ROUTES = ['Oral', 'Topical', 'Inhaler', 'EpiPen', 'Other'];
const MEDICATION_TYPES = [
  { value: 'prescription', label: 'Prescription' },
  { value: 'over_the_counter', label: 'Over-the-counter' },
];
const SCHEDULE_TYPES = [
  { value: 'scheduled', label: 'Scheduled times' },
  { value: 'as_needed', label: 'As needed' },
];
const AUTHORIZATION_VERSION = '2026-08-09';
const LOG_PAGE_SIZE = 30;
const DETAIL_LOG_PAGE_SIZE = 50;
const MEDICATION_LOG_SELECT = `
  *,
  administered_by_profile:profiles!medication_logs_administered_by_fkey(full_name),
  witness_profile:profiles!medication_logs_witness_id_fkey(full_name),
  authorization:medication_authorizations(name, dosage, route)
`;
const EMPTY_CHECKS = {
  right_child: false,
  right_medication: false,
  right_dose: false,
  right_route: false,
  right_time: false,
};

function initials(name) {
  return String(name || '')
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function formatChildName(child) {
  return [child?.first_name, child?.last_name].filter(Boolean).join(' ');
}

function timeParts(value) {
  const [hours = '0', minutes = '0'] = String(value || '').split(':');
  return { hours: Number(hours), minutes: Number(minutes) };
}

function displayTime(value) {
  const { hours, minutes } = timeParts(value);
  const date = new Date(2000, 0, 1, hours, minutes);
  return format(date, 'h:mm a');
}

function nextScheduledDose(authorizations, now = new Date()) {
  const candidates = [];
  authorizations.forEach((authorization) => {
    if (authorization.schedule_type !== 'scheduled') return;
    const times = authorization.scheduled_times || [];
    for (let dayOffset = 0; dayOffset <= 1; dayOffset += 1) {
      const day = new Date(now);
      day.setDate(now.getDate() + dayOffset);
      day.setHours(0, 0, 0, 0);
      const dateKey = format(day, 'yyyy-MM-dd');
      if (authorization.start_date && dateKey < authorization.start_date) continue;
      if (authorization.end_date && dateKey > authorization.end_date) continue;
      times.forEach((time) => {
        const { hours, minutes } = timeParts(time);
        const at = new Date(day);
        at.setHours(hours, minutes, 0, 0);
        if (at > now) candidates.push({ authorization, at });
      });
    }
  });
  return candidates.sort((left, right) => left.at - right.at)[0] || null;
}

function authorizationState(authorization, now = new Date()) {
  const today = format(now, 'yyyy-MM-dd');
  if (!authorization?.active) return 'ended';
  if (authorization.start_date && authorization.start_date > today) return 'upcoming';
  if (authorization.end_date && authorization.end_date < today) return 'expired';
  return 'active';
}

function authorizationStatus(authorization) {
  const state = authorizationState(authorization);
  if (state === 'ended') {
    return { label: 'Ended', color: colors.textMuted, bg: colors.bg };
  }
  if (state === 'upcoming') {
    return {
      label: `Starts ${format(parseISO(authorization.start_date), 'MMM d')}`,
      color: colors.primary,
      bg: colors.primaryLight,
    };
  }
  if (state === 'expired') {
    return { label: 'Expired · Renew', color: colors.danger, bg: colors.dangerLight };
  }
  if (!authorization.end_date) {
    return { label: 'Active', color: colors.success, bg: colors.successLight };
  }

  const remaining = differenceInCalendarDays(
    parseISO(authorization.end_date),
    new Date()
  );

  if (remaining < 0) {
    return { label: 'Expired', color: colors.danger, bg: colors.dangerLight };
  }
  if (remaining <= 7) {
    return {
      label: remaining === 0 ? 'Expires today · Renew' : `Expires in ${remaining} days · Renew`,
      color: colors.amber,
      bg: colors.amberLight,
    };
  }
  return {
    label: `Active until ${format(parseISO(authorization.end_date), 'MMM d')}`,
    color: colors.success,
    bg: colors.successLight,
  };
}

function canRenewAuthorization(authorization) {
  if (!authorization?.end_date) return !authorization?.active;
  return !authorization.active
    || differenceInCalendarDays(parseISO(authorization.end_date), new Date()) <= 7;
}

function splitDosage(value) {
  const match = String(value || '').trim().match(/^(.+?)\s+([^\s]+)$/);
  return match ? { amount: match[1], unit: match[2] } : { amount: String(value || ''), unit: 'ml' };
}

function authorizationStartForRenewal(authorization) {
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  if (authorization.active && authorization.end_date) {
    const nextDay = addDays(parseISO(authorization.end_date), 1);
    return nextDay > today ? nextDay : today;
  }
  return today;
}

function MedicationThumbnail({ uri, size = 44 }) {
  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={{ width: size, height: size, borderRadius: radius.md }}
        resizeMode="cover"
      />
    );
  }
  return (
    <View style={[styles.medicationPlaceholder, { width: size, height: size }]}>
      <Ionicons name="medical-outline" size={size * 0.46} color={colors.primary} />
    </View>
  );
}

function SheetHeader({ title, onClose }) {
  return (
    <>
      <View style={styles.grabber} />
      <View style={styles.sheetHeader}>
        <Text style={styles.sheetTitle}>{title}</Text>
        <TouchableOpacity
          onPress={onClose}
          style={styles.closeButton}
          accessibilityRole="button"
          accessibilityLabel={`Close ${title.toLowerCase()}`}
        >
          <Ionicons name="close" size={19} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>
    </>
  );
}

function DetailRow({ label, value }) {
  if (!value) return null;
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

function ChoiceRow({ options, value, onChange, error }) {
  return (
    <View>
      <View style={styles.choiceRow}>
        {options.map((option) => (
          <TouchableOpacity
            key={option.value}
            onPress={() => onChange(option.value)}
            style={[
              styles.choiceButton,
              value === option.value && styles.choiceButtonSelected,
              error && styles.choiceButtonError,
            ]}
            accessibilityRole="radio"
            accessibilityState={{ checked: value === option.value }}
          >
            <Text style={[
              styles.choiceButtonText,
              value === option.value && styles.choiceButtonTextSelected,
            ]}>
              {option.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      {error ? <Text style={styles.formErrorText}>{error}</Text> : null}
    </View>
  );
}

function ScheduledTimesField({ times, onChange, error }) {
  const [showPicker, setShowPicker] = useState(false);

  function addTime(event, selectedDate) {
    setShowPicker(false);
    if (event.type === 'dismissed' || !selectedDate) return;
    const value = format(selectedDate, 'HH:mm');
    if (!times.includes(value)) onChange([...times, value].sort());
  }

  return (
    <View style={styles.scheduledTimesWrap}>
      <Text style={styles.fieldLabel}>Times to give <Text style={styles.requiredMark}>*</Text></Text>
      <View style={[styles.scheduledTimesBox, error && styles.fieldBoxError]}>
        <View style={styles.scheduledTimeChips}>
          {times.map((time) => (
            <TouchableOpacity
              key={time}
              onPress={() => onChange(times.filter((item) => item !== time))}
              style={styles.scheduledTimeChip}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${displayTime(time)}`}
            >
              <Ionicons name="time-outline" size={15} color={colors.primary} />
              <Text style={styles.scheduledTimeText}>{displayTime(time)}</Text>
              <Ionicons name="close" size={14} color={colors.primary} />
            </TouchableOpacity>
          ))}
          <TouchableOpacity
            onPress={() => setShowPicker(true)}
            style={styles.addTimeButton}
            accessibilityRole="button"
          >
            <Ionicons name="add" size={17} color={colors.primary} />
            <Text style={styles.addTimeText}>Add time</Text>
          </TouchableOpacity>
        </View>
      </View>
      {error ? <Text style={styles.formErrorText}>{error}</Text> : null}
      {showPicker ? (
        <DateTimePicker
          value={new Date(2000, 0, 1, 12, 30)}
          mode="time"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          minuteInterval={5}
          onChange={addTime}
        />
      ) : null}
    </View>
  );
}

export default function MedicationScreen({ route, navigation }) {
  const routeChild = route.params?.child || { id: route.params?.childId };
  const { profile } = useAuth();

  const [child, setChild] = useState(routeChild);
  const [auths, setAuths] = useState([]);
  const [logs, setLogs] = useState([]);
  const [hasOlderLogs, setHasOlderLogs] = useState(false);
  const [loadingOlderLogs, setLoadingOlderLogs] = useState(false);
  const [staff, setStaff] = useState([]);
  const [labelUrls, setLabelUrls] = useState({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [viewingAuth, setViewingAuth] = useState(null);
  const [viewingLogs, setViewingLogs] = useState([]);
  const [viewingLogsLoading, setViewingLogsLoading] = useState(false);
  const [viewingLogsHasMore, setViewingLogsHasMore] = useState(false);
  const [renewingFrom, setRenewingFrom] = useState(null);
  const handledTargetRef = useRef('');

  const [composing, setComposing] = useState(false);
  const [name, setName] = useState('');
  const [medicationType, setMedicationType] = useState('prescription');
  const [doseAmount, setDoseAmount] = useState('');
  const [doseUnit, setDoseUnit] = useState('ml');
  const [routeName, setRouteName] = useState('Oral');
  const [scheduleType, setScheduleType] = useState('as_needed');
  const [scheduledTimes, setScheduledTimes] = useState([]);
  const [schedule, setSchedule] = useState('');
  const [condition, setCondition] = useState('');
  const [maxDaily, setMaxDaily] = useState('');
  const [startDate, setStartDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(
    format(addDays(new Date(), 30), 'yyyy-MM-dd')
  );
  const [notes, setNotes] = useState('');
  const [signedName, setSignedName] = useState('');
  const [labelUri, setLabelUri] = useState('');
  const [consented, setConsented] = useState(false);
  const [formErrors, setFormErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const [dosingAuth, setDosingAuth] = useState(null);
  const [doseNotes, setDoseNotes] = useState('');
  const [witnessId, setWitnessId] = useState('');
  const [showWitnesses, setShowWitnesses] = useState(false);
  const [checks, setChecks] = useState(EMPTY_CHECKS);
  const [savingDose, setSavingDose] = useState(false);

  const isStaff = isStaffRole(profile?.role);
  const isParent = profile?.role === 'parent';

  useEffect(() => {
    if (isParent && route.params?.compose) setComposing(true);
  }, [isParent, route.params?.compose]);

  const activeAuths = useMemo(
    () => auths.filter((authorization) => authorizationState(authorization) === 'active'),
    [auths]
  );
  const upcomingAuths = useMemo(
    () => auths.filter((authorization) => authorizationState(authorization) === 'upcoming'),
    [auths]
  );
  const pastAuths = useMemo(
    () => auths.filter((authorization) => {
      const state = authorizationState(authorization);
      return state === 'ended' || state === 'expired';
    }),
    [auths]
  );
  const availableWitnesses = useMemo(
    () => staff.filter((member) => member.id !== profile?.id),
    [profile?.id, staff]
  );
  const selectedWitness = availableWitnesses.find((member) => member.id === witnessId);
  const upcomingDose = useMemo(
    () => nextScheduledDose(activeAuths),
    [activeAuths]
  );
  useEffect(() => {
    load();
  }, [routeChild.id, route.params?.linkedAt]);

  useEffect(() => {
    const target = route.params?.authorizationId || route.params?.medicationLogId;
    if (!target || handledTargetRef.current === target || !auths.length) return;
    const targetLog = logs.find((log) => log.id === route.params?.medicationLogId);
    const authorizationId = route.params?.authorizationId || targetLog?.authorization_id;
    const authorization = auths.find((item) => item.id === authorizationId);
    if (authorization) {
      handledTargetRef.current = target;
      openAuthorizationDetail(authorization);
    }
  }, [auths, logs, route.params?.authorizationId, route.params?.medicationLogId]);

  async function load() {
    setLoading(true);
    setLoadError('');
    if (!routeChild?.id) {
      setLoading(false);
      setLoadError('This medication record does not include a child.');
      return;
    }
    const requests = [
      supabase
        .from('children')
        .select('id, daycare_id, classroom_id, first_name, last_name, photo_url, classroom:classrooms(name, age_group)')
        .eq('id', routeChild.id)
        .maybeSingle(),
      supabase
        .from('medication_authorizations')
        .select('*, parent:profiles!medication_authorizations_parent_id_fkey(full_name)')
        .eq('child_id', routeChild.id)
        .order('active', { ascending: false })
        .order('created_at', { ascending: false }),
      supabase
        .from('medication_logs')
        .select(MEDICATION_LOG_SELECT)
        .eq('child_id', routeChild.id)
        .order('administered_at', { ascending: false })
        .limit(LOG_PAGE_SIZE + 1),
    ];

    if (isStaff) {
      requests.push(
        supabase
          .from('profiles')
          .select('id, full_name, role')
          .eq('daycare_id', profile.daycare_id)
          .in('role', ['owner_admin', 'admin', 'educator'])
          .order('full_name')
      );
    }

    const [childRes, authRes, logRes, staffRes] = await Promise.all(requests);
    const authorizations = authRes.data || [];
    let medicationLogs = (logRes.data || []).slice(0, LOG_PAGE_SIZE);
    setHasOlderLogs((logRes.data || []).length > LOG_PAGE_SIZE);
    const requestError = childRes.error || authRes.error || logRes.error || staffRes?.error;

    if (
      route.params?.medicationLogId
      && !medicationLogs.some((log) => log.id === route.params.medicationLogId)
    ) {
      const { data: targetLog, error: targetLogError } = await supabase
        .from('medication_logs')
        .select(MEDICATION_LOG_SELECT)
        .eq('id', route.params.medicationLogId)
        .eq('child_id', routeChild.id)
        .maybeSingle();
      if (targetLogError && !requestError) {
        setLoadError(targetLogError.message || 'The selected medication dose could not be loaded.');
      }
      if (targetLog) {
        medicationLogs = [targetLog, ...medicationLogs]
          .sort((left, right) => new Date(right.administered_at) - new Date(left.administered_at));
      }
    }

    if (requestError) setLoadError(requestError.message || 'Medication records could not be loaded.');

    if (childRes.data) setChild(childRes.data);
    setAuths(authorizations);
    setLogs(medicationLogs);
    if (staffRes) setStaff(staffRes.data || []);
    setLoading(false);
    loadLabelUrls(authorizations);
  }

  async function loadOlderLogs() {
    const cursor = logs[logs.length - 1]?.administered_at;
    if (!cursor || loadingOlderLogs) return;
    setLoadingOlderLogs(true);
    const { data, error } = await supabase
      .from('medication_logs')
      .select(MEDICATION_LOG_SELECT)
      .eq('child_id', routeChild.id)
      .lt('administered_at', cursor)
      .order('administered_at', { ascending: false })
      .limit(LOG_PAGE_SIZE + 1);
    setLoadingOlderLogs(false);
    if (error) {
      Alert.alert('Could not load older doses', error.message);
      return;
    }
    const page = (data || []).slice(0, LOG_PAGE_SIZE);
    setLogs((current) => {
      const known = new Set(current.map((log) => log.id));
      return [...current, ...page.filter((log) => !known.has(log.id))];
    });
    setHasOlderLogs((data || []).length > LOG_PAGE_SIZE);
  }

  async function openAuthorizationDetail(authorization) {
    setViewingAuth(authorization);
    setViewingLogs([]);
    setViewingLogsHasMore(false);
    setViewingLogsLoading(true);
    const { data, error } = await supabase
      .from('medication_logs')
      .select(MEDICATION_LOG_SELECT)
      .eq('child_id', routeChild.id)
      .eq('authorization_id', authorization.id)
      .order('administered_at', { ascending: false })
      .limit(DETAIL_LOG_PAGE_SIZE + 1);
    setViewingLogsLoading(false);
    if (error) {
      Alert.alert('Could not load dose history', error.message);
      return;
    }
    setViewingLogs((data || []).slice(0, DETAIL_LOG_PAGE_SIZE));
    setViewingLogsHasMore((data || []).length > DETAIL_LOG_PAGE_SIZE);
  }

  async function loadOlderAuthorizationLogs() {
    const cursor = viewingLogs[viewingLogs.length - 1]?.administered_at;
    if (!viewingAuth?.id || !cursor || viewingLogsLoading) return;
    setViewingLogsLoading(true);
    const { data, error } = await supabase
      .from('medication_logs')
      .select(MEDICATION_LOG_SELECT)
      .eq('child_id', routeChild.id)
      .eq('authorization_id', viewingAuth.id)
      .lt('administered_at', cursor)
      .order('administered_at', { ascending: false })
      .limit(DETAIL_LOG_PAGE_SIZE + 1);
    setViewingLogsLoading(false);
    if (error) {
      Alert.alert('Could not load older doses', error.message);
      return;
    }
    const page = (data || []).slice(0, DETAIL_LOG_PAGE_SIZE);
    setViewingLogs((current) => {
      const known = new Set(current.map((log) => log.id));
      return [...current, ...page.filter((log) => !known.has(log.id))];
    });
    setViewingLogsHasMore((data || []).length > DETAIL_LOG_PAGE_SIZE);
  }

  async function loadLabelUrls(authorizations) {
    const entries = await Promise.all(
      authorizations
        .filter((authorization) => authorization.label_photo_path)
        .map(async (authorization) => {
          const { data } = await supabase.storage
            .from('medication-labels')
            .createSignedUrl(authorization.label_photo_path, 60 * 60);
          return [authorization.id, data?.signedUrl || ''];
        })
    );
    setLabelUrls(Object.fromEntries(entries));
  }

  function resetAuthorizationForm() {
    setName('');
    setMedicationType('prescription');
    setDoseAmount('');
    setDoseUnit('ml');
    setRouteName('Oral');
    setScheduleType('as_needed');
    setScheduledTimes([]);
    setSchedule('');
    setCondition('');
    setMaxDaily('');
    setStartDate(format(new Date(), 'yyyy-MM-dd'));
    setEndDate(format(addDays(new Date(), 30), 'yyyy-MM-dd'));
    setNotes('');
    setSignedName('');
    setLabelUri('');
    setConsented(false);
    setFormErrors({});
    setRenewingFrom(null);
  }

  function updateFormField(field, setter) {
    return (value) => {
      setter(value);
      setFormErrors((current) => {
        if (!current[field]) return current;
        const next = { ...current };
        delete next[field];
        return next;
      });
    };
  }

  function closeAuthorizationForm() {
    if (saving) return;
    setComposing(false);
    resetAuthorizationForm();
  }

  function openNewAuthorization() {
    resetAuthorizationForm();
    setComposing(true);
  }

  function startRenewal(authorization) {
    const dosage = splitDosage(authorization.dosage);
    const renewalStart = authorizationStartForRenewal(authorization);
    const originalStart = authorization.start_date ? parseISO(authorization.start_date) : null;
    const originalEnd = authorization.end_date ? parseISO(authorization.end_date) : null;
    const maximumDays = authorization.schedule_type === 'as_needed' ? 30 : 365;
    const originalDays = originalStart && originalEnd
      ? Math.max(1, differenceInCalendarDays(originalEnd, originalStart))
      : Math.min(30, maximumDays);
    const renewalDays = Math.min(originalDays, maximumDays);

    resetAuthorizationForm();
    setName(authorization.name || '');
    setMedicationType(authorization.medication_type || 'prescription');
    setDoseAmount(dosage.amount);
    setDoseUnit(dosage.unit);
    setRouteName(authorization.route || 'Oral');
    setScheduleType(authorization.schedule_type || 'as_needed');
    setScheduledTimes((authorization.scheduled_times || []).map((time) => String(time).slice(0, 5)));
    setSchedule(authorization.schedule || '');
    setCondition(authorization.as_needed_condition || '');
    setMaxDaily(authorization.max_daily_doses ? String(authorization.max_daily_doses) : '');
    setStartDate(format(renewalStart, 'yyyy-MM-dd'));
    setEndDate(format(addDays(renewalStart, renewalDays), 'yyyy-MM-dd'));
    setNotes(authorization.notes || '');
    setRenewingFrom(authorization);
    setViewingAuth(null);
    setComposing(true);
  }

  function chooseLabelPhoto() {
    Alert.alert('Medication label photo', 'Choose a source', [
      { text: 'Take photo', onPress: () => pickLabelPhoto('camera') },
      { text: 'Photo library', onPress: () => pickLabelPhoto('library') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  async function pickLabelPhoto(source) {
    let result;
    if (source === 'camera') {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (permission.status !== 'granted') {
        Alert.alert('Permission needed', 'Please allow camera access to photograph the medication label.');
        return;
      }
      result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        quality: 0.85,
      });
    } else {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (permission.status !== 'granted') {
        Alert.alert('Permission needed', 'Please allow photo library access to select the medication label.');
        return;
      }
      result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.85,
      });
    }
    if (!result.canceled) {
      setLabelUri(result.assets[0].uri);
      setFormErrors((current) => {
        if (!current.labelPhoto) return current;
        const next = { ...current };
        delete next.labelPhoto;
        return next;
      });
    }
  }

  async function uploadLabelPhoto(uri) {
    const resized = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: 1200 } }],
      { compress: 0.84, format: ImageManipulator.SaveFormat.JPEG }
    );
    const response = await fetch(resized.uri);
    const bytes = await response.arrayBuffer();
    const path = `${child.id}/${profile.id}/label_${Date.now()}.jpg`;
    const { error } = await supabase.storage
      .from('medication-labels')
      .upload(path, bytes, { contentType: 'image/jpeg', upsert: false });
    if (error) throw error;
    return path;
  }

  async function handleAuthorize() {
    const errors = {};
    const parsedMax = maxDaily.trim() ? Number.parseInt(maxDaily, 10) : null;
    if (!name.trim()) errors.name = 'Medication name is required.';
    if (!doseAmount.trim()) errors.doseAmount = 'Dose is required.';
    if (!doseUnit.trim()) errors.doseUnit = 'Unit is required.';
    if (!routeName) errors.route = 'Choose how the medication is given.';
    if (scheduleType === 'scheduled' && scheduledTimes.length === 0) {
      errors.scheduledTimes = 'Add at least one scheduled dose time.';
    }
    if (scheduleType === 'as_needed' && !condition.trim()) {
      errors.condition = 'Describe exactly when educators should give it.';
    }
    if (scheduleType === 'as_needed' && (!Number.isFinite(parsedMax) || parsedMax < 1 || parsedMax > 24)) {
      errors.maxDaily = 'Enter a maximum between 1 and 24 doses.';
    }
    if (!startDate) errors.startDate = 'Choose when authorization starts.';
    if (!endDate) errors.endDate = 'Choose when authorization ends.';
    if (startDate && endDate && endDate < startDate) {
      errors.endDate = 'End date must be on or after the start date.';
    } else if (
      scheduleType === 'as_needed'
      && startDate
      && endDate
      && differenceInCalendarDays(parseISO(endDate), parseISO(startDate)) > 30
    ) {
      errors.endDate = 'As-needed authorizations are limited to 30 days.';
    }
    if (!labelUri) errors.labelPhoto = 'A clear photo of the medication label is required.';
    if (!consented) errors.consented = 'Confirm the authorization before signing.';
    if (!signedName.trim()) errors.signedName = 'Your full legal name is required.';
    setFormErrors(errors);
    if (Object.keys(errors).length) return;

    setSaving(true);
    let uploadedPath = '';
    try {
      uploadedPath = await uploadLabelPhoto(labelUri);
      const authorizedAt = new Date().toISOString();
      const { error } = await supabase.from('medication_authorizations').insert({
        daycare_id: child.daycare_id || profile.daycare_id,
        child_id: child.id,
        parent_id: profile.id,
        name: name.trim(),
        dosage: `${doseAmount.trim()} ${doseUnit.trim()}`,
        route: routeName,
        medication_type: medicationType,
        schedule_type: scheduleType,
        scheduled_times: scheduleType === 'scheduled'
          ? scheduledTimes.map((time) => `${time}:00`)
          : [],
        schedule: scheduleType === 'scheduled'
          ? schedule.trim() || null
          : 'As needed',
        as_needed_condition: scheduleType === 'as_needed' ? condition.trim() : null,
        max_daily_doses: scheduleType === 'as_needed' ? parsedMax : null,
        notes: notes.trim() || null,
        start_date: startDate,
        end_date: endDate,
        label_photo_path: uploadedPath,
        signed_name: signedName.trim(),
        signed_at: authorizedAt,
        consented_at: authorizedAt,
        authorization_version: AUTHORIZATION_VERSION,
        renewed_from_id: renewingFrom?.id || null,
      });
      if (error) throw error;

      setComposing(false);
      resetAuthorizationForm();
      showToast(renewingFrom ? 'Medication renewal authorized' : 'Medication authorized', 'success');
      await load();
    } catch (error) {
      if (uploadedPath) {
        await supabase.storage.from('medication-labels').remove([uploadedPath]);
      }
      Alert.alert('Authorization failed', error.message);
    } finally {
      setSaving(false);
    }
  }

  function handleAuthorizationPress(authorization) {
    if (isStaff && authorizationState(authorization) === 'active') {
      openDoseSheet(authorization);
      return;
    }
    openAuthorizationDetail(authorization);
  }

  async function handleEndAuthorization(authorization) {
    const { error } = await supabase
      .from('medication_authorizations')
      .update({ active: false, end_date: format(new Date(), 'yyyy-MM-dd') })
      .eq('id', authorization.id);
    if (error) {
      Alert.alert('Could not end authorization', error.message);
      return;
    }
    setViewingAuth(null);
    showToast('Medication authorization ended', 'success');
    await load();
  }

  function confirmEndAuthorization(authorization) {
    Alert.alert(
      'End medication authorization?',
      `Educators will no longer be able to give ${authorization.name}. The signed record and dose history will remain available.`,
      [
        { text: 'Keep active', style: 'cancel' },
        { text: 'End authorization', style: 'destructive', onPress: () => handleEndAuthorization(authorization) },
      ]
    );
  }

  function openDoseSheet(authorization) {
    setDosingAuth(authorization);
    setDoseNotes('');
    setWitnessId('');
    setShowWitnesses(false);
    setChecks(EMPTY_CHECKS);
  }

  function closeDoseSheet() {
    if (savingDose) return;
    setDosingAuth(null);
    setDoseNotes('');
    setWitnessId('');
    setShowWitnesses(false);
    setChecks(EMPTY_CHECKS);
  }

  function toggleCheck(key) {
    if (key === 'right_dose_and_route') {
      const nextValue = !(checks.right_dose && checks.right_route);
      setChecks((current) => ({
        ...current,
        right_dose: nextValue,
        right_route: nextValue,
      }));
      return;
    }
    setChecks((current) => ({ ...current, [key]: !current[key] }));
  }

  async function handleLogDose() {
    if (!dosingAuth) return;
    const allChecked = Object.values(checks).every(Boolean);
    if (!allChecked) {
      Alert.alert('Complete safety checks', 'Confirm all five medication rights before logging the dose.');
      return;
    }
    if (!witnessId) {
      Alert.alert('Witness required', 'Choose the second staff member who verified the dose.');
      return;
    }

    setSavingDose(true);
    const notifiedAt = new Date().toISOString();
    const { error } = await supabase.from('medication_logs').insert({
      daycare_id: child.daycare_id || profile.daycare_id,
      authorization_id: dosingAuth.id,
      child_id: child.id,
      administered_by: profile.id,
      witness_id: witnessId,
      dosage_given: dosingAuth.dosage,
      route_given: dosingAuth.route || 'Not specified',
      safety_checks: checks,
      notes: doseNotes.trim() || null,
      parent_notified_at: notifiedAt,
    });

    if (error) {
      setSavingDose(false);
      Alert.alert('Could not log dose', error.message);
      return;
    }

    setSavingDose(false);
    closeDoseSheet();
    showToast('Dose logged — parents notified', 'success');
    await load();
  }

  function renderAuthorization(authorization, index) {
    const status = authorizationStatus(authorization);
    const state = authorizationState(authorization);
    const scheduledTimeText = authorization.schedule_type === 'scheduled'
      && authorization.scheduled_times?.length
      ? authorization.scheduled_times.map(displayTime).join(' & ')
      : null;
    const conditionText = scheduledTimeText
      || authorization.as_needed_condition
      || authorization.schedule;
    const details = [
      authorization.dosage,
      authorization.route,
      conditionText,
      authorization.max_daily_doses
        ? `Max ${authorization.max_daily_doses}/day`
        : null,
    ].filter(Boolean);

    return (
      <View key={authorization.id}>
        {index > 0 ? <View style={styles.divider} /> : null}
        <TouchableOpacity
          style={styles.authorizationRow}
          onPress={() => handleAuthorizationPress(authorization)}
          activeOpacity={0.72}
          accessibilityRole="button"
          accessibilityLabel={`${authorization.name}, ${details.join(', ')}`}
        >
          <MedicationThumbnail uri={labelUrls[authorization.id]} />
          <View style={styles.authorizationCopy}>
            <Text style={styles.authorizationName}>{authorization.name}</Text>
            <Text style={styles.authorizationDetails}>{details.join(' · ')}</Text>
            <View style={[styles.statusBadge, { backgroundColor: status.bg }]}>
              <Text style={[styles.statusBadgeText, { color: status.color }]}>
                {status.label}
              </Text>
            </View>
          </View>
          {isStaff && state === 'active' ? (
            <View style={styles.logDosePill}>
              <Text style={styles.logDosePillText}>Log dose</Text>
            </View>
          ) : (
            <Ionicons name="chevron-forward" size={17} color={colors.textFaint} />
          )}
        </TouchableOpacity>
        {isParent ? (
          <View style={styles.authorizationFooter}>
            <Text style={styles.authorizationFooterMuted}>
              Authorized by you · {format(new Date(authorization.signed_at || authorization.created_at), 'MMM d')}
            </Text>
            {authorization.end_date ? (
              <Text style={styles.authorizationFooterEnd}>
                Ends {format(parseISO(authorization.end_date), 'MMM d')}
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.loadingWrap}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  const classroomName = child.classroom?.name || child.classroom?.age_group || 'Classroom';
  const authorizationStart = startDate ? parseISO(startDate) : new Date();
  const maximumAuthorizationEnd = addDays(
    authorizationStart,
    scheduleType === 'as_needed' ? 30 : 365
  );

  return (
    <View style={styles.screen}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={styles.backButton}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Ionicons name="chevron-back" size={23} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Medications</Text>
          <View style={styles.headerSpacer} />
        </View>

        <View style={styles.childPill}>
          <ChildAvatar child={child} size={30} />
          <Text style={styles.childPillText}>
            {formatChildName(child)} · {classroomName}
          </Text>
        </View>

        {loadError ? (
          <View style={styles.loadErrorBanner}>
            <Ionicons name="alert-circle-outline" size={19} color={colors.danger} />
            <View style={styles.loadErrorCopy}>
              <Text style={styles.loadErrorText}>{loadError}</Text>
              <TouchableOpacity onPress={load} accessibilityRole="button">
                <Text style={styles.retryText}>Try again</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}

        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Active authorizations</Text>
            <View style={styles.countBadge}>
              <Text style={styles.countBadgeText}>{activeAuths.length}</Text>
            </View>
          </View>
          {activeAuths.length ? (
            activeAuths.map(renderAuthorization)
          ) : (
            <View style={styles.emptyState}>
              <Ionicons name="medical-outline" size={24} color={colors.textFaint} />
              <Text style={styles.emptyText}>
                {isParent
                  ? 'No active medications. Authorize one when your child needs medication at care.'
                  : 'No active medication authorizations for this child.'}
              </Text>
            </View>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>{isParent ? 'Dose history' : 'Administration history'}</Text>
          {logs.length || (isParent && upcomingDose) ? (
            <>
              {logs.map((log, index) => {
              const administeredAt = new Date(log.administered_at);
              const previous = logs[index - 1];
              const dayLabel = isToday(administeredAt)
                ? 'TODAY'
                : format(administeredAt, 'EEE, MMM d').toUpperCase();
              const showDay = index === 0
                || format(new Date(previous.administered_at), 'yyyy-MM-dd')
                  !== format(administeredAt, 'yyyy-MM-dd');

              return (
                <View key={log.id}>
                  {showDay ? <Text style={styles.dayLabel}>{dayLabel}</Text> : null}
                  <View style={styles.historyRow}>
                    <View style={styles.historyCheck}>
                      <Ionicons name="checkmark" size={13} color={colors.success} />
                    </View>
                    <View style={styles.historyCopy}>
                      <Text style={styles.historyTitle}>
                        {format(administeredAt, 'h:mm a')} — {log.authorization?.name || 'Medication'}, {' '}
                        {log.dosage_given || log.authorization?.dosage}
                      </Text>
                      <Text style={styles.historyMeta}>
                        Given by {log.administered_by_profile?.full_name || 'staff'}
                        {log.witness_profile?.full_name
                          ? ` · Witnessed by ${log.witness_profile.full_name}`
                          : ''}
                        {log.notes ? ` · ${log.notes}` : ''}
                      </Text>
                      {log.parent_notified_at ? (
                        <Text style={styles.notificationMeta}>
                          Parent notified at {format(new Date(log.parent_notified_at), 'h:mm a')}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                </View>
              );
              })}
              {isParent && upcomingDose ? (
                <View style={styles.upcomingRow}>
                  <View style={styles.upcomingClock}>
                    <Ionicons name="time-outline" size={16} color={colors.textFaint} />
                  </View>
                  <View style={styles.historyCopy}>
                    <Text style={styles.historyTitle}>
                      {isToday(upcomingDose.at)
                        ? 'Today'
                        : isTomorrow(upcomingDose.at)
                          ? 'Tomorrow'
                          : format(upcomingDose.at, 'EEE, MMM d')}
                      {' · '}{format(upcomingDose.at, 'h:mm a')}
                    </Text>
                    <Text style={styles.historyMeta}>
                      Upcoming — {upcomingDose.authorization.name}
                      {upcomingDose.authorization.schedule
                        ? ` · ${upcomingDose.authorization.schedule}`
                        : ''}
                    </Text>
                  </View>
                </View>
              ) : null}
              {hasOlderLogs ? (
                <TouchableOpacity
                  style={styles.loadOlderButton}
                  onPress={loadOlderLogs}
                  disabled={loadingOlderLogs}
                  accessibilityRole="button"
                >
                  {loadingOlderLogs ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : (
                    <Text style={styles.loadOlderText}>Load older doses</Text>
                  )}
                </TouchableOpacity>
              ) : null}
            </>
          ) : (
            <View style={styles.emptyState}>
              <Ionicons name="time-outline" size={24} color={colors.textFaint} />
              <Text style={styles.emptyText}>No doses have been logged yet.</Text>
            </View>
          )}
        </View>

        {upcomingAuths.length ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Upcoming authorizations</Text>
            <Text style={styles.cardHint}>
              Renewals appear here until their start date. Educators cannot log a dose early.
            </Text>
            {upcomingAuths.map(renderAuthorization)}
          </View>
        ) : null}

        {pastAuths.length ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Past authorizations</Text>
            {pastAuths.map((authorization, index) => (
              <View key={authorization.id}>
                {index > 0 ? <View style={styles.divider} /> : null}
                <TouchableOpacity
                  style={styles.pastRow}
                  onPress={() => openAuthorizationDetail(authorization)}
                  accessibilityRole="button"
                >
                  <Ionicons name="archive-outline" size={18} color={colors.textFaint} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.pastName}>{authorization.name}</Text>
                    <Text style={styles.pastMeta}>
                      {authorization.dosage}
                      {authorization.end_date
                        ? ` · Ended ${format(parseISO(authorization.end_date), 'MMM d, yyyy')}`
                        : ''}
                    </Text>
                  </View>
                  <Text style={styles.viewLink}>View</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        ) : null}

        {isParent ? (
          <TouchableOpacity
            style={styles.authorizeNewButton}
            onPress={openNewAuthorization}
            accessibilityRole="button"
          >
            <Ionicons name="add" size={19} color={colors.primary} />
            <Text style={styles.authorizeNewButtonText}>Authorize a new medication</Text>
          </TouchableOpacity>
        ) : null}

        <Text style={styles.footerNote}>
          {isParent
            ? `Only ${classroomName} educators can log doses. Every dose is time-stamped, witnessed by a second staff member, and sent to you instantly.`
            : 'Every dose requires the five-rights safety check and a second staff witness. Parents are notified immediately.'}
        </Text>
      </ScrollView>

      <Modal
        visible={Boolean(viewingAuth)}
        transparent
        animationType="slide"
        onRequestClose={() => setViewingAuth(null)}
      >
        <View style={styles.overlay}>
          <TouchableOpacity
            style={styles.overlayDismiss}
            activeOpacity={1}
            onPress={() => setViewingAuth(null)}
          />
          <ScrollView
            style={styles.sheet}
            contentContainerStyle={styles.sheetContent}
            showsVerticalScrollIndicator={false}
          >
            <SheetHeader title="Medication authorization" onClose={() => setViewingAuth(null)} />
            {viewingAuth ? (
              <>
                <View style={styles.detailHero}>
                  <MedicationThumbnail uri={labelUrls[viewingAuth.id]} size={62} />
                  <View style={styles.detailHeroCopy}>
                    <Text style={styles.detailTitle}>{viewingAuth.name}</Text>
                    <Text style={styles.detailSubtitle}>
                      {viewingAuth.medication_type === 'over_the_counter'
                        ? 'Over-the-counter'
                        : 'Prescription'}
                    </Text>
                    {(() => {
                      const status = authorizationStatus(viewingAuth);
                      return (
                        <View style={[styles.statusBadge, { backgroundColor: status.bg }]}>
                          <Text style={[styles.statusBadgeText, { color: status.color }]}>{status.label}</Text>
                        </View>
                      );
                    })()}
                  </View>
                </View>

                {labelUrls[viewingAuth.id] ? (
                  <View style={styles.labelEvidenceCard}>
                    <Text style={styles.sectionLabel}>SIGNED LABEL PHOTO</Text>
                    <Image source={{ uri: labelUrls[viewingAuth.id] }} style={styles.detailLabelImage} resizeMode="contain" />
                    <Text style={styles.evidenceHint}>This image is locked with the signed authorization.</Text>
                  </View>
                ) : null}

                <View style={styles.detailCard}>
                  <DetailRow label="Dose" value={viewingAuth.dosage} />
                  <DetailRow label="Route" value={viewingAuth.route} />
                  <DetailRow
                    label="When to give"
                    value={viewingAuth.schedule_type === 'scheduled'
                      ? [
                          (viewingAuth.scheduled_times || []).map(displayTime).join(' & '),
                          viewingAuth.schedule,
                        ].filter(Boolean).join(' · ')
                      : viewingAuth.as_needed_condition || viewingAuth.schedule}
                  />
                  <DetailRow
                    label="Daily limit"
                    value={viewingAuth.max_daily_doses ? `${viewingAuth.max_daily_doses} doses` : null}
                  />
                  <DetailRow label="Instructions" value={viewingAuth.notes} />
                  <DetailRow
                    label="Valid dates"
                    value={`${format(parseISO(viewingAuth.start_date), 'MMM d, yyyy')} – ${format(parseISO(viewingAuth.end_date), 'MMM d, yyyy')}`}
                  />
                </View>

                <View style={styles.signatureCard}>
                  <View style={styles.signatureIcon}>
                    <Ionicons name="create-outline" size={20} color={colors.primary} />
                  </View>
                  <View style={styles.signatureCopy}>
                    <Text style={styles.signatureTitle}>Signed by {viewingAuth.signed_name || viewingAuth.parent?.full_name || 'parent'}</Text>
                    <Text style={styles.signatureMeta}>
                      {viewingAuth.signed_at
                        ? format(new Date(viewingAuth.signed_at), "MMM d, yyyy 'at' h:mm a")
                        : 'Signature date unavailable'}
                      {viewingAuth.authorization_version ? ` · version ${viewingAuth.authorization_version}` : ''}
                    </Text>
                    {viewingAuth.ended_at ? (
                      <Text style={styles.endedMeta}>
                        Ended {format(new Date(viewingAuth.ended_at), "MMM d, yyyy 'at' h:mm a")}
                      </Text>
                    ) : null}
                  </View>
                </View>

                <Text style={styles.sectionLabel}>DOSE HISTORY</Text>
                <View style={styles.detailCard}>
                  {viewingLogsLoading && !viewingLogs.length ? (
                    <ActivityIndicator color={colors.primary} />
                  ) : viewingLogs.length ? viewingLogs.map((log, index) => (
                    <View key={log.id} style={[styles.detailDoseRow, index > 0 && styles.detailDoseBorder]}>
                      <View style={styles.historyCheck}>
                        <Ionicons name="checkmark" size={13} color={colors.success} />
                      </View>
                      <View style={styles.historyCopy}>
                        <Text style={styles.historyTitle}>
                          {format(new Date(log.administered_at), "MMM d '·' h:mm a")} · {log.dosage_given || viewingAuth.dosage}
                        </Text>
                        <Text style={styles.historyMeta}>
                          Given by {log.administered_by_profile?.full_name || 'staff'}
                          {log.notes ? ` · ${log.notes}` : ''}
                        </Text>
                      </View>
                    </View>
                  )) : (
                    <Text style={styles.detailEmptyText}>No doses were logged under this authorization.</Text>
                  )}
                  {viewingLogsHasMore ? (
                    <TouchableOpacity
                      style={styles.detailLoadOlderButton}
                      onPress={loadOlderAuthorizationLogs}
                      disabled={viewingLogsLoading}
                      accessibilityRole="button"
                    >
                      {viewingLogsLoading ? (
                        <ActivityIndicator size="small" color={colors.primary} />
                      ) : (
                        <Text style={styles.loadOlderText}>Load older doses</Text>
                      )}
                    </TouchableOpacity>
                  ) : null}
                </View>

                {isParent && canRenewAuthorization(viewingAuth) ? (
                  <TouchableOpacity style={styles.renewButton} onPress={() => startRenewal(viewingAuth)}>
                    <Ionicons name="refresh" size={18} color={colors.white} />
                    <Text style={styles.renewButtonText}>Renew authorization</Text>
                  </TouchableOpacity>
                ) : null}
                {isParent && viewingAuth.active ? (
                  <TouchableOpacity style={styles.endButton} onPress={() => confirmEndAuthorization(viewingAuth)}>
                    <Text style={styles.endButtonText}>End authorization</Text>
                  </TouchableOpacity>
                ) : null}
              </>
            ) : null}
          </ScrollView>
        </View>
      </Modal>

      <Modal
        visible={composing}
        transparent
        animationType="slide"
        onRequestClose={closeAuthorizationForm}
      >
        <KeyboardAvoidingView
          style={styles.overlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <TouchableOpacity
            style={styles.overlayDismiss}
            activeOpacity={1}
            onPress={closeAuthorizationForm}
          />
          <KeyboardAwareScrollView
            style={styles.sheet}
            contentContainerStyle={styles.sheetContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <SheetHeader
              title={renewingFrom ? 'Renew medication' : 'Authorize medication'}
              onClose={closeAuthorizationForm}
            />

            {renewingFrom ? (
              <View style={styles.renewalNotice}>
                <Ionicons name="refresh-circle-outline" size={22} color={colors.primary} />
                <Text style={styles.renewalNoticeText}>
                  Details were copied from the previous authorization. Review every field, add a current label photo, and sign again. The renewal starts after the existing authorization ends.
                </Text>
              </View>
            ) : null}

            <View style={styles.childSummary}>
              <ChildAvatar child={child} size={36} />
              <View style={{ flex: 1 }}>
                <Text style={styles.childSummaryName}>{formatChildName(child)}</Text>
                <Text style={styles.childSummaryMeta}>{classroomName}</Text>
              </View>
            </View>

            <Input
              label="Medication name (required)"
              value={name}
              onChangeText={updateFormField('name', setName)}
              placeholder="e.g. Tylenol Children's"
              error={formErrors.name}
            />

            <Text style={styles.fieldLabel}>Type</Text>
            <ChoiceRow
              options={MEDICATION_TYPES}
              value={medicationType}
              onChange={updateFormField('medicationType', setMedicationType)}
            />

            <View style={styles.twoColumnRow}>
              <Input
                label="Dose (required)"
                value={doseAmount}
                onChangeText={updateFormField('doseAmount', setDoseAmount)}
                placeholder="e.g. 5"
                keyboardType="decimal-pad"
                error={formErrors.doseAmount}
                style={styles.columnField}
              />
              <Input
                label="Unit (required)"
                value={doseUnit}
                onChangeText={updateFormField('doseUnit', setDoseUnit)}
                placeholder="ml"
                error={formErrors.doseUnit}
                style={styles.columnField}
              />
            </View>

            <Text style={styles.fieldLabel}>Route (required)</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={[
                styles.routeRow,
                formErrors.route && styles.routeRowError,
              ]}
            >
              {ROUTES.map((routeOption) => (
                <TouchableOpacity
                  key={routeOption}
                  onPress={() => updateFormField('route', setRouteName)(routeOption)}
                  style={[
                    styles.routeChip,
                    routeOption === routeName && styles.routeChipSelected,
                  ]}
                >
                  <Text
                    style={[
                      styles.routeChipText,
                      routeOption === routeName && styles.routeChipTextSelected,
                    ]}
                  >
                    {routeOption}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            {formErrors.route ? <Text style={styles.formErrorText}>{formErrors.route}</Text> : null}

            <Text style={styles.fieldLabel}>When to give</Text>
            <ChoiceRow
              options={SCHEDULE_TYPES}
              value={scheduleType}
              onChange={(value) => {
                updateFormField('scheduleType', setScheduleType)(value);
                setFormErrors((current) => {
                  const next = { ...current };
                  delete next.scheduledTimes;
                  delete next.condition;
                  delete next.maxDaily;
                  return next;
                });
                if (value === 'as_needed') {
                  const latest = format(addDays(parseISO(startDate), 30), 'yyyy-MM-dd');
                  if (endDate > latest) setEndDate(latest);
                }
              }}
            />

            {scheduleType === 'scheduled' ? (
              <>
                <ScheduledTimesField
                  times={scheduledTimes}
                  onChange={updateFormField('scheduledTimes', setScheduledTimes)}
                  error={formErrors.scheduledTimes}
                />
                <Input
                  label="Directions"
                  value={schedule}
                  onChangeText={setSchedule}
                  placeholder="e.g. Give with food"
                />
              </>
            ) : (
              <>
                <Input
                  label="Give when (required)"
                  value={condition}
                  onChangeText={updateFormField('condition', setCondition)}
                  placeholder="e.g. Fever above 38.5°C"
                  error={formErrors.condition}
                />
                <Input
                  label="Maximum doses per day (required)"
                  value={maxDaily}
                  onChangeText={updateFormField('maxDaily', setMaxDaily)}
                  placeholder="e.g. 3"
                  keyboardType="number-pad"
                  error={formErrors.maxDaily}
                />
              </>
            )}

            <View style={styles.twoColumnRow}>
              <DatePickerField
                label="Starts"
                value={startDate}
                onChange={(value) => {
                  updateFormField('startDate', setStartDate)(value);
                  if (endDate < value) setEndDate(value);
                }}
                minimumDate={new Date()}
                maximumDate={addDays(new Date(), 365)}
                error={formErrors.startDate}
                style={styles.columnField}
              />
              <DatePickerField
                label="Ends (required)"
                value={endDate}
                onChange={updateFormField('endDate', setEndDate)}
                minimumDate={authorizationStart}
                maximumDate={maximumAuthorizationEnd}
                error={formErrors.endDate}
                style={styles.columnField}
              />
            </View>
            <Text style={styles.authorizationHint}>
              Authorizations expire automatically. As-needed medications are limited to 30 days and must be renewed.
            </Text>
            <Input
              label="Storage and other instructions"
              value={notes}
              onChangeText={setNotes}
              placeholder="Where it is kept, side effects to watch..."
              multiline
            />

            <Text style={styles.fieldLabel}>Medication label photo (required)</Text>
            <TouchableOpacity
              onPress={chooseLabelPhoto}
              style={[
                styles.labelPhotoPicker,
                formErrors.labelPhoto && styles.fieldBoxError,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Add medication label photo"
            >
              {labelUri ? (
                <Image source={{ uri: labelUri }} style={styles.labelPreview} />
              ) : (
                <>
                  <View style={styles.labelPhotoIcon}>
                    <Ionicons name="camera-outline" size={24} color={colors.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.labelPhotoTitle}>Photograph the full label</Text>
                    <Text style={styles.labelPhotoHint}>
                      The child name, medication, dose, and directions must be readable.
                    </Text>
                  </View>
                  <Ionicons name="add-circle-outline" size={22} color={colors.primary} />
                </>
              )}
            </TouchableOpacity>
            {formErrors.labelPhoto ? <Text style={styles.formErrorText}>{formErrors.labelPhoto}</Text> : null}

            <TouchableOpacity
              style={[
                styles.consentRow,
                formErrors.consented && styles.consentRowError,
              ]}
              onPress={() => {
                setConsented((value) => !value);
                setFormErrors((current) => {
                  if (!current.consented) return current;
                  const next = { ...current };
                  delete next.consented;
                  return next;
                });
              }}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: consented }}
            >
              <View style={[styles.consentCheckbox, consented && styles.consentCheckboxChecked]}>
                {consented ? <Ionicons name="checkmark" size={15} color={colors.white} /> : null}
              </View>
              <Text style={styles.consentText}>
                I authorize {classroomName} educators to give this medication to <Text style={styles.consentStrong}>{child.first_name}</Text> exactly as described. Each dose will be logged and I’ll be notified immediately.
              </Text>
            </TouchableOpacity>
            {formErrors.consented ? <Text style={styles.formErrorText}>{formErrors.consented}</Text> : null}
            <Input
              label="Full legal name (required)"
              value={signedName}
              onChangeText={updateFormField('signedName', setSignedName)}
              placeholder={profile?.full_name || 'Type your name'}
              autoCapitalize="words"
              error={formErrors.signedName}
            />
            <Text style={styles.signatureLegalText}>
              Typing your name records an electronic signature with the authorization version and timestamp.
            </Text>

            <Button
              label="Authorize medication"
              onPress={handleAuthorize}
              loading={saving}
              style={styles.sheetSubmit}
            />
          </KeyboardAwareScrollView>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={!!dosingAuth}
        transparent
        animationType="slide"
        onRequestClose={closeDoseSheet}
      >
        <KeyboardAvoidingView
          style={styles.overlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <TouchableOpacity
            style={styles.overlayDismiss}
            activeOpacity={1}
            onPress={closeDoseSheet}
          />
          <KeyboardAwareScrollView
            style={styles.sheet}
            contentContainerStyle={styles.sheetContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <SheetHeader title="Log a dose" onClose={closeDoseSheet} />

            <View style={styles.doseSummary}>
              <MedicationThumbnail uri={labelUrls[dosingAuth?.id]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.doseSummaryTitle}>
                  {dosingAuth?.name} — {dosingAuth?.dosage}, {dosingAuth?.route || 'route not set'}
                </Text>
                <Text style={styles.doseSummaryMeta}>
                  {formatChildName(child)} · Authorized by {dosingAuth?.parent?.full_name || 'parent'}
                  {dosingAuth?.end_date
                    ? ` until ${format(parseISO(dosingAuth.end_date), 'MMM d')}`
                    : ''}
                </Text>
              </View>
            </View>

            <Text style={styles.sectionLabel}>SAFETY CHECKS</Text>
            <View style={styles.safetyCard}>
              <SafetyCheckRow
                checked={checks.right_child}
                label={`Right child — ${child.first_name} ${child.last_name?.[0] || ''}.`}
                onPress={() => toggleCheck('right_child')}
              />
              <SafetyCheckRow
                checked={checks.right_medication}
                label="Right medication — matches label photo"
                onPress={() => toggleCheck('right_medication')}
              />
              <SafetyCheckRow
                checked={checks.right_dose && checks.right_route}
                label={`Right dose & route — ${dosingAuth?.dosage}, ${dosingAuth?.route || 'not specified'}`}
                onPress={() => toggleCheck('right_dose_and_route')}
              />
              <SafetyCheckRow
                checked={checks.right_time}
                label={`Right time — now, ${format(new Date(), 'h:mm a')}`}
                onPress={() => toggleCheck('right_time')}
                last
              />
            </View>

            <View style={styles.infoRow}>
              <Text style={styles.infoRowLabel}>Time given</Text>
              <View style={styles.timeBadge}>
                <Text style={styles.timeBadgeText}>Now · {format(new Date(), 'h:mm a')}</Text>
              </View>
            </View>

            <TouchableOpacity
              style={styles.infoRow}
              onPress={() => setShowWitnesses((current) => !current)}
              accessibilityRole="button"
            >
              <Text style={styles.infoRowLabel}>
                Witness <Text style={styles.requiredText}>(required)</Text>
              </Text>
              <View style={styles.witnessValue}>
                {selectedWitness ? (
                  <View style={styles.witnessAvatar}>
                    <Text style={styles.witnessAvatarText}>
                      {initials(selectedWitness.full_name)}
                    </Text>
                  </View>
                ) : null}
                <Text style={[
                  styles.witnessName,
                  !selectedWitness && { color: colors.textFaint },
                ]}>
                  {selectedWitness?.full_name || 'Choose staff'}
                </Text>
                <Ionicons
                  name={showWitnesses ? 'chevron-up' : 'chevron-down'}
                  size={15}
                  color={colors.textFaint}
                />
              </View>
            </TouchableOpacity>

            {showWitnesses ? (
              <View style={styles.witnessPicker}>
                {availableWitnesses.map((member, index) => (
                  <TouchableOpacity
                    key={member.id}
                    style={[
                      styles.witnessOption,
                      index > 0 && { borderTopWidth: 1, borderTopColor: colors.borderSoft },
                    ]}
                    onPress={() => {
                      setWitnessId(member.id);
                      setShowWitnesses(false);
                    }}
                  >
                    <View style={styles.witnessAvatar}>
                      <Text style={styles.witnessAvatarText}>{initials(member.full_name)}</Text>
                    </View>
                    <Text style={styles.witnessOptionName}>{member.full_name}</Text>
                    {witnessId === member.id ? (
                      <Ionicons name="checkmark-circle" size={20} color={colors.primary} />
                    ) : null}
                  </TouchableOpacity>
                ))}
              </View>
            ) : null}

            <Input
              label="Note for parents"
              value={doseNotes}
              onChangeText={setDoseNotes}
              placeholder="e.g. Fever 38.7°C before dose"
              multiline
            />

            <Button
              label="Log dose & notify parents"
              onPress={handleLogDose}
              loading={savingDose}
              style={styles.sheetSubmit}
            />
            <Text style={styles.sheetFooter}>
              The family receives an instant notification with the time, dose, witness, and your note.
            </Text>
          </KeyboardAwareScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

function SafetyCheckRow({ checked, label, onPress, last }) {
  return (
    <TouchableOpacity
      style={[styles.safetyRow, last && { borderBottomWidth: 0 }]}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
    >
      <View style={[styles.checkCircle, checked && styles.checkCircleDone]}>
        {checked ? (
          <Ionicons name="checkmark" size={13} color={colors.success} />
        ) : null}
      </View>
      <Text style={styles.safetyText}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  container: { flex: 1 },
  content: {
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.md,
    paddingBottom: 56,
  },
  loadingWrap: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backButton: {
    width: 42,
    height: 42,
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontFamily: fonts.black,
    color: colors.textPrimary,
  },
  headerSpacer: { width: 42 },
  childPill: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 6,
    paddingLeft: 6,
    paddingRight: spacing.lg,
    marginTop: spacing.md,
    marginBottom: spacing.lg,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  childPillText: {
    fontSize: 13.5,
    fontFamily: fonts.bold,
    color: colors.textPrimary,
  },
  loadErrorBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.dangerLight,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  loadErrorText: {
    color: colors.danger,
    fontSize: 12.5,
    lineHeight: 18,
    fontFamily: fonts.bold,
  },
  loadErrorCopy: { flex: 1, gap: spacing.xs },
  retryText: { color: colors.primary, fontSize: 12.5, fontFamily: fonts.bold },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 18,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  cardTitle: {
    fontSize: 15,
    fontFamily: fonts.black,
    color: colors.textPrimary,
  },
  cardHint: {
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
    fontSize: 12,
    lineHeight: 17,
    fontFamily: fonts.regular,
    color: colors.textFaint,
  },
  countBadge: {
    minWidth: 28,
    height: 24,
    paddingHorizontal: 9,
    borderRadius: radius.full,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countBadgeText: {
    fontSize: 12,
    fontFamily: fonts.bold,
    color: colors.primary,
  },
  authorizationRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  medicationPlaceholder: {
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  authorizationCopy: { flex: 1, minWidth: 0 },
  authorizationName: {
    fontSize: 14.5,
    fontFamily: fonts.bold,
    color: colors.textPrimary,
  },
  authorizationDetails: {
    fontSize: 12.5,
    lineHeight: 18,
    fontFamily: fonts.regular,
    color: colors.textMuted,
    marginTop: 3,
  },
  statusBadge: {
    alignSelf: 'flex-start',
    borderRadius: radius.full,
    paddingVertical: 3,
    paddingHorizontal: 10,
    marginTop: 7,
  },
  statusBadgeText: {
    fontSize: 11.5,
    fontFamily: fonts.bold,
  },
  authorizationFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.borderSoft,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
  authorizationFooterMuted: {
    flex: 1,
    color: colors.textFaint,
    fontSize: 11.5,
    fontFamily: fonts.regular,
  },
  authorizationFooterEnd: {
    color: colors.amber,
    fontSize: 11.5,
    fontFamily: fonts.regular,
  },
  logDosePill: {
    alignSelf: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    paddingVertical: 8,
    paddingHorizontal: 11,
  },
  logDosePillText: {
    fontSize: 11.5,
    fontFamily: fonts.bold,
    color: colors.white,
  },
  divider: {
    height: 1,
    backgroundColor: colors.borderSoft,
  },
  emptyState: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
  },
  emptyText: {
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    fontFamily: fonts.regular,
    color: colors.textMuted,
  },
  dayLabel: {
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    fontSize: 11,
    letterSpacing: 0.8,
    fontFamily: fonts.bold,
    color: colors.textFaint,
  },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  historyCheck: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.successLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  historyCopy: { flex: 1 },
  historyTitle: {
    fontSize: 13.5,
    lineHeight: 19,
    fontFamily: fonts.bold,
    color: colors.textPrimary,
  },
  historyMeta: {
    marginTop: 2,
    fontSize: 12.5,
    lineHeight: 18,
    fontFamily: fonts.regular,
    color: colors.textMuted,
  },
  notificationMeta: {
    marginTop: 2,
    fontSize: 12,
    fontFamily: fonts.regular,
    color: colors.textFaint,
  },
  upcomingRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.borderSoft,
    paddingTop: spacing.md,
    marginTop: spacing.md,
  },
  upcomingClock: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  loadOlderButton: {
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderTopWidth: 1,
    borderTopColor: colors.borderSoft,
    marginTop: spacing.md,
    paddingTop: spacing.md,
  },
  loadOlderText: {
    color: colors.primary,
    fontSize: 12.5,
    fontFamily: fonts.bold,
  },
  pastRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  pastName: {
    fontSize: 14,
    fontFamily: fonts.bold,
    color: colors.textMuted,
  },
  pastMeta: {
    marginTop: 2,
    fontSize: 12,
    fontFamily: fonts.regular,
    color: colors.textFaint,
  },
  viewLink: { color: colors.primary, fontSize: 12.5, fontFamily: fonts.bold },
  authorizeNewButton: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.primaryLight,
    marginBottom: spacing.lg,
  },
  authorizeNewButtonText: {
    color: colors.primary,
    fontSize: 14.5,
    fontFamily: fonts.bold,
  },
  footerNote: {
    paddingHorizontal: spacing.lg,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
    fontFamily: fonts.regular,
    color: colors.textFaint,
  },
  detailHero: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    padding: spacing.lg, borderRadius: radius.lg,
    backgroundColor: colors.surface, borderWidth: 1.5,
    borderColor: colors.border, marginBottom: spacing.md,
  },
  detailHeroCopy: { flex: 1, minWidth: 0 },
  detailTitle: { color: colors.textPrimary, fontSize: 18, fontFamily: fonts.black },
  detailSubtitle: { color: colors.textMuted, fontSize: 12.5, fontFamily: fonts.regular, marginTop: 2 },
  labelEvidenceCard: {
    backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border,
    borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.md,
  },
  detailLabelImage: { width: '100%', height: 190, borderRadius: radius.md, backgroundColor: colors.bg },
  evidenceHint: { color: colors.textFaint, fontSize: 11.5, lineHeight: 16, fontFamily: fonts.regular, marginTop: spacing.sm },
  detailCard: {
    backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border,
    borderRadius: radius.lg, paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  detailRow: {
    flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between',
    gap: spacing.lg, paddingVertical: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.borderSoft,
  },
  detailLabel: { color: colors.textFaint, fontSize: 12.5, fontFamily: fonts.bold },
  detailValue: { flex: 1, color: colors.textPrimary, fontSize: 12.5, lineHeight: 18, textAlign: 'right', fontFamily: fonts.regular },
  signatureIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  signatureMeta: { color: colors.textSecondary, fontSize: 11.5, lineHeight: 16, fontFamily: fonts.regular, marginTop: 2 },
  endedMeta: { color: colors.amber, fontSize: 11.5, lineHeight: 16, fontFamily: fonts.bold, marginTop: 4 },
  detailDoseRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, paddingVertical: spacing.md },
  detailDoseBorder: { borderTopWidth: 1, borderTopColor: colors.borderSoft },
  detailEmptyText: { color: colors.textMuted, fontSize: 12.5, textAlign: 'center', fontFamily: fonts.regular, paddingVertical: spacing.xl },
  detailLoadOlderButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderTopWidth: 1,
    borderTopColor: colors.borderSoft,
  },
  renewButton: {
    minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: spacing.sm, borderRadius: radius.md, backgroundColor: colors.primary,
    marginTop: spacing.xs,
  },
  renewButtonText: { color: colors.white, fontSize: 14.5, fontFamily: fonts.bold },
  endButton: {
    minHeight: 50, alignItems: 'center', justifyContent: 'center',
    borderRadius: radius.md, borderWidth: 1.5, borderColor: '#F1DADA',
    backgroundColor: '#FDF6F6', marginTop: spacing.sm,
  },
  endButtonText: { color: colors.danger, fontSize: 14, fontFamily: fonts.bold },
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(23,51,91,0.48)',
  },
  overlayDismiss: { flex: 1 },
  sheet: {
    maxHeight: '92%',
    backgroundColor: colors.bg,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
  },
  sheetContent: {
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.md,
    paddingBottom: 44,
  },
  renewalNotice: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md,
    padding: spacing.md, borderRadius: radius.lg,
    backgroundColor: colors.primaryLight, marginBottom: spacing.lg,
  },
  renewalNoticeText: { flex: 1, color: colors.textSecondary, fontSize: 12.5, lineHeight: 18, fontFamily: fonts.regular },
  grabber: {
    width: 44,
    height: 5,
    alignSelf: 'center',
    borderRadius: radius.full,
    backgroundColor: colors.border,
    marginBottom: spacing.sm,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.lg,
  },
  sheetTitle: {
    fontSize: 21,
    fontFamily: fonts.black,
    color: colors.textPrimary,
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  childSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.primaryLight,
    marginBottom: spacing.lg,
  },
  childSummaryName: {
    fontSize: 14.5,
    fontFamily: fonts.bold,
    color: colors.textPrimary,
  },
  childSummaryMeta: {
    marginTop: 2,
    fontSize: 12.5,
    fontFamily: fonts.regular,
    color: colors.textSecondary,
  },
  fieldLabel: {
    marginBottom: spacing.sm,
    fontSize: 13.5,
    fontFamily: fonts.bold,
    color: colors.textPrimary,
  },
  requiredMark: { color: colors.danger },
  choiceRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  choiceButton: {
    flex: 1,
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.full,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.sm,
  },
  choiceButtonSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  choiceButtonError: { borderColor: colors.danger },
  choiceButtonText: {
    color: colors.textSecondary,
    fontSize: 12.5,
    textAlign: 'center',
    fontFamily: fonts.bold,
  },
  choiceButtonTextSelected: { color: colors.white },
  twoColumnRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  columnField: { flex: 1, minWidth: 0 },
  scheduledTimesWrap: { marginBottom: spacing.md },
  scheduledTimesBox: {
    minHeight: 52,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    padding: spacing.sm,
  },
  scheduledTimeChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  scheduledTimeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: radius.full,
    backgroundColor: colors.primaryLight,
    paddingHorizontal: spacing.sm,
    paddingVertical: 7,
  },
  scheduledTimeText: {
    color: colors.primary,
    fontSize: 12.5,
    fontFamily: fonts.bold,
  },
  addTimeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: radius.full,
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingHorizontal: spacing.sm,
    paddingVertical: 7,
  },
  addTimeText: {
    color: colors.primary,
    fontSize: 12.5,
    fontFamily: fonts.bold,
  },
  fieldBoxError: {
    borderColor: colors.danger,
    backgroundColor: colors.dangerLight,
  },
  formErrorText: {
    color: colors.danger,
    fontSize: 11.5,
    lineHeight: 16,
    fontFamily: fonts.regular,
    marginTop: -spacing.sm,
    marginBottom: spacing.md,
  },
  routeRowError: {
    borderWidth: 1.5,
    borderColor: colors.danger,
    borderRadius: radius.md,
    backgroundColor: colors.dangerLight,
    padding: spacing.sm,
    marginBottom: spacing.sm,
  },
  routeRow: {
    paddingBottom: spacing.md,
    gap: spacing.sm,
  },
  routeChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radius.full,
    backgroundColor: colors.primarySoft,
    borderWidth: 1.5,
    borderColor: colors.primarySoft,
  },
  routeChipSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  routeChipText: {
    fontSize: 12.5,
    fontFamily: fonts.bold,
    color: colors.textSecondary,
  },
  routeChipTextSelected: { color: colors.white },
  authorizationHint: {
    color: colors.textFaint,
    fontSize: 11.5,
    lineHeight: 17,
    fontFamily: fonts.regular,
    marginTop: -spacing.sm,
    marginBottom: spacing.md,
  },
  labelPhotoPicker: {
    minHeight: 94,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    padding: spacing.md,
    marginBottom: spacing.lg,
    overflow: 'hidden',
  },
  labelPhotoIcon: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  labelPreview: {
    width: '100%',
    height: 140,
    borderRadius: radius.md,
  },
  labelPhotoTitle: {
    fontSize: 13.5,
    fontFamily: fonts.bold,
    color: colors.textPrimary,
  },
  labelPhotoHint: {
    marginTop: 3,
    fontSize: 12,
    lineHeight: 17,
    fontFamily: fonts.regular,
    color: colors.textMuted,
  },
  signatureCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.primaryLight,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  signatureTitle: {
    fontSize: 13.5,
    fontFamily: fonts.bold,
    color: colors.textPrimary,
  },
  signatureCopy: {
    flex: 1,
    minWidth: 0,
  },
  consentRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    borderWidth: 1.5,
    borderColor: 'transparent',
    borderRadius: radius.md,
    padding: spacing.sm,
    marginBottom: spacing.md,
  },
  consentRowError: {
    borderColor: colors.danger,
    backgroundColor: colors.dangerLight,
  },
  consentCheckbox: {
    width: 23,
    height: 23,
    flexShrink: 0,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  consentCheckboxChecked: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  consentText: {
    flex: 1,
    color: colors.textSecondary,
    fontSize: 12.5,
    lineHeight: 18,
    fontFamily: fonts.regular,
  },
  consentStrong: {
    color: colors.textPrimary,
    fontFamily: fonts.bold,
  },
  signatureLegalText: {
    color: colors.textFaint,
    fontSize: 11.5,
    lineHeight: 17,
    fontFamily: fonts.regular,
    marginTop: -spacing.sm,
    marginBottom: spacing.md,
  },
  sheetSubmit: { marginTop: spacing.sm },
  doseSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.primaryLight,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  doseSummaryTitle: {
    fontSize: 14.5,
    lineHeight: 19,
    fontFamily: fonts.bold,
    color: colors.textPrimary,
  },
  doseSummaryMeta: {
    marginTop: 3,
    fontSize: 12,
    lineHeight: 17,
    fontFamily: fonts.regular,
    color: colors.textSecondary,
  },
  sectionLabel: {
    marginBottom: spacing.sm,
    fontSize: 11.5,
    letterSpacing: 0.9,
    fontFamily: fonts.bold,
    color: colors.textFaint,
  },
  safetyCard: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    overflow: 'hidden',
    marginBottom: spacing.md,
  },
  safetyRow: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSoft,
  },
  checkCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.8,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkCircleDone: {
    backgroundColor: colors.successLight,
    borderColor: colors.successLight,
  },
  safetyText: {
    flex: 1,
    fontSize: 13.5,
    lineHeight: 19,
    fontFamily: fonts.regular,
    color: colors.textPrimary,
  },
  infoRow: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    marginBottom: spacing.md,
  },
  infoRowLabel: {
    fontSize: 14,
    fontFamily: fonts.regular,
    color: colors.textPrimary,
  },
  requiredText: {
    fontSize: 12,
    color: colors.textFaint,
  },
  timeBadge: {
    borderRadius: radius.full,
    backgroundColor: colors.primaryLight,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  timeBadgeText: {
    fontSize: 12.5,
    fontFamily: fonts.bold,
    color: colors.primary,
  },
  witnessValue: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing.sm,
  },
  witnessAvatar: {
    width: 27,
    height: 27,
    borderRadius: 14,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  witnessAvatarText: {
    fontSize: 10.5,
    fontFamily: fonts.bold,
    color: colors.primary,
  },
  witnessName: {
    maxWidth: 130,
    fontSize: 13,
    fontFamily: fonts.bold,
    color: colors.textPrimary,
  },
  witnessPicker: {
    marginTop: -spacing.sm,
    marginBottom: spacing.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  witnessOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  witnessOptionName: {
    flex: 1,
    fontSize: 13.5,
    fontFamily: fonts.bold,
    color: colors.textPrimary,
  },
  sheetFooter: {
    marginTop: spacing.sm,
    paddingHorizontal: spacing.lg,
    textAlign: 'center',
    fontSize: 12,
    lineHeight: 17,
    fontFamily: fonts.regular,
    color: colors.textFaint,
  },
});
