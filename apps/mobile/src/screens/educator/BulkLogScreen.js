import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  ActivityIndicator,
  Image,
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
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { format } from 'date-fns';

import { ChildAvatar } from '../../components/ChildAvatar';
import { useAuth } from '../../hooks/useAuth';
import { useClassroom } from '../../hooks/useClassroom';
import { getPhotoConsentStatuses } from '../../hooks/useStaffVisibility';
import { supabase } from '../../lib/supabase';
import {
  allergyConflicts,
  effectiveMenuItems,
  formatMealTime,
  preferredMeal,
} from '../../lib/mealMenus';
import { colors, fonts, radius, spacing } from '../../theme';

const PREVIEW_LIMIT = 9;

const MOODS = [
  { label: 'Happy', emoji: '😊' },
  { label: 'Fussy', emoji: '😤' },
  { label: 'Curious', emoji: '🧐' },
  { label: 'Irritable', emoji: '😠' },
  { label: 'Sleepy', emoji: '😴' },
  { label: 'Sick', emoji: '🤒' },
];

const ACTIVITIES = [
  'Outdoors',
  'Arts & crafts',
  'Reading / language',
  'Singing / music',
  'Motor skills',
  'Toys',
  'Sensory play',
  'Math',
  'Science',
  'Board games',
  'Cooking class',
];

const ROUTINE_TYPES = [
  {
    id: 'attendance',
    title: 'Check in / out',
    subtitle: 'Arrival & departure',
    icon: 'checkmark-done-outline',
  },
  {
    id: 'meal',
    title: 'Meal',
    subtitle: 'Snack, lunch, bottle',
    icon: 'restaurant-outline',
  },
  {
    id: 'nap',
    title: 'Nap',
    subtitle: 'Start or end',
    icon: 'moon-outline',
  },
  {
    id: 'diaper',
    title: 'Diaper',
    subtitle: 'Wet, BM, dry',
    icon: 'water-outline',
  },
];

const MOMENT_TYPES = [
  {
    id: 'photo',
    title: 'Photo',
    subtitle: 'Add to today’s feed',
    icon: 'image-outline',
  },
  {
    id: 'activity',
    title: 'Activity',
    subtitle: 'Circle time, play',
    icon: 'flash-outline',
  },
  {
    id: 'mood',
    title: 'Mood',
    subtitle: 'How they’re feeling',
    icon: 'happy-outline',
  },
  {
    id: 'note',
    title: 'Note',
    subtitle: 'Anything for parents',
    icon: 'create-outline',
  },
];

const INCIDENT_TYPE = {
  id: 'incident',
  title: 'Incident',
  subtitle: 'Bump, bite, injury',
  icon: 'warning-outline',
};

function currentTime() {
  return format(new Date(), 'HH:mm:ss');
}

function selectionLabel(count, roomSize) {
  if (roomSize > 0 && count === roomSize) return `Whole room · ${roomSize}`;
  return `${count} ${count === 1 ? 'child' : 'children'}`;
}

function SheetHeader({ title, onBack, onClose, subtitle }) {
  return (
    <View style={styles.headerWrap}>
      <View style={styles.handle} />
      <View style={styles.header}>
        {onBack ? (
          <TouchableOpacity
            onPress={onBack}
            style={styles.headerButton}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <Ionicons name="chevron-back" size={18} color={colors.textMuted} />
          </TouchableOpacity>
        ) : (
          <View style={styles.headerSpacer} />
        )}
        <View style={styles.headerCopy}>
          <Text style={styles.headerTitle}>{title}</Text>
          {!!subtitle && <Text style={styles.headerSubtitle}>{subtitle}</Text>}
        </View>
        <TouchableOpacity
          onPress={onClose}
          style={styles.headerButton}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Close Quick log"
        >
          <Ionicons name="close" size={18} color={colors.textMuted} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

function SectionLabel({ children, action, onAction }) {
  return (
    <View style={styles.sectionLabelRow}>
      <Text style={styles.sectionLabel}>{children}</Text>
      {!!action && (
        <TouchableOpacity onPress={onAction} accessibilityRole="button">
          <Text style={styles.sectionLabelAction}>{action}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

function CheckBox({ selected }) {
  return (
    <View style={[styles.checkbox, selected && styles.checkboxSelected]}>
      {selected && <Ionicons name="checkmark" size={15} color={colors.white} />}
    </View>
  );
}

function ChildOption({ child, selected, onPress, compact = false }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.childOption, compact ? styles.childOptionCompact : styles.childOptionFull]}
      activeOpacity={0.7}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={`${child.first_name}${selected ? ', selected' : ''}`}
    >
      <View style={[styles.avatarRing, selected && styles.avatarRingSelected]}>
        <ChildAvatar child={child} size={compact ? 42 : 48} fontSize={compact ? 13 : 14} />
        {selected && (
          <View style={styles.avatarCheck}>
            <Ionicons name="checkmark" size={10} color={colors.white} />
          </View>
        )}
      </View>
      <Text style={styles.childName} numberOfLines={1}>
        {child.first_name}
      </Text>
    </TouchableOpacity>
  );
}

function InfoRow({ icon, title, subtitle, selected, onPress, badge, trailing = 'chevron' }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.infoRow, selected && styles.infoRowSelected]}
      activeOpacity={0.72}
      accessibilityRole="button"
      accessibilityState={selected === undefined ? undefined : { selected }}
    >
      <View style={styles.infoRowIcon}>
        <Ionicons name={icon} size={19} color={colors.primary} />
      </View>
      <View style={styles.infoRowCopy}>
        <View style={styles.infoRowTitleLine}>
          <Text style={styles.infoRowTitle}>{title}</Text>
          {!!badge && <Text style={styles.roomBadge}>{badge}</Text>}
        </View>
        {!!subtitle && <Text style={styles.infoRowSubtitle}>{subtitle}</Text>}
      </View>
      {trailing === 'check' ? (
        <CheckBox selected={selected} />
      ) : (
        <Ionicons
          name={trailing === 'down' ? 'chevron-down' : 'chevron-forward'}
          size={16}
          color={colors.textFaint}
        />
      )}
    </TouchableOpacity>
  );
}

function LogTypeRow({ type, onPress, incident = false }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.logTypeRow, incident && styles.incidentRow]}
      activeOpacity={0.72}
      accessibilityRole="button"
      accessibilityLabel={`${type.title}. ${type.subtitle}`}
    >
      <View style={[styles.logTypeIcon, incident && styles.incidentIcon]}>
        <Ionicons
          name={type.icon}
          size={20}
          color={incident ? colors.amber : colors.primary}
        />
      </View>
      <View style={styles.logTypeCopy}>
        <Text style={[styles.logTypeTitle, incident && styles.incidentTitle]}>
          {type.title}
        </Text>
        <Text style={[styles.logTypeSubtitle, incident && styles.incidentSubtitle]}>
          {type.subtitle}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={17} color={colors.textFaint} />
    </TouchableOpacity>
  );
}

function ChoiceChip({ label, selected, onPress, emoji }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.choiceChip, selected && styles.choiceChipSelected]}
      activeOpacity={0.72}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
    >
      <Text style={[styles.choiceChipText, selected && styles.choiceChipTextSelected]}>
        {emoji ? `${emoji} ` : ''}{label}
      </Text>
    </TouchableOpacity>
  );
}

function MealAmountSelector({ value, onChange, compact = false }) {
  return (
    <View style={[styles.mealAmountControl, compact && styles.mealAmountControlCompact]}>
      {['all', 'some', 'none'].map(amount => {
        const selected = value === amount;
        return (
          <TouchableOpacity
            key={amount}
            onPress={() => onChange(amount)}
            style={[
              styles.mealAmountOption,
              compact && styles.mealAmountOptionCompact,
              selected && styles[`mealAmountOption_${amount}`],
            ]}
            activeOpacity={0.72}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={`${amount} eaten`}
          >
            <Text style={[
              styles.mealAmountOptionText,
              selected && styles.mealAmountOptionTextSelected,
            ]}>
              {amount.charAt(0).toUpperCase() + amount.slice(1)}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

export default function BulkLogScreen({ navigation }) {
  const { profile } = useAuth();
  const { active: activeClassroom, classrooms } = useClassroom();
  const insets = useSafeAreaInsets();

  const [screen, setScreen] = useState('audience');
  const [selectedClassroom, setSelectedClassroom] = useState(activeClassroom || null);
  const [children, setChildren] = useState([]);
  const [roomCounts, setRoomCounts] = useState({});
  const [selectedChildren, setSelectedChildren] = useState(new Set());
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedType, setSelectedType] = useState(null);
  const [success, setSuccess] = useState(null);

  const [attendanceAction, setAttendanceAction] = useState('check-in');
  const [mealName, setMealName] = useState('');
  const [mealAmounts, setMealAmounts] = useState({});
  const [mealMenuItems, setMealMenuItems] = useState([]);
  const [selectedMealMenuItem, setSelectedMealMenuItem] = useState(null);
  const [mealMenuLoading, setMealMenuLoading] = useState(false);
  const [manualMeal, setManualMeal] = useState(false);
  const [napAction, setNapAction] = useState('start');
  const [diaperType, setDiaperType] = useState('diaper');
  const [diaperResult, setDiaperResult] = useState('wet');
  const [activityNames, setActivityNames] = useState(new Set());
  const [mood, setMood] = useState('');
  const [note, setNote] = useState('');
  const [photoAsset, setPhotoAsset] = useState(null);
  const [photoCaption, setPhotoCaption] = useState('');

  const today = format(new Date(), 'yyyy-MM-dd');

  useEffect(() => {
    if (!selectedClassroom && activeClassroom) {
      setSelectedClassroom(activeClassroom);
    }
  }, [activeClassroom, selectedClassroom]);

  useEffect(() => {
    let alive = true;

    async function loadCounts() {
      if (!classrooms.length) {
        setRoomCounts({});
        return;
      }
      const { data } = await supabase
        .from('children')
        .select('id, classroom_id')
        .in('classroom_id', classrooms.map(room => room.id))
        .is('archived_at', null);

      if (!alive) return;
      const counts = {};
      (data || []).forEach(child => {
        counts[child.classroom_id] = (counts[child.classroom_id] || 0) + 1;
      });
      setRoomCounts(counts);
    }

    loadCounts();
    return () => { alive = false; };
  }, [classrooms]);

  useEffect(() => {
    let alive = true;

    async function loadChildren() {
      if (!selectedClassroom?.id) {
        setChildren([]);
        setSelectedChildren(new Set());
        setLoading(false);
        return;
      }

      setLoading(true);
      const { data, error } = await supabase
        .from('children')
        .select('*')
        .eq('classroom_id', selectedClassroom.id)
        .is('archived_at', null)
        .order('first_name');

      if (!alive) return;
      if (error) {
        Alert.alert('Could not load children', error.message);
        setChildren([]);
      } else {
        setChildren(data || []);
      }
      setSelectedChildren(new Set());
      setSearch('');
      setLoading(false);
    }

    loadChildren();
    return () => { alive = false; };
  }, [selectedClassroom?.id]);

  const selectedList = useMemo(
    () => children.filter(child => selectedChildren.has(child.id)),
    [children, selectedChildren]
  );

  const filteredChildren = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return children;
    return children.filter(child =>
      `${child.first_name} ${child.last_name}`.toLowerCase().includes(query)
    );
  }, [children, search]);

  const wholeRoomSelected = children.length > 0 && selectedChildren.size === children.length;

  function closeSheet() {
    navigation.goBack();
  }

  function toggleChild(childId) {
    setSelectedChildren(previous => {
      const next = new Set(previous);
      if (next.has(childId)) next.delete(childId);
      else next.add(childId);
      return next;
    });
  }

  function toggleWholeRoom() {
    if (wholeRoomSelected) setSelectedChildren(new Set());
    else setSelectedChildren(new Set(children.map(child => child.id)));
  }

  function clearSelection() {
    setSelectedChildren(new Set());
  }

  function chooseClassroom(room) {
    setSelectedClassroom(room);
    setScreen('audience');
  }

  function continueToTypes() {
    if (!selectedChildren.size) {
      Alert.alert('Choose who', 'Select at least one child before choosing what to log.');
      return;
    }
    setScreen('types');
  }

  function resetForm(type) {
    setSelectedType(type);
    setAttendanceAction('check-in');
    setMealName('');
    setMealAmounts(
      Object.fromEntries(selectedList.map(child => [child.id, null]))
    );
    setMealMenuItems([]);
    setSelectedMealMenuItem(null);
    setMealMenuLoading(type.id === 'meal');
    setManualMeal(false);
    setNapAction('start');
    setDiaperType('diaper');
    setDiaperResult('wet');
    setActivityNames(new Set());
    setMood('');
    setNote('');
    setPhotoAsset(null);
    setPhotoCaption('');
  }

  function chooseLogType(type) {
    if (type.id === 'incident') {
      if (selectedList.length !== 1) {
        Alert.alert(
          'Choose one child',
          'Incident reports are individual safety records. Select exactly one child first.',
          [{ text: 'Change selection', onPress: () => setScreen('audience') }]
        );
        return;
      }
      navigation.replace('IncidentReport', { child: selectedList[0] });
      return;
    }
    resetForm(type);
    setScreen('form');
  }

  useEffect(() => {
    let alive = true;

    async function loadMealMenu() {
      if (
        selectedType?.id !== 'meal'
        || screen !== 'form'
        || !profile?.daycare_id
        || !selectedClassroom?.id
      ) {
        return;
      }

      setMealMenuLoading(true);
      const { data, error } = await supabase
        .from('meal_menu_items')
        .select('*')
        .eq('daycare_id', profile.daycare_id)
        .eq('menu_date', today)
        .or(`classroom_id.eq.${selectedClassroom.id},classroom_id.is.null`)
        .order('meal_time');

      if (!alive) return;
      if (error) {
        setMealMenuItems([]);
        setSelectedMealMenuItem(null);
        setManualMeal(true);
      } else {
        const items = effectiveMenuItems(data || [], selectedClassroom.id);
        const preferred = preferredMeal(items);
        setMealMenuItems(items);
        setSelectedMealMenuItem(preferred);
        setMealName(preferred?.food_description || '');
        setManualMeal(!preferred);
      }
      setMealMenuLoading(false);
    }

    loadMealMenu();
    return () => { alive = false; };
  }, [
    profile?.daycare_id,
    screen,
    selectedClassroom?.id,
    selectedType?.id,
    today,
  ]);

  function chooseMenuMeal(item) {
    setSelectedMealMenuItem(item);
    setMealName(item.food_description);
    setManualMeal(false);
  }

  function setChildMealAmount(childId, amount) {
    setMealAmounts(previous => ({ ...previous, [childId]: amount }));
  }

  function setAllMealAmounts(amount) {
    setMealAmounts(
      Object.fromEntries(selectedList.map(child => [child.id, amount]))
    );
  }

  function toggleActivity(activity) {
    setActivityNames(previous => {
      const next = new Set(previous);
      if (next.has(activity)) next.delete(activity);
      else next.add(activity);
      return next;
    });
  }

  async function pickPhoto(source) {
    try {
      if (source === 'camera') {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          Alert.alert('Permission needed', 'Please allow camera access to take a photo.');
          return;
        }
      } else {
        const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) {
          Alert.alert('Permission needed', 'Please allow photo library access.');
          return;
        }
      }

      const result = source === 'camera'
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.85 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85 });

      if (!result.canceled && result.assets?.[0]) setPhotoAsset(result.assets[0]);
    } catch (error) {
      Alert.alert('Photo unavailable', error.message);
    }
  }

  function choosePhotoSource() {
    Alert.alert('Add a photo', 'Choose a source', [
      { text: 'Camera', onPress: () => pickPhoto('camera') },
      { text: 'Photo library', onPress: () => pickPhoto('library') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  async function ensureDailyLogs() {
    const childIds = selectedList.map(child => child.id);
    const { error: upsertError } = await supabase
      .from('daily_logs')
      .upsert(
        childIds.map(childId => ({
          daycare_id: profile.daycare_id,
          child_id: childId,
          educator_id: profile.id,
          log_date: today,
        })),
        { onConflict: 'child_id,log_date', ignoreDuplicates: true }
      );
    if (upsertError) throw upsertError;

    const { data, error } = await supabase
      .from('daily_logs')
      .select('id, child_id, moods, notes')
      .in('child_id', childIds)
      .eq('log_date', today);
    if (error) throw error;
    if (data?.length !== childIds.length) {
      throw new Error('Some daily logs could not be created. Please try again.');
    }
    return data;
  }

  async function saveAttendance() {
    const childIds = selectedList.map(child => child.id);
    const timestamp = new Date().toISOString();

    if (attendanceAction === 'check-in') {
      const { error } = await supabase
        .from('attendance_records')
        .upsert(
          childIds.map(childId => ({
            daycare_id: profile.daycare_id,
            child_id: childId,
            date: today,
            checked_in_at: timestamp,
            checked_in_by: profile.id,
            checked_out_at: null,
            checked_out_by: null,
            method: 'educator',
            status: 'present',
          })),
          { onConflict: 'child_id,date' }
        );
      if (error) throw error;
      return `Checked in ${childIds.length} ${childIds.length === 1 ? 'child' : 'children'} at ${format(new Date(), 'h:mm a')}.`;
    }

    const { data: records, error: recordsError } = await supabase
      .from('attendance_records')
      .select('id, child_id, checked_in_at, checked_out_at')
      .in('child_id', childIds)
      .eq('date', today);
    if (recordsError) throw recordsError;

    const active = (records || []).filter(record => record.checked_in_at && !record.checked_out_at);
    if (!active.length) throw new Error('None of the selected children has an active check-in.');

    const results = await Promise.all(
      active.map(record =>
        supabase
          .from('attendance_records')
          .update({ checked_out_at: timestamp, checked_out_by: profile.id })
          .eq('id', record.id)
      )
    );
    const failed = results.find(result => result.error);
    if (failed?.error) throw failed.error;

    const skipped = childIds.length - active.length;
    return `Checked out ${active.length} ${active.length === 1 ? 'child' : 'children'}${skipped ? `; ${skipped} had no active check-in` : ''}.`;
  }

  async function saveMeal() {
    if (!mealName.trim()) throw new Error('Enter what was served before saving.');
    const missingAmount = selectedList.find(child => !mealAmounts[child.id]);
    if (missingAmount) {
      throw new Error(`Choose how much ${missingAmount.first_name} ate before saving.`);
    }
    const logs = await ensureDailyLogs();
    const rows = logs.map(log => ({
      daily_log_id: log.id,
      time: selectedMealMenuItem?.meal_time || currentTime(),
      food_type: mealName.trim(),
      amount: mealAmounts[log.child_id],
      meal_menu_item_id: selectedMealMenuItem?.id || null,
    }));
    const operation = selectedMealMenuItem?.id
      ? supabase
        .from('meal_entries')
        .upsert(rows, { onConflict: 'daily_log_id,meal_menu_item_id' })
      : supabase.from('meal_entries').insert(rows);
    const { error } = await operation;
    if (error) throw error;
    const label = selectedMealMenuItem?.meal_label || 'Meal';
    return `Logged ${label.toLowerCase()} for ${logs.length} ${logs.length === 1 ? 'child' : 'children'}.`;
  }

  async function saveNap() {
    const logs = await ensureDailyLogs();
    if (napAction === 'start') {
      const { error } = await supabase.from('sleep_entries').insert(
        logs.map(log => ({ daily_log_id: log.id, start_time: currentTime() }))
      );
      if (error) throw error;
      return `Started nap for ${logs.length} ${logs.length === 1 ? 'child' : 'children'}.`;
    }

    const { data: openNaps, error: loadError } = await supabase
      .from('sleep_entries')
      .select('id, daily_log_id, created_at')
      .in('daily_log_id', logs.map(log => log.id))
      .is('end_time', null)
      .order('created_at', { ascending: false });
    if (loadError) throw loadError;

    const latestByLog = new Map();
    (openNaps || []).forEach(entry => {
      if (!latestByLog.has(entry.daily_log_id)) latestByLog.set(entry.daily_log_id, entry);
    });
    if (!latestByLog.size) throw new Error('None of the selected children has an active nap.');

    const results = await Promise.all(
      [...latestByLog.values()].map(entry =>
        supabase
          .from('sleep_entries')
          .update({ end_time: currentTime() })
          .eq('id', entry.id)
      )
    );
    const failed = results.find(result => result.error);
    if (failed?.error) throw failed.error;

    const skipped = logs.length - latestByLog.size;
    return `Ended nap for ${latestByLog.size} ${latestByLog.size === 1 ? 'child' : 'children'}${skipped ? `; ${skipped} had no active nap` : ''}.`;
  }

  async function saveDiaper() {
    const logs = await ensureDailyLogs();
    const { error } = await supabase.from('diaper_entries').insert(
      logs.map(log => ({
        daily_log_id: log.id,
        time: currentTime(),
        type: diaperType,
        wet: diaperResult === 'wet',
        bm: diaperResult === 'bm',
      }))
    );
    if (error) throw error;
    const resultLabel = diaperResult === 'bm' ? 'BM' : diaperResult;
    return `Logged ${resultLabel} for ${logs.length} ${logs.length === 1 ? 'child' : 'children'}.`;
  }

  async function saveActivity() {
    if (!activityNames.size) throw new Error('Select at least one activity before saving.');
    const logs = await ensureDailyLogs();
    const { data: existing, error: existingError } = await supabase
      .from('activity_entries')
      .select('daily_log_id, activity_name')
      .in('daily_log_id', logs.map(log => log.id));
    if (existingError) throw existingError;

    const existingKeys = new Set(
      (existing || []).map(entry => `${entry.daily_log_id}:${entry.activity_name}`)
    );
    const rows = [];
    logs.forEach(log => {
      activityNames.forEach(activity => {
        if (!existingKeys.has(`${log.id}:${activity}`)) {
          rows.push({ daily_log_id: log.id, activity_name: activity });
        }
      });
    });

    if (rows.length) {
      const { error } = await supabase.from('activity_entries').insert(rows);
      if (error) throw error;
    }
    return `Added ${activityNames.size} ${activityNames.size === 1 ? 'activity' : 'activities'} to ${logs.length} daily ${logs.length === 1 ? 'log' : 'logs'}.`;
  }

  async function saveMood() {
    if (!mood) throw new Error('Choose a mood before saving.');
    const logs = await ensureDailyLogs();
    const results = await Promise.all(
      logs.map(log => {
        const moods = [...new Set([...(log.moods || []), mood])];
        return supabase.from('daily_logs').update({ moods }).eq('id', log.id);
      })
    );
    const failed = results.find(result => result.error);
    if (failed?.error) throw failed.error;
    return `Added ${mood.toLowerCase()} to ${logs.length} daily ${logs.length === 1 ? 'log' : 'logs'}.`;
  }

  async function saveNote() {
    const cleanNote = note.trim();
    if (!cleanNote) throw new Error('Write a note before saving.');
    const logs = await ensureDailyLogs();
    const results = await Promise.all(
      logs.map(log => {
        const notes = log.notes?.trim() ? `${log.notes.trim()}\n${cleanNote}` : cleanNote;
        return supabase.from('daily_logs').update({ notes }).eq('id', log.id);
      })
    );
    const failed = results.find(result => result.error);
    if (failed?.error) throw failed.error;
    return `Shared the note in ${logs.length} daily ${logs.length === 1 ? 'log' : 'logs'}.`;
  }

  async function savePhoto() {
    if (!photoAsset?.uri) throw new Error('Choose a photo before saving.');
    const consentRows = await getPhotoConsentStatuses(selectedList.map(child => child.id));
    const allowedIds = new Set((consentRows || []).filter(row => row.allowed).map(row => row.child_id));
    const restricted = selectedList.filter(child => !allowedIds.has(child.id));
    if (restricted.length) {
      const names = restricted.slice(0, 3).map(child => child.first_name).join(', ');
      const more = restricted.length > 3 ? ` and ${restricted.length - 3} more` : '';
      throw new Error(`Photo permission is declined or not answered for ${names}${more}. Remove them from this group photo before saving.`);
    }
    const logs = await ensureDailyLogs();
    const processed = await ImageManipulator.manipulateAsync(
      photoAsset.uri,
      [{ resize: { width: 1200 } }],
      { compress: 0.82, format: ImageManipulator.SaveFormat.JPEG }
    );
    const response = await fetch(processed.uri);
    const bytes = await response.arrayBuffer();
    const stamp = Date.now();

    for (let index = 0; index < logs.length; index += 1) {
      const log = logs[index];
      const child = selectedList.find(item => item.id === log.child_id);
      const path = `${child.id}/${log.id}/${stamp}_${index}.jpg`;
      const { error: uploadError } = await supabase.storage
        .from('daily-log-photos')
        .upload(path, bytes, { contentType: 'image/jpeg', upsert: false });
      if (uploadError) throw uploadError;

      const { error: metadataError } = await supabase.from('photos').insert({
        daily_log_id: log.id,
        storage_path: path,
        caption: photoCaption.trim() || null,
        uploader_id: profile.id,
      });
      if (metadataError) {
        await supabase.storage.from('daily-log-photos').remove([path]);
        throw metadataError;
      }
    }
    return `Added the photo to ${logs.length} daily ${logs.length === 1 ? 'feed' : 'feeds'}.`;
  }

  async function handleSave() {
    setSaving(true);
    try {
      let detail = '';
      if (selectedType.id === 'attendance') detail = await saveAttendance();
      if (selectedType.id === 'meal') detail = await saveMeal();
      if (selectedType.id === 'nap') detail = await saveNap();
      if (selectedType.id === 'diaper') detail = await saveDiaper();
      if (selectedType.id === 'activity') detail = await saveActivity();
      if (selectedType.id === 'mood') detail = await saveMood();
      if (selectedType.id === 'note') detail = await saveNote();
      if (selectedType.id === 'photo') detail = await savePhoto();

      setSuccess({ title: `${selectedType.title} logged`, detail });
      setScreen('success');
    } catch (error) {
      Alert.alert('Could not save', error.message || 'Please try again.');
    } finally {
      setSaving(false);
    }
  }

  function renderAudience() {
    const previewChildren = children.slice(0, PREVIEW_LIMIT);
    const overflowCount = Math.max(0, children.length - PREVIEW_LIMIT);

    return (
      <View style={styles.screen}>
        <SheetHeader title="Quick log" onClose={closeSheet} />
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <SectionLabel>CLASSROOM</SectionLabel>
          <InfoRow
            icon="business-outline"
            title={selectedClassroom?.name || 'Choose classroom'}
            subtitle={`${selectedClassroom?.age_group || 'Classroom'} · ${children.length} ${children.length === 1 ? 'child' : 'children'}${selectedClassroom?.id === activeClassroom?.id ? ' · your room' : ''}`}
            trailing="down"
            onPress={() => setScreen('classrooms')}
          />

          <SectionLabel>FOR WHOM</SectionLabel>
          <InfoRow
            icon="people-outline"
            title={`Whole room · ${children.length}`}
            selected={wholeRoomSelected}
            trailing="check"
            onPress={toggleWholeRoom}
          />

          <SectionLabel
            action={children.length ? 'View all' : undefined}
            onAction={() => setScreen('roster')}
          >
            OR PICK CHILDREN
          </SectionLabel>
          {children.length ? (
            <View style={styles.previewGrid}>
              {previewChildren.map(child => (
                <ChildOption
                  key={child.id}
                  child={child}
                  selected={selectedChildren.has(child.id)}
                  onPress={() => toggleChild(child.id)}
                  compact
                />
              ))}
              {overflowCount > 0 && (
                <TouchableOpacity
                  onPress={() => setScreen('roster')}
                  style={[styles.childOption, styles.childOptionCompact]}
                  accessibilityRole="button"
                  accessibilityLabel={`View ${overflowCount} more children`}
                >
                  <View style={styles.overflowAvatar}>
                    <Text style={styles.overflowAvatarText}>+{overflowCount}</Text>
                  </View>
                  <Text style={styles.overflowLabel}>more</Text>
                </TouchableOpacity>
              )}
            </View>
          ) : (
            <View style={styles.emptyState}>
              <Ionicons name="people-outline" size={26} color={colors.textFaint} />
              <Text style={styles.emptyStateTitle}>No children in this classroom</Text>
              <Text style={styles.emptyStateText}>Choose another classroom to continue.</Text>
            </View>
          )}
        </ScrollView>
        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, spacing.xl) }]}>
          <View style={styles.selectionSummary}>
            <Text style={styles.selectionCount}>
              {selectedChildren.size} selected
            </Text>
            {selectedChildren.size > 0 && (
              <TouchableOpacity onPress={clearSelection} accessibilityRole="button">
                <Text style={styles.clearText}>Clear</Text>
              </TouchableOpacity>
            )}
          </View>
          <TouchableOpacity
            onPress={continueToTypes}
            disabled={!selectedChildren.size}
            style={[styles.primaryButton, !selectedChildren.size && styles.buttonDisabled]}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityState={{ disabled: !selectedChildren.size }}
          >
            <Text style={styles.primaryButtonText}>
              Next · choose what to log
            </Text>
            <Ionicons name="arrow-forward" size={17} color={colors.white} />
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  function renderRoster() {
    return (
      <View style={styles.screen}>
        <SheetHeader
          title={`${selectedClassroom?.name || 'Classroom'} · everyone`}
          onBack={() => setScreen('audience')}
          onClose={closeSheet}
        />
        <View style={styles.rosterControls}>
          <TouchableOpacity
            onPress={toggleWholeRoom}
            style={styles.selectEveryone}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: wholeRoomSelected }}
          >
            <Text style={styles.selectEveryoneTitle}>Select everyone</Text>
            <Text style={styles.selectEveryoneCount}>
              {selectedChildren.size} of {children.length}
            </Text>
            <CheckBox selected={wholeRoomSelected} />
          </TouchableOpacity>
          <View style={styles.searchBox}>
            <Ionicons name="search" size={17} color={colors.textFaint} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search children…"
              placeholderTextColor={colors.textFaint}
              style={styles.searchInput}
              accessibilityLabel="Search children"
              autoCorrect={false}
              returnKeyType="search"
            />
            {!!search && (
              <TouchableOpacity onPress={() => setSearch('')}>
                <Ionicons name="close-circle" size={17} color={colors.textFaint} />
              </TouchableOpacity>
            )}
          </View>
        </View>
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.fullRosterGrid}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {filteredChildren.map(child => (
            <ChildOption
              key={child.id}
              child={child}
              selected={selectedChildren.has(child.id)}
              onPress={() => toggleChild(child.id)}
            />
          ))}
          {!filteredChildren.length && (
            <View style={styles.searchEmpty}>
              <Text style={styles.emptyStateText}>No children match “{search}”.</Text>
            </View>
          )}
        </ScrollView>
        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, spacing.xl) }]}>
          <TouchableOpacity
            onPress={continueToTypes}
            disabled={!selectedChildren.size}
            style={[styles.primaryButton, !selectedChildren.size && styles.buttonDisabled]}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityState={{ disabled: !selectedChildren.size }}
          >
            <Text style={styles.primaryButtonText}>
              Log for {selectedChildren.size} {selectedChildren.size === 1 ? 'child' : 'children'}
            </Text>
            <Ionicons name="arrow-forward" size={17} color={colors.white} />
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  function renderClassrooms() {
    return (
      <View style={styles.screen}>
        <SheetHeader
          title="Choose classroom"
          subtitle="Your assigned rooms and today’s coverage"
          onBack={() => setScreen('audience')}
          onClose={closeSheet}
        />
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.classroomHelp}>
            Switching here changes whose children appear in “For whom.”
          </Text>
          <View style={styles.classroomList}>
            {classrooms.map(room => {
              const selected = room.id === selectedClassroom?.id;
              const count = roomCounts[room.id] || 0;
              return (
                <InfoRow
                  key={room.id}
                  icon={room.id === activeClassroom?.id ? 'business' : 'business-outline'}
                  title={room.name}
                  subtitle={`${room.age_group || 'Classroom'} · ${count} ${count === 1 ? 'child' : 'children'}`}
                  badge={room.id === activeClassroom?.id ? 'YOUR ROOM' : undefined}
                  selected={selected}
                  trailing={selected ? 'check' : 'chevron'}
                  onPress={() => chooseClassroom(room)}
                />
              );
            })}
          </View>
          <View style={styles.infoBanner}>
            <Ionicons name="information-circle-outline" size={18} color={colors.primary} />
            <Text style={styles.infoBannerText}>
              Rooms you can log for are set by an admin. Only assigned or covered rooms appear here.
            </Text>
          </View>
        </ScrollView>
      </View>
    );
  }

  function renderTypes() {
    return (
      <View style={styles.screen}>
        <SheetHeader
          title="Quick log"
          onBack={() => setScreen('audience')}
          onClose={closeSheet}
        />
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <TouchableOpacity
            onPress={() => setScreen('audience')}
            style={styles.loggingFor}
            activeOpacity={0.72}
            accessibilityRole="button"
            accessibilityLabel={`Logging for ${selectionLabel(selectedChildren.size, children.length)}. Change selection`}
          >
            <View style={styles.loggingForIcon}>
              <Ionicons name="people-outline" size={17} color={colors.primary} />
            </View>
            <View style={styles.loggingForCopy}>
              <Text style={styles.loggingForLabel}>LOGGING FOR</Text>
              <Text style={styles.loggingForValue}>
                {selectionLabel(selectedChildren.size, children.length)}
              </Text>
            </View>
            <Text style={styles.changeText}>Change</Text>
          </TouchableOpacity>

          <LogTypeRow
            type={INCIDENT_TYPE}
            incident
            onPress={() => chooseLogType(INCIDENT_TYPE)}
          />

          <SectionLabel>ROUTINE</SectionLabel>
          <View style={styles.logTypeGroup}>
            {ROUTINE_TYPES.map(type => (
              <LogTypeRow
                key={type.id}
                type={type}
                onPress={() => chooseLogType(type)}
              />
            ))}
          </View>

          <SectionLabel>MOMENTS</SectionLabel>
          <View style={styles.logTypeGroup}>
            {MOMENT_TYPES.map(type => (
              <LogTypeRow
                key={type.id}
                type={type}
                onPress={() => chooseLogType(type)}
              />
            ))}
          </View>
        </ScrollView>
      </View>
    );
  }

  function renderFormFields() {
    if (selectedType.id === 'attendance') {
      return (
        <>
          <Text style={styles.formLabel}>ACTION</Text>
          <View style={styles.choiceRow}>
            <ChoiceChip
              label="Check in"
              selected={attendanceAction === 'check-in'}
              onPress={() => setAttendanceAction('check-in')}
            />
            <ChoiceChip
              label="Check out"
              selected={attendanceAction === 'check-out'}
              onPress={() => setAttendanceAction('check-out')}
            />
          </View>
          <View style={styles.timeBanner}>
            <Ionicons name="time-outline" size={18} color={colors.primary} />
            <Text style={styles.timeBannerText}>Now · {format(new Date(), 'h:mm a')}</Text>
          </View>
        </>
      );
    }

    if (selectedType.id === 'meal') {
      if (mealMenuLoading) {
        return (
          <View style={styles.mealLoading}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.mealLoadingText}>Checking today’s menu…</Text>
          </View>
        );
      }

      const conflicts = selectedMealMenuItem
        ? selectedList
          .map(child => ({
            child,
            allergies: allergyConflicts(child, selectedMealMenuItem.allergens),
          }))
          .filter(item => item.allergies.length)
        : [];

      return (
        <>
          {!!mealMenuItems.length && (
            <>
              {mealMenuItems.length > 1 && (
                <>
                  <Text style={styles.formLabel}>MEAL</Text>
                  <View style={styles.choiceRow}>
                    {mealMenuItems.map(item => (
                      <ChoiceChip
                        key={item.id}
                        label={item.meal_label}
                        selected={selectedMealMenuItem?.id === item.id}
                        onPress={() => chooseMenuMeal(item)}
                      />
                    ))}
                  </View>
                </>
              )}
              {selectedMealMenuItem && (
                <View style={styles.menuPrefillCard}>
                  <View style={styles.menuPrefillHeader}>
                    <Text style={styles.menuPrefillBadge}>FROM TODAY’S MENU</Text>
                    <TouchableOpacity
                      onPress={() => setManualMeal(previous => !previous)}
                      accessibilityRole="button"
                    >
                      <Text style={styles.menuEditText}>{manualMeal ? 'Use menu' : 'Edit'}</Text>
                    </TouchableOpacity>
                  </View>
                  {manualMeal ? (
                    <TextInput
                      value={mealName}
                      onChangeText={setMealName}
                      placeholder="What was served?"
                      placeholderTextColor={colors.textFaint}
                      style={styles.menuInlineInput}
                      accessibilityLabel="What was served"
                    />
                  ) : (
                    <Text style={styles.menuPrefillFood}>{mealName}</Text>
                  )}
                  <Text style={styles.menuPrefillMeta}>
                    {formatMealTime(selectedMealMenuItem.meal_time)} · set for {selectedClassroom?.name || 'this room'}
                  </Text>
                </View>
              )}
            </>
          )}

          {!mealMenuItems.length && (
            <View style={styles.noMenuBanner}>
              <Ionicons name="information-circle-outline" size={18} color={colors.amber} />
              <Text style={styles.noMenuText}>
                No menu is planned for today. Enter what was served to continue.
              </Text>
            </View>
          )}

          {(!mealMenuItems.length || manualMeal) && !selectedMealMenuItem && (
            <>
              <Text style={styles.formLabel}>WHAT WAS SERVED?</Text>
              <TextInput
                value={mealName}
                onChangeText={setMealName}
                placeholder="e.g. Pasta, peas and milk"
                placeholderTextColor={colors.textFaint}
                style={styles.textInput}
                accessibilityLabel="What was served"
                autoFocus
              />
            </>
          )}

          {conflicts.map(({ child, allergies }) => (
            <View key={child.id} style={styles.mealAllergyBanner}>
              <Ionicons name="warning-outline" size={17} color={colors.danger} />
              <Text style={styles.mealAllergyText}>
                <Text style={styles.mealAllergyName}>{child.first_name}</Text>
                {' — '}{allergies.join(', ')} allergy. Confirm a safe alternative before serving.
              </Text>
            </View>
          ))}

          <Text style={styles.formLabel}>HOW MUCH DID EACH CHILD EAT?</Text>
          <View style={styles.mealChildrenCard}>
            {selectedList.map((child, index) => (
              <View
                key={child.id}
                style={[styles.mealChildRow, index > 0 && styles.mealChildRowBorder]}
              >
                <ChildAvatar child={child} size={36} fontSize={12} />
                <Text style={styles.mealChildName} numberOfLines={1}>
                  {child.first_name}
                </Text>
                <MealAmountSelector
                  compact
                  value={mealAmounts[child.id]}
                  onChange={amount => setChildMealAmount(child.id, amount)}
                />
              </View>
            ))}
          </View>
          <TouchableOpacity
            onPress={() => setAllMealAmounts('all')}
            style={styles.setAllMealButton}
            accessibilityRole="button"
          >
            <Text style={styles.setAllMealText}>Set all to “All eaten”</Text>
          </TouchableOpacity>
        </>
      );
    }

    if (selectedType.id === 'nap') {
      return (
        <>
          <Text style={styles.formLabel}>ACTION</Text>
          <View style={styles.choiceRow}>
            <ChoiceChip
              label="Start nap"
              selected={napAction === 'start'}
              onPress={() => setNapAction('start')}
            />
            <ChoiceChip
              label="End nap"
              selected={napAction === 'end'}
              onPress={() => setNapAction('end')}
            />
          </View>
          <View style={styles.timeBanner}>
            <Ionicons name="time-outline" size={18} color={colors.primary} />
            <Text style={styles.timeBannerText}>Now · {format(new Date(), 'h:mm a')}</Text>
          </View>
        </>
      );
    }

    if (selectedType.id === 'diaper') {
      return (
        <>
          <Text style={styles.formLabel}>TYPE</Text>
          <View style={styles.choiceRow}>
            <ChoiceChip
              label="Diaper"
              selected={diaperType === 'diaper'}
              onPress={() => setDiaperType('diaper')}
            />
            <ChoiceChip
              label="Toilet"
              selected={diaperType === 'toilet'}
              onPress={() => setDiaperType('toilet')}
            />
          </View>
          <Text style={styles.formLabel}>RESULT</Text>
          <View style={styles.choiceRow}>
            {[
              { id: 'wet', label: 'Wet', emoji: '💧' },
              { id: 'bm', label: 'BM', emoji: '💩' },
              { id: 'dry', label: 'Dry', emoji: '✓' },
            ].map(result => (
              <ChoiceChip
                key={result.id}
                label={result.label}
                emoji={result.emoji}
                selected={diaperResult === result.id}
                onPress={() => setDiaperResult(result.id)}
              />
            ))}
          </View>
        </>
      );
    }

    if (selectedType.id === 'activity') {
      return (
        <>
          <Text style={styles.formLabel}>SELECT ALL THAT APPLY</Text>
          <View style={styles.wrapChoices}>
            {ACTIVITIES.map(activity => (
              <ChoiceChip
                key={activity}
                label={activity}
                selected={activityNames.has(activity)}
                onPress={() => toggleActivity(activity)}
              />
            ))}
          </View>
        </>
      );
    }

    if (selectedType.id === 'mood') {
      return (
        <>
          <Text style={styles.formLabel}>HOW ARE THEY FEELING?</Text>
          <View style={styles.wrapChoices}>
            {MOODS.map(item => (
              <ChoiceChip
                key={item.label}
                label={item.label}
                emoji={item.emoji}
                selected={mood === item.label}
                onPress={() => setMood(item.label)}
              />
            ))}
          </View>
        </>
      );
    }

    if (selectedType.id === 'note') {
      return (
        <>
          <Text style={styles.formLabel}>NOTE FOR PARENTS</Text>
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder="What would you like families to know?"
            placeholderTextColor={colors.textFaint}
            style={[styles.textInput, styles.multilineInput]}
            accessibilityLabel="Note for parents"
            multiline
            textAlignVertical="top"
            autoFocus
          />
        </>
      );
    }

    if (selectedType.id === 'photo') {
      return (
        <>
          <Text style={styles.formLabel}>PHOTO</Text>
          {photoAsset?.uri ? (
            <View style={styles.photoPreviewWrap}>
              <Image source={{ uri: photoAsset.uri }} style={styles.photoPreview} />
              <TouchableOpacity
                onPress={() => setPhotoAsset(null)}
                style={styles.photoRemove}
                accessibilityRole="button"
                accessibilityLabel="Remove selected photo"
              >
                <Ionicons name="close" size={16} color={colors.white} />
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              onPress={choosePhotoSource}
              style={styles.photoPicker}
              accessibilityRole="button"
            >
              <View style={styles.photoPickerIcon}>
                <Ionicons name="camera-outline" size={24} color={colors.primary} />
              </View>
              <Text style={styles.photoPickerTitle}>Take or choose a photo</Text>
              <Text style={styles.photoPickerHint}>The same moment will appear in each selected child’s feed.</Text>
            </TouchableOpacity>
          )}
          <Text style={styles.formLabel}>CAPTION · OPTIONAL</Text>
          <TextInput
            value={photoCaption}
            onChangeText={setPhotoCaption}
            placeholder="What’s happening in this photo?"
            placeholderTextColor={colors.textFaint}
            style={styles.textInput}
            accessibilityLabel="Photo caption"
          />
        </>
      );
    }

    return null;
  }

  function renderForm() {
    const allMealAmountsSet = selectedList.length > 0
      && selectedList.every(child => Boolean(mealAmounts[child.id]));
    const formValid =
      selectedType.id === 'attendance' ||
      selectedType.id === 'nap' ||
      selectedType.id === 'diaper' ||
      (selectedType.id === 'meal' && !!mealName.trim() && allMealAmountsSet) ||
      (selectedType.id === 'activity' && activityNames.size > 0) ||
      (selectedType.id === 'mood' && !!mood) ||
      (selectedType.id === 'note' && !!note.trim()) ||
      (selectedType.id === 'photo' && !!photoAsset?.uri);

    return (
      <KeyboardAvoidingView
        style={styles.screen}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <SheetHeader
          title={
            selectedType.id === 'meal' && selectedMealMenuItem
              ? `Log ${selectedMealMenuItem.meal_label.toLowerCase()}`
              : selectedType.title
          }
          subtitle={selectedType.subtitle}
          onBack={() => setScreen('types')}
          onClose={closeSheet}
        />
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <TouchableOpacity
            onPress={() => setScreen('audience')}
            style={styles.loggingFor}
            activeOpacity={0.72}
          >
            <View style={styles.loggingForIcon}>
              <Ionicons name="people-outline" size={17} color={colors.primary} />
            </View>
            <View style={styles.loggingForCopy}>
              <Text style={styles.loggingForLabel}>LOGGING FOR</Text>
              <Text style={styles.loggingForValue}>
                {selectionLabel(selectedChildren.size, children.length)}
              </Text>
            </View>
            <Text style={styles.changeText}>Change</Text>
          </TouchableOpacity>
          <View style={styles.formCard}>
            {renderFormFields()}
          </View>
        </ScrollView>
        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, spacing.xl) }]}>
          <TouchableOpacity
            onPress={handleSave}
            disabled={saving || !formValid}
            style={[styles.primaryButton, (saving || !formValid) && styles.buttonDisabled]}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityState={{ busy: saving, disabled: saving || !formValid }}
          >
            {saving ? (
              <ActivityIndicator color={colors.white} />
            ) : (
              <>
                <Text style={styles.primaryButtonText}>
                  Log {
                    selectedType.id === 'meal' && selectedMealMenuItem
                      ? selectedMealMenuItem.meal_label.toLowerCase()
                      : selectedType.title.toLowerCase()
                  } for {selectedChildren.size}
                </Text>
                <Ionicons name="checkmark" size={18} color={colors.white} />
              </>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    );
  }

  function renderSuccess() {
    return (
      <View style={styles.screen}>
        <SheetHeader title="Quick log" onClose={closeSheet} />
        <View style={styles.successContent}>
          <View style={styles.successIcon}>
            <Ionicons name="checkmark" size={38} color={colors.white} />
          </View>
          <Text style={styles.successTitle}>{success.title}</Text>
          <Text style={styles.successDetail}>{success.detail}</Text>
          <View style={styles.successAudience}>
            <Ionicons name="people-outline" size={18} color={colors.primary} />
            <Text style={styles.successAudienceText}>
              {selectionLabel(selectedChildren.size, children.length)}
            </Text>
          </View>
        </View>
        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, spacing.xl) }]}>
          <TouchableOpacity
            onPress={() => setScreen('types')}
            style={styles.secondaryButton}
            activeOpacity={0.78}
            accessibilityRole="button"
          >
            <Text style={styles.secondaryButtonText}>Log something else</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={closeSheet}
            style={styles.primaryButton}
            activeOpacity={0.8}
            accessibilityRole="button"
          >
            <Text style={styles.primaryButtonText}>Done</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.screen}>
        <SheetHeader title="Quick log" onClose={closeSheet} />
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={styles.loadingText}>Loading your classroom…</Text>
        </View>
      </View>
    );
  }

  if (screen === 'roster') return renderRoster();
  if (screen === 'classrooms') return renderClassrooms();
  if (screen === 'types') return renderTypes();
  if (screen === 'form') return renderForm();
  if (screen === 'success') return renderSuccess();
  return renderAudience();
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  headerWrap: {
    backgroundColor: colors.bg,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
  },
  handle: {
    width: 44,
    height: 5,
    borderRadius: radius.full,
    backgroundColor: colors.border,
    alignSelf: 'center',
    marginBottom: spacing.md,
  },
  header: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingBottom: spacing.md,
  },
  headerSpacer: {
    width: 32,
    height: 32,
  },
  headerButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCopy: {
    flex: 1,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 20,
    lineHeight: 25,
    fontFamily: fonts.black,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  headerSubtitle: {
    marginTop: 2,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: fonts.regular,
    color: colors.textFaint,
    textAlign: 'center',
  },
  scrollContent: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxl,
  },
  sectionLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  sectionLabel: {
    fontSize: 12,
    fontFamily: fonts.bold,
    letterSpacing: 1.05,
    color: colors.textFaint,
  },
  sectionLabelAction: {
    fontSize: 12,
    fontFamily: fonts.bold,
    color: colors.primary,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 7,
    borderWidth: 1.8,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  infoRow: {
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  infoRowSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
  },
  infoRowIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoRowCopy: {
    flex: 1,
    minWidth: 0,
  },
  infoRowTitleLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  infoRowTitle: {
    flexShrink: 1,
    fontSize: 14.5,
    fontFamily: fonts.bold,
    color: colors.textPrimary,
  },
  infoRowSubtitle: {
    marginTop: 2,
    fontSize: 11.5,
    fontFamily: fonts.regular,
    color: colors.textFaint,
  },
  roomBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.sm,
    overflow: 'hidden',
    backgroundColor: colors.primaryLight,
    fontSize: 9,
    lineHeight: 12,
    fontFamily: fonts.bold,
    color: colors.primary,
    letterSpacing: 0.5,
  },
  previewGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: spacing.md,
    marginHorizontal: -spacing.xs,
  },
  childOption: {
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: spacing.xs,
  },
  childOptionCompact: {
    width: '20%',
  },
  childOptionFull: {
    width: '25%',
  },
  avatarRing: {
    position: 'relative',
    borderRadius: radius.full,
    padding: 2.5,
    borderWidth: 2.5,
    borderColor: 'transparent',
  },
  avatarRingSelected: {
    borderColor: colors.primary,
  },
  avatarCheck: {
    position: 'absolute',
    right: -3,
    bottom: -3,
    width: 19,
    height: 19,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.bg,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  childName: {
    maxWidth: '100%',
    fontSize: 10.5,
    fontFamily: fonts.bold,
    color: colors.textSecondary,
  },
  overflowAvatar: {
    width: 47,
    height: 47,
    borderRadius: 24,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.borderStrong,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  overflowAvatarText: {
    fontSize: 13,
    fontFamily: fonts.bold,
    color: colors.textFaint,
  },
  overflowLabel: {
    fontSize: 10.5,
    fontFamily: fonts.bold,
    color: colors.textFaint,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.lg,
  },
  emptyStateTitle: {
    marginTop: spacing.sm,
    fontSize: 14,
    fontFamily: fonts.bold,
    color: colors.textPrimary,
  },
  emptyStateText: {
    marginTop: spacing.xs,
    fontSize: 12.5,
    lineHeight: 18,
    fontFamily: fonts.regular,
    color: colors.textFaint,
    textAlign: 'center',
  },
  footer: {
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
    borderTopWidth: 1,
    borderTopColor: colors.borderSoft,
    backgroundColor: colors.bg,
    shadowColor: colors.textPrimary,
    shadowOffset: { width: 0, height: -5 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 10,
  },
  selectionSummary: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  selectionCount: {
    fontSize: 13.5,
    fontFamily: fonts.bold,
    color: colors.textPrimary,
  },
  clearText: {
    fontSize: 13.5,
    fontFamily: fonts.bold,
    color: colors.primary,
  },
  primaryButton: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderRadius: radius.lg,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.lg,
  },
  primaryButtonText: {
    fontSize: 15.5,
    fontFamily: fonts.bold,
    color: colors.white,
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  rosterControls: {
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.md,
  },
  selectEveryone: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  selectEveryoneTitle: {
    flex: 1,
    fontSize: 14,
    fontFamily: fonts.bold,
    color: colors.textPrimary,
  },
  selectEveryoneCount: {
    fontSize: 12.5,
    fontFamily: fonts.regular,
    color: colors.textFaint,
  },
  searchBox: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  searchInput: {
    flex: 1,
    paddingVertical: spacing.sm,
    fontSize: 14,
    fontFamily: fonts.regular,
    color: colors.textPrimary,
  },
  fullRosterGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  searchEmpty: {
    width: '100%',
    alignItems: 'center',
    paddingVertical: spacing.xxxl,
  },
  classroomHelp: {
    fontSize: 12.5,
    lineHeight: 19,
    fontFamily: fonts.regular,
    color: colors.textMuted,
    marginBottom: spacing.lg,
  },
  classroomList: {
    gap: spacing.sm,
  },
  infoBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginTop: spacing.lg,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.primaryLight,
  },
  infoBannerText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
    fontFamily: fonts.regular,
    color: colors.textSecondary,
  },
  loggingFor: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.xs,
    marginBottom: spacing.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
    backgroundColor: colors.primarySoft,
  },
  loggingForIcon: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loggingForCopy: {
    flex: 1,
  },
  loggingForLabel: {
    fontSize: 9.5,
    lineHeight: 12,
    fontFamily: fonts.bold,
    color: colors.textFaint,
    letterSpacing: 0.8,
  },
  loggingForValue: {
    marginTop: 1,
    fontSize: 13.5,
    fontFamily: fonts.bold,
    color: colors.textPrimary,
  },
  changeText: {
    fontSize: 12.5,
    fontFamily: fonts.bold,
    color: colors.primary,
  },
  logTypeGroup: {
    gap: spacing.sm,
  },
  logTypeRow: {
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  incidentRow: {
    borderColor: '#EFD9B5',
    backgroundColor: colors.amberLight,
  },
  logTypeIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  incidentIcon: {
    backgroundColor: '#F6E4C0',
  },
  logTypeCopy: {
    flex: 1,
  },
  logTypeTitle: {
    fontSize: 14,
    fontFamily: fonts.bold,
    color: colors.textPrimary,
  },
  logTypeSubtitle: {
    marginTop: 2,
    fontSize: 11.5,
    fontFamily: fonts.regular,
    color: colors.textFaint,
  },
  incidentTitle: {
    color: '#8A6D3B',
  },
  incidentSubtitle: {
    color: '#B0895A',
  },
  formCard: {
    gap: spacing.md,
    padding: spacing.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  formLabel: {
    fontSize: 11.5,
    fontFamily: fonts.bold,
    letterSpacing: 0.85,
    color: colors.textFaint,
  },
  choiceRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  wrapChoices: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  choiceChip: {
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
  },
  choiceChipSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight,
  },
  choiceChipText: {
    fontSize: 13,
    fontFamily: fonts.bold,
    color: colors.textSecondary,
  },
  choiceChipTextSelected: {
    color: colors.primary,
  },
  mealAmountControl: {
    flexDirection: 'row',
    padding: 3,
    borderRadius: radius.full,
    backgroundColor: colors.primarySoft,
  },
  mealAmountControlCompact: {
    flexShrink: 0,
  },
  mealAmountOption: {
    minHeight: 32,
    minWidth: 56,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    borderRadius: radius.full,
  },
  mealAmountOptionCompact: {
    minWidth: 48,
    paddingHorizontal: 7,
  },
  mealAmountOption_all: {
    backgroundColor: colors.success,
  },
  mealAmountOption_some: {
    backgroundColor: '#D9B36A',
  },
  mealAmountOption_none: {
    backgroundColor: colors.danger,
  },
  mealAmountOptionText: {
    fontSize: 11.5,
    fontFamily: fonts.bold,
    color: colors.textMuted,
  },
  mealAmountOptionTextSelected: {
    color: colors.white,
  },
  mealLoading: {
    minHeight: 170,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mealLoadingText: {
    marginTop: spacing.sm,
    fontSize: 12.5,
    fontFamily: fonts.regular,
    color: colors.textFaint,
  },
  menuPrefillCard: {
    gap: 6,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.primaryLight,
  },
  menuPrefillHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  menuPrefillBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.full,
    overflow: 'hidden',
    backgroundColor: colors.surface,
    fontSize: 9.5,
    fontFamily: fonts.bold,
    letterSpacing: 0.5,
    color: colors.primary,
  },
  menuEditText: {
    fontSize: 12.5,
    fontFamily: fonts.bold,
    color: colors.primary,
  },
  menuPrefillFood: {
    fontSize: 14.5,
    lineHeight: 21,
    fontFamily: fonts.bold,
    color: colors.textPrimary,
  },
  menuPrefillMeta: {
    fontSize: 11.5,
    fontFamily: fonts.regular,
    color: colors.textMuted,
  },
  menuInlineInput: {
    minHeight: 48,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    fontSize: 14,
    fontFamily: fonts.regular,
    color: colors.textPrimary,
  },
  noMenuBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.amberLight,
  },
  noMenuText: {
    flex: 1,
    fontSize: 12.5,
    lineHeight: 18,
    fontFamily: fonts.regular,
    color: colors.textSecondary,
  },
  mealAllergyBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.md,
    backgroundColor: colors.dangerLight,
  },
  mealAllergyText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
    fontFamily: fonts.regular,
    color: colors.textSecondary,
  },
  mealAllergyName: {
    fontFamily: fonts.bold,
    color: colors.danger,
  },
  mealChildrenCard: {
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  mealChildRow: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.sm,
  },
  mealChildRowBorder: {
    borderTopWidth: 1,
    borderTopColor: colors.borderSoft,
  },
  mealChildName: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    fontFamily: fonts.bold,
    color: colors.textPrimary,
  },
  setAllMealButton: {
    alignSelf: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  setAllMealText: {
    fontSize: 12.5,
    fontFamily: fonts.bold,
    color: colors.primary,
  },
  timeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
  },
  timeBannerText: {
    fontSize: 13,
    fontFamily: fonts.bold,
    color: colors.textSecondary,
  },
  textInput: {
    minHeight: 50,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    fontSize: 14.5,
    fontFamily: fonts.regular,
    color: colors.textPrimary,
  },
  multilineInput: {
    minHeight: 128,
  },
  photoPicker: {
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xxl,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.borderStrong,
    borderRadius: radius.lg,
    backgroundColor: colors.primarySoft,
  },
  photoPickerIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoPickerTitle: {
    marginTop: spacing.md,
    fontSize: 14,
    fontFamily: fonts.bold,
    color: colors.textPrimary,
  },
  photoPickerHint: {
    marginTop: spacing.xs,
    maxWidth: 270,
    fontSize: 12,
    lineHeight: 18,
    fontFamily: fonts.regular,
    color: colors.textFaint,
    textAlign: 'center',
  },
  photoPreviewWrap: {
    position: 'relative',
    overflow: 'hidden',
    height: 220,
    borderRadius: radius.lg,
    backgroundColor: colors.primarySoft,
  },
  photoPreview: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  photoRemove: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(23,51,91,0.78)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  successContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xxl,
  },
  successIcon: {
    width: 82,
    height: 82,
    borderRadius: 41,
    backgroundColor: colors.success,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.success,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.22,
    shadowRadius: 14,
    elevation: 8,
  },
  successTitle: {
    marginTop: spacing.xl,
    fontSize: 24,
    fontFamily: fonts.black,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  successDetail: {
    marginTop: spacing.sm,
    maxWidth: 310,
    fontSize: 14,
    lineHeight: 21,
    fontFamily: fonts.regular,
    color: colors.textMuted,
    textAlign: 'center',
  },
  successAudience: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.xl,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    backgroundColor: colors.primarySoft,
  },
  successAudienceText: {
    fontSize: 13,
    fontFamily: fonts.bold,
    color: colors.primary,
  },
  secondaryButton: {
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  secondaryButtonText: {
    fontSize: 15,
    fontFamily: fonts.bold,
    color: colors.textPrimary,
  },
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: spacing.md,
    fontSize: 13,
    fontFamily: fonts.regular,
    color: colors.textFaint,
  },
});
