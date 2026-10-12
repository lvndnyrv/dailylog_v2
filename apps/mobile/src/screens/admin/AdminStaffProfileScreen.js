import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { differenceInCalendarDays, format, parseISO } from 'date-fns';
import { PERMISSION_AREAS, emptyPermission } from '@dailylog/shared';

import { DatePickerField } from '../../components/DatePickerField';
import { LoadingScreen } from '../../components/ui';
import { showToast } from '../../components/Toast';
import { useAuth } from '../../hooks/useAuth';
import { useClassroom } from '../../hooks/useClassroom';
import { supabase } from '../../lib/supabase';
import { colors, fonts, radius, spacing } from '../../theme';

const ROLE_LABELS = { owner_admin: 'Owner admin', admin: 'Administrator', educator: 'Educator' };
const WEEKDAYS = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function firstRelation(value) {
  return Array.isArray(value) ? value[0] : value;
}

function initials(name) {
  return String(name || '').split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase();
}

function dateLabel(value) {
  if (!value) return 'Not set';
  const parsed = parseISO(value);
  return Number.isNaN(parsed.getTime()) ? value : format(parsed, 'MMM d, yyyy');
}

function timeLabel(value) {
  if (!value) return '—';
  const [hour, minute] = value.slice(0, 5).split(':').map(Number);
  const suffix = hour >= 12 ? 'PM' : 'AM';
  return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${suffix}`;
}

function credentialStatus(credential) {
  if (!credential.expires_on) return { label: 'No expiry', tone: 'neutral' };
  const days = differenceInCalendarDays(parseISO(credential.expires_on), new Date());
  if (days < 0) return { label: `Expired ${Math.abs(days)}d ago`, tone: 'danger' };
  if (days <= 30) return { label: `${days}d left`, tone: 'warning' };
  return { label: 'Current', tone: 'success' };
}

function isBackgroundCredential(credential) {
  return /(background|criminal record|vulnerable sector)/i.test(credential?.name || '');
}

function backgroundClearanceState(member, credential) {
  if (!member?.background_check_required) {
    return { clear: true, value: 'Clear', detail: 'Not required' };
  }
  if (!credential || !credential.completed_on || !credential.document_id) {
    return { clear: false, value: 'Due', detail: 'Does not count in ratio' };
  }
  if (credential.expires_on) {
    const days = differenceInCalendarDays(parseISO(credential.expires_on), new Date());
    if (days < 0) return { clear: false, value: 'Expired', detail: 'Does not count in ratio' };
    if (days <= 30) return { clear: true, value: 'Clear', detail: `${days}d until renewal` };
  }
  return { clear: true, value: 'Clear', detail: 'Verified' };
}

const PERMISSION_COLUMNS = [
  ['view', 'View'],
  ['edit', 'Edit'],
  ['approve', 'Approve'],
];

function normalizePermissions(value) {
  const source = value || {};
  const result = {};
  for (const group of PERMISSION_AREAS) {
    for (const item of group.items) {
      const cell = source[item.key] || {};
      result[item.key] = {
        view: Boolean(cell.view),
        edit: Boolean(cell.edit),
        approve: Boolean(cell.approve),
      };
    }
  }
  return result;
}

function normalizeSparsePermissions(value) {
  const source = value || {};
  const result = {};
  for (const group of PERMISSION_AREAS) {
    for (const item of group.items) {
      const cell = source[item.key];
      if (!cell) continue;
      const clean = {};
      for (const [key] of PERMISSION_COLUMNS) {
        if (typeof cell[key] === 'boolean') clean[key] = cell[key];
      }
      if (Object.keys(clean).length) result[item.key] = clean;
    }
  }
  return result;
}

function mergePermissions(base, override) {
  const result = {};
  for (const group of PERMISSION_AREAS) {
    for (const item of group.items) {
      result[item.key] = {
        ...(base[item.key] || emptyPermission()),
        ...(override[item.key] || {}),
      };
    }
  }
  return result;
}

function permissionDiff(base, value) {
  const result = {};
  for (const group of PERMISSION_AREAS) {
    for (const item of group.items) {
      const changed = {};
      for (const [key] of PERMISSION_COLUMNS) {
        if (base[item.key]?.[key] !== value[item.key]?.[key]) {
          changed[key] = Boolean(value[item.key]?.[key]);
        }
      }
      if (Object.keys(changed).length) result[item.key] = changed;
    }
  }
  return result;
}

function StaffPermissionsSheet({ visible, onClose, person, viewerId, onChangeRole }) {
  const [matrix, setMatrix] = useState(null);
  const [scope, setScope] = useState('all');
  const [draft, setDraft] = useState({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const rolePermissions = useMemo(
    () => normalizePermissions(matrix?.role_permissions),
    [matrix?.role_permissions],
  );
  const globalOverride = useMemo(
    () => normalizeSparsePermissions(matrix?.overrides?.find(item => item.classroom_id === null)?.permissions),
    [matrix?.overrides],
  );
  const scopedOverride = useMemo(() => scope === 'all'
    ? globalOverride
    : normalizeSparsePermissions(matrix?.overrides?.find(item => item.classroom_id === scope)?.permissions),
  [globalOverride, matrix?.overrides, scope]);
  const inherited = useMemo(
    () => scope === 'all' ? rolePermissions : mergePermissions(rolePermissions, globalOverride),
    [globalOverride, rolePermissions, scope],
  );
  const effective = useMemo(
    () => mergePermissions(inherited, scopedOverride),
    [inherited, scopedOverride],
  );
  const effectiveKey = JSON.stringify(effective);
  const dirty = JSON.stringify(draft) !== effectiveKey;
  const hasOverride = Object.keys(scopedOverride).length > 0;
  const locked = person?.role === 'owner_admin' || person?.id === viewerId;

  const loadMatrix = useCallback(async () => {
    if (!person?.id) return;
    setLoading(true);
    setError('');
    setMatrix(null);
    setDraft({});
    const { data, error: matrixError } = await supabase.rpc('get_staff_permission_matrix', {
      p_profile_id: person.id,
    });
    setLoading(false);
    if (matrixError) {
      setError(matrixError.message);
      setMatrix(null);
      return;
    }
    setMatrix(data);
  }, [person?.id]);

  React.useEffect(() => {
    if (!visible) return;
    setScope('all');
    loadMatrix();
  }, [loadMatrix, visible]);

  React.useEffect(() => {
    setDraft(effective);
  }, [effectiveKey]);

  function toggle(area, action) {
    if (locked) return;
    setDraft(current => ({
      ...current,
      [area]: {
        ...(current[area] || emptyPermission()),
        [action]: !current[area]?.[action],
      },
    }));
  }

  async function save({ reset = false } = {}) {
    if (locked) return;
    setSaving(true);
    setError('');
    const permissions = reset ? {} : permissionDiff(inherited, draft);
    const { error: saveError } = await supabase.rpc('save_staff_permission_override', {
      p_profile_id: person.id,
      p_classroom_id: scope === 'all' ? null : scope,
      p_permissions: permissions,
    });
    setSaving(false);
    if (saveError) {
      setError(saveError.message);
      return;
    }
    showToast(reset ? 'Permission override reset' : 'Permissions updated', 'success');
    onClose();
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.permissionSafeArea}>
        <View style={styles.permissionHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerEyebrow}>STAFF ACCESS</Text>
            <Text style={styles.permissionTitle}>Permissions for {person?.full_name}</Text>
          </View>
          <TouchableOpacity onPress={onClose} style={styles.closeButton} accessibilityLabel="Close staff permissions">
            <Ionicons name="close" size={20} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>

        {loading ? <LoadingScreen message="Loading permissions…" /> : error && !matrix ? (
          <View style={styles.permissionMessage}>
            <Ionicons name="alert-circle-outline" size={24} color={colors.coral} />
            <Text style={styles.formError}>{error}</Text>
            <TouchableOpacity onPress={loadMatrix} style={styles.retryButton}><Text style={styles.retryButtonText}>Try again</Text></TouchableOpacity>
          </View>
        ) : matrix ? (
          <>
            <ScrollView contentContainerStyle={styles.permissionContent}>
              <View style={styles.baseRoleCard}>
                <View style={styles.roleIcon}><Ionicons name="key-outline" size={20} color={colors.purple} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.permissionMeta}>BASE ROLE</Text>
                  <Text style={styles.roleTitle}>{matrix.role_name}</Text>
                  <Text style={styles.roleSubtitle}>Personal changes below affect only this team member.</Text>
                </View>
                {!locked ? (
                  <TouchableOpacity onPress={onChangeRole} style={styles.roleChangeButton} accessibilityRole="button">
                    <Text style={styles.roleChangeText}>{person.role === 'admin' ? 'Make educator' : 'Make admin'}</Text>
                  </TouchableOpacity>
                ) : null}
              </View>

              <Text style={styles.permissionMeta}>APPLY TO</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.roomRow}>
                {[{ id: 'all', name: 'All assigned rooms' }, ...(matrix.rooms || [])].map(item => {
                  const selected = scope === item.id;
                  return (
                    <TouchableOpacity key={item.id} onPress={() => setScope(item.id)} style={[styles.roomChip, selected && styles.roomChipSelected]} accessibilityRole="radio" accessibilityState={{ selected }}>
                      <Text style={[styles.roomChipText, selected && styles.roomChipTextSelected]}>{item.name}</Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              <View style={styles.permissionMatrix}>
                <View style={styles.permissionMatrixHeader}>
                  <Text style={[styles.permissionColumnLabel, { flex: 1, textAlign: 'left' }]}>AREA</Text>
                  {PERMISSION_COLUMNS.map(([key, label]) => <Text key={key} style={styles.permissionColumnLabel}>{label.toUpperCase()}</Text>)}
                </View>
                {PERMISSION_AREAS.map(group => (
                  <View key={group.group}>
                    <Text style={styles.permissionGroup}>{group.group}</Text>
                    {group.items.map(item => (
                      <View key={item.key} style={styles.permissionRow}>
                        <Text style={styles.permissionArea}>{item.label}</Text>
                        {PERMISSION_COLUMNS.map(([action, label]) => {
                          const on = Boolean(draft[item.key]?.[action]);
                          const changed = inherited[item.key]?.[action] !== on;
                          return (
                            <TouchableOpacity
                              key={action}
                              onPress={() => toggle(item.key, action)}
                              disabled={locked}
                              style={[styles.permissionCell, on && styles.permissionCellOn]}
                              accessibilityRole="checkbox"
                              accessibilityState={{ checked: on, disabled: locked }}
                              accessibilityLabel={`${item.label}: ${label}`}
                            >
                              {on ? <Ionicons name="checkmark" size={15} color={colors.white} /> : null}
                              {changed ? <View style={styles.permissionChanged} /> : null}
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    ))}
                  </View>
                ))}
              </View>

              <Text style={styles.permissionFootnote}>
                {locked
                  ? person?.id === viewerId ? 'Another administrator must update your permissions.' : 'Owner access is always fully enabled.'
                  : 'Purple dots mark personal changes. Updates are audited and the educator is notified.'}
              </Text>
              {error ? <Text style={styles.formError}>{error}</Text> : null}
            </ScrollView>

            {!locked ? (
              <View style={styles.permissionActions}>
                <TouchableOpacity style={[styles.resetButton, (!hasOverride && !dirty) && styles.disabledButton]} onPress={() => save({ reset: true })} disabled={saving || (!hasOverride && !dirty)}>
                  <Text style={styles.resetButtonText}>Reset scope</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.saveButton, styles.permissionSave, (!dirty || saving) && styles.disabledButton]} onPress={() => save()} disabled={saving || !dirty}>
                  {saving ? <ActivityIndicator color={colors.white} /> : <Text style={styles.saveButtonText}>Save override</Text>}
                </TouchableOpacity>
              </View>
            ) : null}
          </>
        ) : null}
      </SafeAreaView>
    </Modal>
  );
}

function scheduleDraft(schedule) {
  return WEEKDAYS.slice(1).map((label, index) => {
    const weekday = index + 1;
    const existing = schedule.find(item => item.weekday === weekday);
    return {
      weekday,
      label,
      enabled: Boolean(existing),
      startsLocal: existing?.starts_local?.slice(0, 5) || '08:00',
      endsLocal: existing?.ends_local?.slice(0, 5) || '16:00',
      breakMinutes: String(existing?.unpaid_break_minutes ?? 30),
    };
  });
}

function ScheduleEditorSheet({ visible, onClose, onSaved, member, person, schedule, roomName }) {
  const [rows, setRows] = useState([]);
  const [initialKey, setInitialKey] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const currentKey = JSON.stringify(rows);
  const dirty = currentKey !== initialKey;

  React.useEffect(() => {
    if (!visible) return;
    const nextRows = scheduleDraft(schedule);
    setRows(nextRows);
    setInitialKey(JSON.stringify(nextRows));
    setError('');
  }, [schedule, visible]);

  function updateRow(index, changes) {
    setRows(current => current.map((row, rowIndex) => rowIndex === index ? { ...row, ...changes } : row));
    if (error) setError('');
  }

  async function publish(payload) {
    setSaving(true);
    setError('');
    const { data, error: saveError } = await supabase.rpc('save_staff_regular_schedule', {
      p_staff_member_id: member.id,
      p_schedule: payload,
    });
    setSaving(false);
    if (saveError) {
      setError(saveError.message);
      return;
    }
    onClose();
    await onSaved(Number(data || 0));
  }

  async function save() {
    const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
    const payload = [];
    for (const row of rows) {
      if (!row.enabled) continue;
      const breakMinutes = Number(row.breakMinutes || 0);
      if (!timePattern.test(row.startsLocal) || !timePattern.test(row.endsLocal) || row.endsLocal <= row.startsLocal) {
        setError(`${row.label} needs an end time after its start time.`);
        return;
      }
      const shiftMinutes = Number(row.endsLocal.slice(0, 2)) * 60 + Number(row.endsLocal.slice(3, 5))
        - Number(row.startsLocal.slice(0, 2)) * 60 - Number(row.startsLocal.slice(3, 5));
      if (!Number.isInteger(breakMinutes) || breakMinutes < 0 || breakMinutes >= shiftMinutes) {
        setError(`${row.label}'s unpaid break must be shorter than the shift.`);
        return;
      }
      payload.push({
        weekday: row.weekday,
        starts_local: row.startsLocal,
        ends_local: row.endsLocal,
        unpaid_break_minutes: breakMinutes,
        classroom_id: person?.classroom_id || null,
      });
    }

    if (!payload.length) {
      Alert.alert(
        'Clear the regular schedule?',
        'This removes the published weekly pattern and its future generated shifts. Manual shifts remain available.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Clear schedule', style: 'destructive', onPress: () => publish(payload) },
        ],
      );
      return;
    }
    await publish(payload);
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.permissionSafeArea}>
        <View style={styles.permissionHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerEyebrow}>PUBLISHED SHIFTS</Text>
            <Text style={styles.permissionTitle}>Regular schedule</Text>
            <Text style={styles.sheetSubtitle}>{person?.full_name} · {roomName || 'Center coverage'}</Text>
          </View>
          <TouchableOpacity onPress={onClose} style={styles.closeButton} accessibilityLabel="Close regular schedule editor">
            <Ionicons name="close" size={20} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.scheduleEditorContent} keyboardShouldPersistTaps="handled">
          <View style={styles.scheduleNotice}>
            <Ionicons name="calendar-outline" size={20} color={colors.primary} />
            <Text style={styles.scheduleNoticeText}>Saving publishes the next 12 weeks to the educator’s My time screen. Manual shift overrides are preserved.</Text>
          </View>

          <View style={styles.scheduleEditorHeader}>
            <Text style={[styles.permissionColumnLabel, { flex: 1, textAlign: 'left' }]}>DAY</Text>
            <Text style={styles.scheduleInputLabel}>START</Text>
            <Text style={styles.scheduleInputLabel}>END</Text>
            <Text style={styles.scheduleBreakLabel}>BREAK</Text>
          </View>
          {rows.map((row, index) => (
            <View key={row.weekday} style={[styles.scheduleEditorRow, !row.enabled && styles.scheduleEditorRowDisabled]}>
              <TouchableOpacity
                onPress={() => updateRow(index, { enabled: !row.enabled })}
                style={[styles.dayToggle, row.enabled && styles.dayToggleOn]}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: row.enabled }}
                accessibilityLabel={`${row.label} scheduled`}
              >
                {row.enabled ? <Ionicons name="checkmark" size={15} color={colors.white} /> : null}
              </TouchableOpacity>
              <Text style={styles.scheduleEditorDay}>{row.label}</Text>
              <TextInput
                value={row.startsLocal}
                onChangeText={value => updateRow(index, { startsLocal: value })}
                editable={row.enabled}
                placeholder="08:00"
                placeholderTextColor={colors.textFaint}
                style={styles.scheduleTimeInput}
                keyboardType="numbers-and-punctuation"
                maxLength={5}
                accessibilityLabel={`${row.label} start time`}
              />
              <TextInput
                value={row.endsLocal}
                onChangeText={value => updateRow(index, { endsLocal: value })}
                editable={row.enabled}
                placeholder="16:00"
                placeholderTextColor={colors.textFaint}
                style={styles.scheduleTimeInput}
                keyboardType="numbers-and-punctuation"
                maxLength={5}
                accessibilityLabel={`${row.label} end time`}
              />
              <TextInput
                value={row.breakMinutes}
                onChangeText={value => updateRow(index, { breakMinutes: value.replace(/\D/g, '') })}
                editable={row.enabled}
                placeholder="30"
                placeholderTextColor={colors.textFaint}
                style={styles.scheduleBreakInput}
                keyboardType="number-pad"
                maxLength={3}
                accessibilityLabel={`${row.label} unpaid break minutes`}
              />
            </View>
          ))}
          {error ? <Text style={styles.formError}>{error}</Text> : null}
        </ScrollView>

        <View style={styles.scheduleActions}>
          <TouchableOpacity style={styles.resetButton} onPress={onClose} disabled={saving}>
            <Text style={styles.resetButtonText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.saveButton, styles.permissionSave, (!dirty || saving) && styles.disabledButton]} onPress={save} disabled={!dirty || saving}>
            {saving ? <ActivityIndicator color={colors.white} /> : <Text style={styles.saveButtonText}>Publish schedule</Text>}
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

function InfoRow({ icon, label, value }) {
  return (
    <View style={styles.infoRow}>
      <View style={styles.infoIcon}><Ionicons name={icon} size={17} color={colors.primary} /></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.infoLabel}>{label}</Text>
        <Text style={styles.infoValue}>{value || '—'}</Text>
      </View>
    </View>
  );
}

function Shortcut({ icon, title, subtitle, onPress, tone = 'blue' }) {
  const palette = tone === 'amber'
    ? { bg: colors.amberLight, fg: colors.amber }
    : tone === 'green'
      ? { bg: colors.successLight, fg: colors.success }
      : { bg: colors.primaryLight, fg: colors.primary };
  return (
    <TouchableOpacity style={styles.shortcut} onPress={onPress} activeOpacity={0.76} accessibilityRole="button">
      <View style={[styles.shortcutIcon, { backgroundColor: palette.bg }]}>
        <Ionicons name={icon} size={20} color={palette.fg} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.shortcutTitle}>{title}</Text>
        <Text style={styles.shortcutSubtitle}>{subtitle}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
    </TouchableOpacity>
  );
}

function EditStaffSheet({ visible, onClose, onSaved, member, person, classrooms }) {
  const [jobTitle, setJobTitle] = useState('');
  const [employmentType, setEmploymentType] = useState('full_time');
  const [startedOn, setStartedOn] = useState('');
  const [roomId, setRoomId] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  React.useEffect(() => {
    if (!visible) return;
    setJobTitle(member?.job_title || '');
    setEmploymentType(member?.employment_type || 'full_time');
    setStartedOn(member?.started_on || '');
    setRoomId(person?.classroom_id || null);
    setError('');
  }, [member?.employment_type, member?.job_title, member?.started_on, person?.classroom_id, visible]);

  async function save() {
    if (!jobTitle.trim()) {
      setError('Job title is required.');
      return;
    }
    setSaving(true);
    const { error: saveError } = await supabase.rpc('admin_update_staff_record', {
      p_staff_member_id: member.id,
      p_job_title: jobTitle.trim(),
      p_employment_type: employmentType,
      p_started_on: startedOn || null,
      p_classroom_id: roomId || null,
    });
    setSaving(false);
    if (saveError) {
      setError(saveError.message);
      return;
    }
    onClose();
    await onSaved();
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.sheetOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <TouchableOpacity style={styles.sheetDismiss} activeOpacity={1} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.grabber} />
          <View style={styles.sheetHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.sheetTitle}>Edit staff record</Text>
              <Text style={styles.sheetSubtitle}>Employment details maintained by administrators.</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeButton} accessibilityLabel="Close edit staff record">
              <Ionicons name="close" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <Text style={styles.fieldLabel}>Job title <Text style={styles.required}>*</Text></Text>
          <TextInput
            value={jobTitle}
            onChangeText={value => { setJobTitle(value); if (error) setError(''); }}
            placeholder="Lead educator"
            placeholderTextColor={colors.textFaint}
            style={[styles.input, error && !jobTitle.trim() && styles.inputError]}
            autoCapitalize="words"
            accessibilityLabel="Job title required"
          />

          <Text style={styles.fieldLabel}>Employment</Text>
          <View style={styles.segmentRow}>
            {[['full_time', 'Full-time'], ['part_time', 'Part-time'], ['casual', 'Casual'], ['contract', 'Contract']].map(([value, label]) => {
              const selected = employmentType === value;
              return (
                <TouchableOpacity key={value} style={[styles.segment, selected && styles.segmentSelected]} onPress={() => setEmploymentType(value)} accessibilityRole="radio" accessibilityState={{ selected }}>
                  <Text style={[styles.segmentText, selected && styles.segmentTextSelected]}>{label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <DatePickerField label="Start date" value={startedOn} onChange={setStartedOn} />

          <Text style={styles.fieldLabel}>Home classroom</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.roomRow}>
            {[{ id: null, name: 'Unassigned' }, ...classrooms].map(room => {
              const selected = roomId === room.id;
              return (
                <TouchableOpacity key={room.id || 'none'} style={[styles.roomChip, selected && styles.roomChipSelected]} onPress={() => setRoomId(room.id)} accessibilityRole="radio" accessibilityState={{ selected }}>
                  <Text style={[styles.roomChipText, selected && styles.roomChipTextSelected]}>{room.name}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {error ? <Text style={styles.formError}>{error}</Text> : null}
          <TouchableOpacity style={[styles.saveButton, saving && styles.disabledButton]} onPress={save} disabled={saving}>
            {saving ? <ActivityIndicator color={colors.white} /> : <Text style={styles.saveButtonText}>Save record</Text>}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export default function AdminStaffProfileScreen({ navigation, route }) {
  const { profile: currentProfile } = useAuth();
  const { classrooms } = useClassroom();
  const person = route.params?.person;
  const [member, setMember] = useState(null);
  const [credentials, setCredentials] = useState([]);
  const [schedule, setSchedule] = useState([]);
  const [timeOff, setTimeOff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [editOpen, setEditOpen] = useState(false);
  const [permissionsOpen, setPermissionsOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [startingMessage, setStartingMessage] = useState(false);
  const [changingStatus, setChangingStatus] = useState(false);
  const room = classrooms.find(item => item.id === person?.classroom_id);

  const load = useCallback(async ({ refresh = false } = {}) => {
    if (!person?.id) return;
    refresh ? setRefreshing(true) : setLoading(true);
    setError('');
    const memberRes = await supabase.from('staff_members')
      .select('id, profile_id, job_title, employment_type, status, started_on, ended_on, annual_paid_leave_days, background_check_required')
      .eq('profile_id', person.id).maybeSingle();
    if (memberRes.error) {
      setError(memberRes.error.message);
      setMember(null);
      setCredentials([]);
      setSchedule([]);
      setTimeOff([]);
    } else {
      const staffMember = memberRes.data || null;
      setMember(staffMember);
      if (staffMember) {
        const [credentialRes, scheduleRes, timeOffRes] = await Promise.all([
          supabase.from('staff_credentials')
            .select('id, name, issuer, completed_on, expires_on, document_id, required, ratio_qualifying')
            .eq('staff_member_id', staffMember.id).is('archived_at', null).order('expires_on'),
          supabase.from('staff_regular_schedules')
            .select('id, weekday, starts_local, ends_local, unpaid_break_minutes, classroom:classrooms(name)')
            .eq('staff_member_id', staffMember.id).order('weekday'),
          supabase.from('staff_time_off_requests')
            .select('id, starts_on, ends_on, kind, status')
            .eq('staff_member_id', staffMember.id).order('starts_on', { ascending: false }).limit(3),
        ]);
        const detailError = credentialRes.error || scheduleRes.error || timeOffRes.error;
        if (detailError) setError(detailError.message);
        setCredentials(credentialRes.data || []);
        setSchedule(scheduleRes.data || []);
        setTimeOff(timeOffRes.data || []);
      }
    }
    setLoading(false);
    setRefreshing(false);
  }, [person?.id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const credentialCounts = useMemo(() => credentials.reduce((counts, credential) => {
    if (credential.required && (!credential.completed_on || !credential.document_id)) {
      counts.missing += 1;
      return counts;
    }
    const status = credentialStatus(credential).tone;
    if (status === 'danger') counts.expired += 1;
    else if (status === 'warning') counts.expiring += 1;
    else counts.current += 1;
    return counts;
  }, { current: 0, expiring: 0, expired: 0, missing: 0 }), [credentials]);
  const backgroundCredential = useMemo(
    () => credentials.find(isBackgroundCredential) || null,
    [credentials],
  );
  const backgroundState = useMemo(
    () => backgroundClearanceState(member, backgroundCredential),
    [backgroundCredential, member],
  );

  async function startMessage() {
    if (person.id === currentProfile.id) return;
    setStartingMessage(true);
    const { data, error: messageError } = await supabase.rpc('get_or_create_staff_conversation', { p_other_profile_id: person.id });
    setStartingMessage(false);
    if (messageError) {
      Alert.alert('Could not start message', messageError.message);
      return;
    }
    navigation.navigate('StaffConversation', {
      conversationId: data,
      otherProfileId: person.id,
      otherName: person.full_name,
      otherRole: person.role,
    });
  }

  function changeRole() {
    if (person.id === currentProfile.id) {
      Alert.alert('Not allowed', 'You cannot change your own role.');
      return;
    }
    if (person.role === 'owner_admin') {
      Alert.alert('Owner protected', 'The center owner role cannot be changed from this screen.');
      return;
    }
    const nextRole = person.role === 'admin' ? 'educator' : 'admin';
    Alert.alert(
      `Make ${ROLE_LABELS[nextRole]}?`,
      `${person.full_name}'s access will change immediately.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm',
          onPress: async () => {
            const { error: roleError } = await supabase.rpc('admin_set_user_role', { p_user_id: person.id, p_role: nextRole });
            if (roleError) Alert.alert('Could not change role', roleError.message);
            else {
              person.role = nextRole;
              showToast(`${person.full_name} is now ${ROLE_LABELS[nextRole]}`, 'success');
              navigation.goBack();
            }
          },
        },
      ],
    );
  }

  function changeAccountStatus() {
    if (!member || person.id === currentProfile.id || person.role === 'owner_admin') return;
    const activating = member.status !== 'active';
    Alert.alert(
      activating ? 'Restore center access?' : 'Deactivate team member?',
      activating
        ? `${person.full_name} will be able to sign in and use their assigned center features again.`
        : `${person.full_name} will leave the active roster and lose center access. Their time, credential and audit history will remain available.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: activating ? 'Restore access' : 'Deactivate',
          style: activating ? 'default' : 'destructive',
          onPress: async () => {
            setChangingStatus(true);
            const { error: statusError } = await supabase.rpc('admin_set_staff_active', {
              p_staff_member_id: member.id,
              p_active: activating,
            });
            setChangingStatus(false);
            if (statusError) {
              Alert.alert(activating ? 'Could not restore access' : 'Could not deactivate account', statusError.message);
              return;
            }
            showToast(activating ? 'Center access restored' : 'Center access deactivated', 'success');
            await load({ refresh: true });
          },
        },
      ],
    );
  }

  if (loading && !member) return <LoadingScreen />;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerButton} accessibilityLabel="Back to people">
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerEyebrow}>STAFF RECORD</Text>
          <Text style={styles.headerTitle}>Team member</Text>
        </View>
        {member ? (
          <TouchableOpacity onPress={() => setEditOpen(true)} style={styles.editButton} accessibilityLabel="Edit staff record">
            <Ionicons name="create-outline" size={17} color={colors.primary} />
            <Text style={styles.editButtonText}>Edit</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load({ refresh: true })} tintColor={colors.primary} />}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.identityCard}>
          <View style={styles.avatar}><Text style={styles.avatarText}>{initials(person?.full_name)}</Text></View>
          <View style={styles.identityCopy}>
            <Text style={styles.personName}>{person?.full_name || 'Team member'}</Text>
            <Text style={styles.personRole}>{member?.job_title || ROLE_LABELS[person?.role] || person?.role}</Text>
            <View style={styles.identityMeta}>
              <View style={[styles.activeDot, member?.status !== 'active' && styles.inactiveDot]} />
              <Text style={styles.identityMetaText}>{member?.status === 'active' ? 'Active' : member?.status || 'Connected'}{room ? ` · ${room.name}` : ''}</Text>
            </View>
          </View>
          {person?.id !== currentProfile.id ? (
            <TouchableOpacity style={styles.messageButton} onPress={startMessage} disabled={startingMessage} accessibilityLabel={`Message ${person?.full_name}`}>
              {startingMessage ? <ActivityIndicator color={colors.primary} /> : <Ionicons name="chatbubble-outline" size={20} color={colors.primary} />}
            </TouchableOpacity>
          ) : null}
        </View>

        {error ? (
          <TouchableOpacity style={styles.errorCard} onPress={() => load({ refresh: true })}>
            <Ionicons name="cloud-offline-outline" size={19} color={colors.coral} />
            <Text style={styles.errorText}>Some staff details could not refresh. Tap to retry.</Text>
          </TouchableOpacity>
        ) : null}

        <Text style={styles.sectionTitle}>Employment</Text>
        <View style={styles.card}>
          <InfoRow icon="mail-outline" label="Work email" value={person?.email} />
          <View style={styles.divider} />
          <InfoRow icon="briefcase-outline" label="Employment" value={member?.employment_type?.replace('_', '-') || 'Not set'} />
          <View style={styles.divider} />
          <InfoRow icon="calendar-outline" label="Started" value={dateLabel(member?.started_on)} />
          <View style={styles.divider} />
          <InfoRow icon="school-outline" label="Home classroom" value={room?.name || 'Unassigned'} />
        </View>

        <Text style={styles.sectionTitle}>Readiness</Text>
        <View style={styles.readinessGrid}>
          <TouchableOpacity style={styles.readinessCard} onPress={() => navigation.navigate('AdminCredentials')}>
            <View style={[styles.readinessIcon, (credentialCounts.missing || credentialCounts.expired) && styles.readinessIconAlert]}>
              <Ionicons name="shield-checkmark-outline" size={20} color={credentialCounts.missing || credentialCounts.expired ? colors.coral : colors.success} />
            </View>
            <Text style={styles.readinessValue}>{credentials.length}</Text>
            <Text style={styles.readinessLabel}>Credentials</Text>
            <Text style={[styles.readinessStatus, (credentialCounts.missing || credentialCounts.expired) && styles.dangerText]}>
              {credentialCounts.missing ? `${credentialCounts.missing} missing` : credentialCounts.expired ? `${credentialCounts.expired} expired` : credentialCounts.expiring ? `${credentialCounts.expiring} expiring` : 'Current'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.readinessCard, !backgroundState.clear && styles.readinessCardWarning]}
            onPress={() => navigation.navigate('AdminCredentials', {
              staffMemberId: member?.id,
              credentialId: backgroundCredential?.id,
            })}
            accessibilityRole="button"
            accessibilityLabel={`Background clearance ${backgroundState.value}. Open credential requirements.`}
          >
            <View style={[styles.readinessIcon, !backgroundState.clear && styles.readinessIconWarning]}>
              <Ionicons name="finger-print-outline" size={20} color={!backgroundState.clear ? colors.amber : colors.success} />
            </View>
            <Text style={styles.readinessValue}>{backgroundState.value}</Text>
            <Text style={styles.readinessLabel}>Background</Text>
            <Text style={[styles.readinessStatus, !backgroundState.clear && styles.warningText]}>{backgroundState.detail}</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.sectionHeadingRow}>
          <Text style={styles.sectionTitle}>Regular schedule</Text>
          {member?.status === 'active' ? (
            <TouchableOpacity onPress={() => setScheduleOpen(true)} style={styles.sectionAction} accessibilityRole="button">
              <Ionicons name="create-outline" size={15} color={colors.primary} />
              <Text style={styles.sectionActionText}>Edit schedule</Text>
            </TouchableOpacity>
          ) : null}
        </View>
        <View style={styles.card}>
          {schedule.length ? schedule.map((shift, index) => (
            <View key={shift.id}>
              {index ? <View style={styles.divider} /> : null}
              <View style={styles.scheduleRow}>
                <View style={styles.dayBadge}><Text style={styles.dayText}>{WEEKDAYS[shift.weekday] || shift.weekday}</Text></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.scheduleTime}>{timeLabel(shift.starts_local)} – {timeLabel(shift.ends_local)}</Text>
                  <Text style={styles.scheduleRoom}>{firstRelation(shift.classroom)?.name || room?.name || 'Center coverage'}</Text>
                </View>
              </View>
            </View>
          )) : (
            <View style={styles.emptyRow}>
              <Ionicons name="calendar-clear-outline" size={20} color={colors.textFaint} />
              <Text style={styles.emptyText}>No regular schedule has been published.</Text>
            </View>
          )}
        </View>

        <Text style={styles.sectionTitle}>Recent time off</Text>
        <View style={styles.card}>
          {timeOff.length ? timeOff.map((request, index) => (
            <View key={request.id}>
              {index ? <View style={styles.divider} /> : null}
              <View style={styles.timeOffRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.timeOffDates}>{dateLabel(request.starts_on)}{request.ends_on !== request.starts_on ? ` – ${dateLabel(request.ends_on)}` : ''}</Text>
                  <Text style={styles.timeOffKind}>{request.kind?.replace('_', ' ') || 'Time off'}</Text>
                </View>
                <View style={[styles.requestBadge, request.status === 'approved' ? styles.requestApproved : request.status === 'pending' ? styles.requestPending : styles.requestNeutral]}>
                  <Text style={styles.requestText}>{request.status}</Text>
                </View>
              </View>
            </View>
          )) : <Text style={styles.emptyText}>No recent requests.</Text>}
        </View>

        <Shortcut icon="calendar-outline" title="Manage time off" subtitle="Review requests and coverage impact" onPress={() => navigation.navigate('AdminTimeOff')} tone="amber" />
        <Shortcut icon="shield-checkmark-outline" title="Credential reviews" subtitle="Renewals, documents and expiry watch" onPress={() => navigation.navigate('AdminCredentials')} tone="green" />

        <Text style={styles.sectionTitle}>Access</Text>
        <TouchableOpacity style={styles.roleCard} onPress={() => setPermissionsOpen(true)} accessibilityRole="button">
          <View style={styles.roleIcon}><Ionicons name="key-outline" size={20} color={colors.purple} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.roleTitle}>{ROLE_LABELS[person?.role] || person?.role}</Text>
            <Text style={styles.roleSubtitle}>{person?.id === currentProfile.id ? 'Review your inherited access.' : person?.role === 'owner_admin' ? 'Owner access is protected.' : 'Review role and personal permissions.'}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
        </TouchableOpacity>

        {member && person?.id !== currentProfile.id && person?.role !== 'owner_admin' ? (
          <View style={[styles.lifecycleCard, member.status !== 'active' && styles.lifecycleCardInactive]}>
            <View style={[styles.lifecycleIcon, member.status !== 'active' && styles.lifecycleIconInactive]}>
              <Ionicons name={member.status === 'active' ? 'person-remove-outline' : 'person-add-outline'} size={21} color={member.status === 'active' ? colors.coral : colors.success} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.lifecycleTitle}>{member.status === 'active' ? 'Leaving the center?' : 'Account inactive'}</Text>
              <Text style={styles.lifecycleText}>
                {member.status === 'active'
                  ? 'End app access while preserving employment, time and compliance history.'
                  : 'Restore this person to the active roster and reinstate center access.'}
              </Text>
              <TouchableOpacity
                style={[styles.lifecycleButton, member.status !== 'active' && styles.lifecycleButtonRestore]}
                onPress={changeAccountStatus}
                disabled={changingStatus}
                accessibilityLabel={member.status === 'active' ? `Deactivate ${person.full_name}` : `Restore ${person.full_name}'s center access`}
              >
                {changingStatus ? (
                  <ActivityIndicator color={member.status === 'active' ? colors.coral : colors.success} />
                ) : (
                  <Text style={[styles.lifecycleButtonText, member.status !== 'active' && styles.lifecycleButtonTextRestore]}>
                    {member.status === 'active' ? 'Deactivate account' : 'Restore access'}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        ) : null}
      </ScrollView>

      <EditStaffSheet
        visible={editOpen}
        onClose={() => setEditOpen(false)}
        onSaved={async () => { showToast('Staff record updated', 'success'); await load({ refresh: true }); }}
        member={member}
        person={person}
        classrooms={classrooms}
      />
      <StaffPermissionsSheet
        visible={permissionsOpen}
        onClose={() => setPermissionsOpen(false)}
        person={person}
        viewerId={currentProfile?.id}
        onChangeRole={() => {
          setPermissionsOpen(false);
          changeRole();
        }}
      />
      <ScheduleEditorSheet
        visible={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
        onSaved={async generated => {
          showToast(`Schedule published · ${generated} upcoming shifts`, 'success');
          await load({ refresh: true });
        }}
        member={member}
        person={person}
        schedule={schedule}
        roomName={room?.name}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  header: { minHeight: 66, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.borderSoft, backgroundColor: colors.surface },
  headerButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: colors.background },
  headerEyebrow: { fontFamily: fonts.bold, fontSize: 9.5, letterSpacing: 1.2, color: colors.primary },
  headerTitle: { fontFamily: fonts.bold, fontSize: 18, color: colors.textPrimary, marginTop: 1 },
  editButton: { minHeight: 38, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: spacing.md, borderRadius: radius.md, backgroundColor: colors.primaryLight },
  editButtonText: { fontFamily: fonts.bold, fontSize: 12, color: colors.primary },
  content: { padding: spacing.lg, paddingBottom: 48 },
  identityCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg, marginBottom: spacing.lg, borderRadius: radius.xl, backgroundColor: colors.primaryLight },
  avatar: { width: 62, height: 62, alignItems: 'center', justifyContent: 'center', borderRadius: 21, backgroundColor: colors.surface },
  avatarText: { fontFamily: fonts.bold, fontSize: 20, color: colors.primary },
  identityCopy: { flex: 1, minWidth: 0 },
  personName: { fontFamily: fonts.bold, fontSize: 20, color: colors.textPrimary },
  personRole: { fontFamily: fonts.regular, fontSize: 13, color: colors.textSecondary, marginTop: 2 },
  identityMeta: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 7 },
  activeDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.success },
  inactiveDot: { backgroundColor: colors.textFaint },
  identityMetaText: { fontFamily: fonts.bold, fontSize: 11, color: colors.textSecondary },
  messageButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: colors.surface },
  errorCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, marginBottom: spacing.lg, borderRadius: radius.md, backgroundColor: colors.dangerLight },
  errorText: { flex: 1, fontFamily: fonts.regular, fontSize: 12, color: colors.coral },
  sectionTitle: { fontFamily: fonts.bold, fontSize: 16, color: colors.textPrimary, marginTop: spacing.lg, marginBottom: spacing.sm },
  sectionHeadingRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  sectionAction: { minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: spacing.sm, marginBottom: 3, borderRadius: radius.md, backgroundColor: colors.primaryLight },
  sectionActionText: { fontFamily: fonts.bold, fontSize: 11, color: colors.primary },
  card: { overflow: 'hidden', borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface },
  infoRow: { minHeight: 62, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  infoIcon: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: colors.primarySoft },
  infoLabel: { fontFamily: fonts.regular, fontSize: 11, color: colors.textMuted },
  infoValue: { fontFamily: fonts.bold, fontSize: 13.5, color: colors.textPrimary, marginTop: 2, textTransform: 'capitalize' },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: spacing.md, backgroundColor: colors.borderSoft },
  readinessGrid: { flexDirection: 'row', gap: spacing.sm },
  readinessCard: { flex: 1, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface },
  readinessCardWarning: { borderColor: colors.amber },
  readinessIcon: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: colors.successLight },
  readinessIconAlert: { backgroundColor: colors.dangerLight },
  readinessIconWarning: { backgroundColor: colors.amberLight },
  readinessValue: { fontFamily: fonts.bold, fontSize: 19, color: colors.textPrimary, marginTop: spacing.sm },
  readinessLabel: { fontFamily: fonts.bold, fontSize: 12, color: colors.textSecondary, marginTop: 1 },
  readinessStatus: { fontFamily: fonts.regular, fontSize: 10.5, color: colors.success, marginTop: 4 },
  dangerText: { color: colors.coral },
  warningText: { color: colors.amber },
  scheduleRow: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md },
  dayBadge: { width: 42, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: colors.primaryLight },
  dayText: { fontFamily: fonts.bold, fontSize: 11, color: colors.primary },
  scheduleTime: { fontFamily: fonts.bold, fontSize: 13, color: colors.textPrimary },
  scheduleRoom: { fontFamily: fonts.regular, fontSize: 11, color: colors.textMuted, marginTop: 3 },
  emptyRow: { minHeight: 70, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.md },
  emptyText: { fontFamily: fonts.regular, fontSize: 12, color: colors.textMuted, padding: spacing.md },
  timeOffRow: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md },
  timeOffDates: { fontFamily: fonts.bold, fontSize: 12.5, color: colors.textPrimary },
  timeOffKind: { fontFamily: fonts.regular, fontSize: 11, color: colors.textMuted, marginTop: 3, textTransform: 'capitalize' },
  requestBadge: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: radius.full },
  requestApproved: { backgroundColor: colors.successLight },
  requestPending: { backgroundColor: colors.amberLight },
  requestNeutral: { backgroundColor: colors.background },
  requestText: { fontFamily: fonts.bold, fontSize: 10, color: colors.textSecondary, textTransform: 'capitalize' },
  shortcut: { minHeight: 70, flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, marginTop: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface },
  shortcutIcon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 14 },
  shortcutTitle: { fontFamily: fonts.bold, fontSize: 14, color: colors.textPrimary },
  shortcutSubtitle: { fontFamily: fonts.regular, fontSize: 11.5, color: colors.textSecondary, marginTop: 3 },
  roleCard: { minHeight: 70, flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface },
  roleIcon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: colors.purpleLight },
  roleTitle: { fontFamily: fonts.bold, fontSize: 14, color: colors.textPrimary },
  roleSubtitle: { fontFamily: fonts.regular, fontSize: 11.5, lineHeight: 16, color: colors.textSecondary, marginTop: 3 },
  permissionSafeArea: { flex: 1, backgroundColor: colors.background },
  permissionHeader: { minHeight: 70, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.borderSoft, backgroundColor: colors.surface },
  permissionTitle: { fontFamily: fonts.bold, fontSize: 19, color: colors.textPrimary, marginTop: 2 },
  permissionContent: { padding: spacing.lg, paddingBottom: spacing.xl },
  permissionMessage: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xl },
  retryButton: { minHeight: 42, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg, borderRadius: radius.md, backgroundColor: colors.primary },
  retryButtonText: { fontFamily: fonts.bold, fontSize: 13, color: colors.white },
  baseRoleCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, marginBottom: spacing.lg, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface },
  permissionMeta: { fontFamily: fonts.bold, fontSize: 9.5, letterSpacing: 1, color: colors.textFaint, marginBottom: spacing.sm },
  roleChangeButton: { minHeight: 36, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.sm, borderWidth: 1, borderColor: colors.primary, borderRadius: radius.md, backgroundColor: colors.primaryLight },
  roleChangeText: { fontFamily: fonts.bold, fontSize: 10.5, color: colors.primary },
  permissionMatrix: { overflow: 'hidden', marginTop: spacing.lg, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface },
  permissionMatrixHeader: { minHeight: 40, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, backgroundColor: colors.primarySoft },
  permissionColumnLabel: { width: 55, textAlign: 'center', fontFamily: fonts.bold, fontSize: 8.5, letterSpacing: 0.5, color: colors.textFaint },
  permissionGroup: { paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.xs, fontFamily: fonts.bold, fontSize: 10, letterSpacing: 0.7, textTransform: 'uppercase', color: colors.amber },
  permissionRow: { minHeight: 52, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.borderSoft },
  permissionArea: { flex: 1, paddingRight: spacing.sm, fontFamily: fonts.bold, fontSize: 12, color: colors.textPrimary },
  permissionCell: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', marginHorizontal: 10.5, borderWidth: 1.5, borderColor: colors.border, borderRadius: 10, backgroundColor: colors.surface },
  permissionCellOn: { borderColor: colors.success, backgroundColor: colors.success },
  permissionChanged: { position: 'absolute', top: -4, right: -4, width: 10, height: 10, borderWidth: 2, borderColor: colors.surface, borderRadius: 5, backgroundColor: colors.purple },
  permissionFootnote: { marginTop: spacing.md, fontFamily: fonts.regular, fontSize: 11, lineHeight: 16, color: colors.textMuted },
  permissionActions: { flexDirection: 'row', gap: spacing.md, paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.lg, borderTopWidth: 1, borderTopColor: colors.borderSoft, backgroundColor: colors.surface },
  resetButton: { flex: 1, minHeight: 50, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface },
  resetButtonText: { fontFamily: fonts.bold, fontSize: 13, color: colors.textPrimary },
  permissionSave: { flex: 1.2, marginTop: 0 },
  scheduleEditorContent: { padding: spacing.lg, paddingBottom: spacing.xl },
  scheduleNotice: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, padding: spacing.md, marginBottom: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.primaryLight },
  scheduleNoticeText: { flex: 1, fontFamily: fonts.regular, fontSize: 11.5, lineHeight: 17, color: colors.textSecondary },
  scheduleEditorHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.sm, paddingBottom: spacing.sm },
  scheduleInputLabel: { width: 74, textAlign: 'center', fontFamily: fonts.bold, fontSize: 8.5, letterSpacing: 0.5, color: colors.textFaint },
  scheduleBreakLabel: { width: 54, textAlign: 'center', fontFamily: fonts.bold, fontSize: 8.5, letterSpacing: 0.5, color: colors.textFaint },
  scheduleEditorRow: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: spacing.sm, marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface },
  scheduleEditorRowDisabled: { opacity: 0.55, backgroundColor: colors.background },
  dayToggle: { width: 26, height: 26, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: colors.border, borderRadius: 8, backgroundColor: colors.surface },
  dayToggleOn: { borderColor: colors.primary, backgroundColor: colors.primary },
  scheduleEditorDay: { width: 29, fontFamily: fonts.bold, fontSize: 11, color: colors.textPrimary },
  scheduleTimeInput: { width: 67, minHeight: 40, paddingHorizontal: 7, borderWidth: 1, borderColor: colors.border, borderRadius: 10, backgroundColor: colors.surface, textAlign: 'center', fontFamily: fonts.bold, fontSize: 12, color: colors.textPrimary },
  scheduleBreakInput: { width: 48, minHeight: 40, paddingHorizontal: 5, borderWidth: 1, borderColor: colors.border, borderRadius: 10, backgroundColor: colors.surface, textAlign: 'center', fontFamily: fonts.bold, fontSize: 12, color: colors.textPrimary },
  scheduleActions: { flexDirection: 'row', gap: spacing.md, paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.lg, borderTopWidth: 1, borderTopColor: colors.borderSoft, backgroundColor: colors.surface },
  lifecycleCard: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, padding: spacing.md, marginTop: spacing.lg, borderWidth: 1, borderColor: colors.danger, borderRadius: radius.lg, backgroundColor: colors.dangerLight },
  lifecycleCardInactive: { borderColor: colors.success, backgroundColor: colors.successLight },
  lifecycleIcon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: colors.surface },
  lifecycleIconInactive: { backgroundColor: colors.surface },
  lifecycleTitle: { fontFamily: fonts.bold, fontSize: 14, color: colors.textPrimary },
  lifecycleText: { fontFamily: fonts.regular, fontSize: 11.5, lineHeight: 17, color: colors.textSecondary, marginTop: 3 },
  lifecycleButton: { minHeight: 38, alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-start', paddingHorizontal: spacing.md, marginTop: spacing.md, borderWidth: 1, borderColor: colors.coral, borderRadius: radius.md, backgroundColor: colors.surface },
  lifecycleButtonRestore: { borderColor: colors.success },
  lifecycleButtonText: { fontFamily: fonts.bold, fontSize: 12, color: colors.coral },
  lifecycleButtonTextRestore: { color: colors.success },
  sheetOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(16,38,72,0.38)' },
  sheetDismiss: { flex: 1 },
  sheet: { paddingHorizontal: spacing.xl, paddingTop: spacing.sm, paddingBottom: 38, borderTopLeftRadius: 28, borderTopRightRadius: 28, backgroundColor: colors.surface },
  grabber: { alignSelf: 'center', width: 42, height: 5, borderRadius: 3, backgroundColor: colors.border, marginBottom: spacing.lg },
  sheetHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, marginBottom: spacing.lg },
  sheetTitle: { fontFamily: fonts.bold, fontSize: 22, color: colors.textPrimary },
  sheetSubtitle: { fontFamily: fonts.regular, fontSize: 12.5, color: colors.textSecondary, marginTop: 3 },
  closeButton: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: colors.background },
  fieldLabel: { fontFamily: fonts.bold, fontSize: 13, color: colors.textPrimary, marginBottom: 7, marginTop: spacing.sm },
  required: { color: colors.coral },
  input: { minHeight: 50, paddingHorizontal: spacing.md, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md, fontFamily: fonts.regular, fontSize: 16, color: colors.textPrimary },
  inputError: { borderColor: colors.coral, backgroundColor: colors.dangerLight },
  segmentRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  segment: { flex: 1, minHeight: 40, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md },
  segmentSelected: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  segmentText: { fontFamily: fonts.bold, fontSize: 11, color: colors.textSecondary },
  segmentTextSelected: { color: colors.primary },
  roomRow: { gap: spacing.sm, paddingVertical: 2 },
  roomChip: { minHeight: 38, justifyContent: 'center', paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.full },
  roomChipSelected: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  roomChipText: { fontFamily: fonts.bold, fontSize: 11.5, color: colors.textSecondary },
  roomChipTextSelected: { color: colors.primary },
  formError: { fontFamily: fonts.regular, fontSize: 12, color: colors.coral, marginTop: spacing.md },
  saveButton: { minHeight: 52, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, backgroundColor: colors.primary, marginTop: spacing.xl },
  disabledButton: { opacity: 0.55 },
  saveButtonText: { fontFamily: fonts.bold, fontSize: 15, color: colors.white },
});
