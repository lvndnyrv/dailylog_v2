import React, { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, Alert, TextInput, Modal, Linking
} from 'react-native';
import { useDailyLog, copyYesterdayLog } from '../../hooks/useDailyLog';
import { notifyParents } from '../../hooks/usePushNotifications';
import { supabase } from '../../lib/supabase';
import { Section, Chip, Button, LoadingScreen, Badge } from '../../components/ui';
import { PhotoSection } from '../../components/PhotoSection';
import { colors, spacing, radius } from '../../theme';
import { format } from 'date-fns';

const MOODS = [
  { label: 'Happy', emoji: '😊' },
  { label: 'Fussy', emoji: '😤' },
  { label: 'Curious', emoji: '🧐' },
  { label: 'Irritable', emoji: '😠' },
  { label: 'Sleepy', emoji: '😴' },
  { label: 'Sick', emoji: '🤒' },
];
const ACTIVITIES = [
  'Outdoors', 'Arts & crafts', 'Reading / language',
  'Singing / music', 'Motor skills', 'Toys',
  'Sensory play', 'Math', 'Science', 'Board games', 'Cooking class',
];
const SUPPLIES = [
  { label: 'Diapers', emoji: '🩲' },
  { label: 'Wipes', emoji: '🧻' },
  { label: 'Ointment', emoji: '🧴' },
  { label: 'Clothes', emoji: '👕' },
  { label: 'Blanket', emoji: '🧸' },
];
const AMOUNTS = ['all', 'some', 'none'];
const AMOUNT_COLORS = {
  all: { text: colors.success, bg: colors.successLight },
  some: { text: colors.amber, bg: colors.amberLight },
  none: { text: colors.danger, bg: colors.dangerLight },
};

function timeNow() {
  return format(new Date(), 'HH:mm');
}

// ---- TIME PICKER ----
// Native-feeling time picker using hour/minute scroll wheels
function TimePicker({ value, onChange, onClose }) {
  const [hour, setHour] = useState(() => {
    const parts = value?.split(':');
    return parts?.[0] ? parseInt(parts[0], 10) : new Date().getHours();
  });
  const [minute, setMinute] = useState(() => {
    const parts = value?.split(':');
    return parts?.[1] ? parseInt(parts[1], 10) : new Date().getMinutes();
  });

  const hours = Array.from({ length: 24 }, (_, i) => i);
  const minutes = Array.from({ length: 60 }, (_, i) => i);

  function confirm() {
    const h = String(hour).padStart(2, '0');
    const m = String(minute).padStart(2, '0');
    onChange(`${h}:${m}`);
    onClose();
  }

  return (
    <Modal transparent animationType="slide">
      <View style={tp.overlay}>
        <View style={tp.sheet}>
          <View style={tp.header}>
            <TouchableOpacity onPress={onClose}>
              <Text style={tp.cancel}>Cancel</Text>
            </TouchableOpacity>
            <Text style={tp.title}>Select time</Text>
            <TouchableOpacity onPress={confirm}>
              <Text style={tp.done}>Done</Text>
            </TouchableOpacity>
          </View>

          <View style={tp.pickerRow}>
            {/* Hours */}
            <View style={tp.col}>
              <Text style={tp.colLabel}>Hour</Text>
              <ScrollView style={tp.scroll} showsVerticalScrollIndicator={false}>
                {hours.map(h => (
                  <TouchableOpacity key={h} onPress={() => setHour(h)} style={[tp.item, h === hour && tp.itemSelected]}>
                    <Text style={[tp.itemText, h === hour && tp.itemTextSelected]}>
                      {String(h).padStart(2, '0')}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>

            <Text style={tp.colon}>:</Text>

            {/* Minutes — only 0, 5, 10, 15... for speed */}
            <View style={tp.col}>
              <Text style={tp.colLabel}>Minute</Text>
              <ScrollView style={tp.scroll} showsVerticalScrollIndicator={false}>
                {minutes.filter(m => m % 5 === 0).map(m => (
                  <TouchableOpacity key={m} onPress={() => setMinute(m)} style={[tp.item, m === minute && tp.itemSelected]}>
                    <Text style={[tp.itemText, m === minute && tp.itemTextSelected]}>
                      {String(m).padStart(2, '0')}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          </View>

          {/* Quick time buttons */}
          <View style={tp.quickRow}>
            {['07:00','08:00','09:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00'].map(t => (
              <TouchableOpacity key={t} onPress={() => {
                const [h, m] = t.split(':').map(Number);
                setHour(h); setMinute(m);
              }} style={tp.quick}>
                <Text style={tp.quickText}>{t}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ---- TIME BUTTON ----
// Shows the current time value, opens picker on tap
function TimeButton({ value, onChange }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <TouchableOpacity onPress={() => setOpen(true)} style={styles.timeBtn} activeOpacity={0.7}>
        <Text style={styles.timeBtnText}>{value || '--:--'}</Text>
        <Text style={styles.timeBtnIcon}>🕐</Text>
      </TouchableOpacity>
      {open && (
        <TimePicker
          value={value}
          onChange={onChange}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

// ---- MEAL ROW ----
// Uses local state so typing is smooth — only saves to DB on blur
function MealRow({ meal, onUpdate, onDelete }) {
  const [foodType, setFoodType] = useState(meal.food_type || '');

  function handleBlur() {
    if (foodType !== meal.food_type) {
      onUpdate(meal.id, { food_type: foodType });
    }
  }

  return (
    <View style={styles.mealCard}>
      <View style={styles.mealCardTop}>
        <TimeButton
          value={meal.time}
          onChange={t => onUpdate(meal.id, { time: t })}
        />
        <TextInput
          value={foodType}
          onChangeText={setFoodType}
          onBlur={handleBlur}
          placeholder="What did they eat?"
          placeholderTextColor={colors.textMuted}
          style={styles.foodInput}
          returnKeyType="done"
          blurOnSubmit
          autoCorrect={false}
        />
        <TouchableOpacity onPress={() => onDelete(meal.id)} style={styles.deleteBtn}>
          <Text style={styles.deleteX}>✕</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.amountRow}>
        <Text style={styles.amountLabel}>Amount eaten:</Text>
        {AMOUNTS.map(a => (
          <TouchableOpacity
            key={a}
            onPress={() => onUpdate(meal.id, { amount: a })}
            style={[styles.amountBtn, meal.amount === a && { backgroundColor: AMOUNT_COLORS[a].bg, borderColor: AMOUNT_COLORS[a].text }]}
          >
            <Text style={[styles.amountText, meal.amount === a && { color: AMOUNT_COLORS[a].text, fontWeight: '600' }]}>
              {a.charAt(0).toUpperCase() + a.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

// ---- DIAPER ROW ----
function DiaperRow({ d, onUpdate, onDelete }) {
  return (
    <View style={styles.diaperCard}>
      <View style={styles.diaperTop}>
        <TimeButton value={d.time} onChange={t => onUpdate(d.id, { time: t })} />
        <View style={styles.typeRow}>
          {['diaper', 'toilet'].map(type => (
            <TouchableOpacity
              key={type}
              onPress={() => onUpdate(d.id, { type })}
              style={[styles.typeBtn, d.type === type && styles.typeBtnSelected]}
            >
              <Text style={[styles.typeText, d.type === type && { color: colors.primary, fontWeight: '600' }]}>
                {type.charAt(0).toUpperCase() + type.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <TouchableOpacity onPress={() => onDelete(d.id)} style={styles.deleteBtn}>
          <Text style={styles.deleteX}>✕</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.diaperFlags}>
        <Chip label="💧 Wet" selected={d.wet} onPress={() => onUpdate(d.id, { wet: !d.wet })} />
        <Chip label="💩 BM" selected={d.bm} onPress={() => onUpdate(d.id, { bm: !d.bm })} />
      </View>
    </View>
  );
}

// ---- SLEEP ROW ----
function SleepRow({ s, onUpdate, onDelete }) {
  return (
    <View style={styles.sleepCard}>
      <View style={styles.sleepRow}>
        <Text style={styles.sleepLabel}>Start</Text>
        <TimeButton value={s.start_time} onChange={t => onUpdate(s.id, { start_time: t })} />
        <Text style={styles.sleepLabel}>End</Text>
        <TimeButton value={s.end_time || ''} onChange={t => onUpdate(s.id, { end_time: t })} />
        <TouchableOpacity onPress={() => onDelete(s.id)} style={styles.deleteBtn}>
          <Text style={styles.deleteX}>✕</Text>
        </TouchableOpacity>
      </View>
      {s.start_time && s.end_time && (
        <Text style={styles.sleepDuration}>
          Duration: {calcDuration(s.start_time, s.end_time)}
        </Text>
      )}
    </View>
  );
}

function calcDuration(start, end) {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  const mins = (eh * 60 + em) - (sh * 60 + sm);
  if (mins <= 0) return '';
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

// ---- MAIN SCREEN ----
export default function DailyLogScreen({ route, navigation }) {
  const { child } = route.params;
  const {
    log, meals, diapers, sleeps, activities, supplies, loading,
    updateMoods, updateNotes,
    addMeal, updateMeal, deleteMeal,
    addDiaper, updateDiaper, deleteDiaper,
    addSleep, updateSleep, deleteSleep,
    toggleActivity, toggleSupply,
    sendToParents,
  } = useDailyLog(child.id);

  const [notes, setNotes] = useState('');
  const [comments, setComments] = useState('');
  const [sending, setSending] = useState(false);
  const [copying, setCopying] = useState(false);

  React.useEffect(() => {
    if (log) {
      setNotes(log.notes || '');
      setComments(log.comments || '');
    }
  }, [log?.id]);

  if (loading) return <LoadingScreen />;

  const selectedMoods = log?.moods || [];
  const selectedActivities = activities.map(a => a.activity_name);
  const selectedSupplies = supplies.map(s => s.item_name);

  async function handleCallParents() {
    // Fetch all parents linked to this child with phone numbers
    const { data: links } = await supabase
      .from('parent_children')
      .select('parent:profiles(id, full_name, phone)')
      .eq('child_id', child.id);

    const parents = (links || [])
      .map(l => l.parent)
      .filter(p => p?.phone);

    if (!parents.length) {
      Alert.alert('No phone numbers', 'No parents linked to this child have a phone number on file. Ask them to update their profile.');
      return;
    }

    if (parents.length === 1) {
      Linking.openURL(`tel:${parents[0].phone}`);
      return;
    }

    // Multiple parents — show picker
    Alert.alert(
      `Call a parent — ${child.first_name}`,
      'Select who to call:',
      [
        ...parents.map(p => ({
          text: `${p.full_name}  ${p.phone}`,
          onPress: () => Linking.openURL(`tel:${p.phone}`),
        })),
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  }

  async function handleCopyYesterday() {
    if (!log) return;
    Alert.alert(
      'Copy yesterday\'s log?',
      'This will copy yesterday\'s meals and activities into today\'s log. Existing entries won\'t be replaced.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Copy',
          onPress: async () => {
            setCopying(true);
            const result = await copyYesterdayLog(child.id, log.id);
            setCopying(false);
            if (!result.copied) {
              Alert.alert('Nothing to copy', result.reason);
            } else {
              Alert.alert(
                'Copied ✓',
                `Copied ${result.mealCount} meals and ${result.activityCount} activities from yesterday.`
              );
            }
          },
        },
      ]
    );
  }

  async function handleSend() {
    setSending(true);
    await updateNotes(notes, comments);
    await sendToParents();
    await notifyParents(child.id, child.first_name, format(new Date(), 'yyyy-MM-dd'));
    setSending(false);
    Alert.alert('Sent! ✓', `${child.first_name}'s daily log has been sent to parents.`, [
      { text: 'OK', onPress: () => navigation.goBack() }
    ]);
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.back}>← Roster</Text>
        </TouchableOpacity>
        <View style={styles.childPill}>
          <Text style={styles.childName}>{child.first_name} {child.last_name}</Text>
          <Text style={styles.headerDate}>{format(new Date(), 'MMM d')}</Text>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity onPress={handleCallParents} style={styles.headerBtn}>
            <Text style={styles.headerBtnText}>📞</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => navigation.navigate('Messaging', { childId: child.id, childName: child.first_name })}
            style={styles.headerBtn}
          >
            <Text style={styles.headerBtnText}>💬</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Copy yesterday shortcut */}
      {!log?.sent_to_parents && (
        <TouchableOpacity
          style={styles.copyBtn}
          onPress={handleCopyYesterday}
          disabled={copying}
          activeOpacity={0.7}
        >
          <Text style={styles.copyBtnText}>
            {copying ? '⏳ Copying...' : '📋 Copy yesterday\'s meals & activities'}
          </Text>
        </TouchableOpacity>
      )}

      {/* MOOD */}
      <Section title="😊  Today I felt">
        <View style={styles.chipWrap}>
          {MOODS.map(m => (
            <Chip
              key={m.label}
              label={`${m.emoji} ${m.label}`}
              selected={selectedMoods.includes(m.label)}
              onPress={() => {
                const next = selectedMoods.includes(m.label)
                  ? selectedMoods.filter(x => x !== m.label)
                  : [...selectedMoods, m.label];
                updateMoods(next);
              }}
            />
          ))}
        </View>
      </Section>

      {/* MEALS */}
      <Section title="🍽  Meals">
        {meals.map(meal => (
          <MealRow key={meal.id} meal={meal} onUpdate={updateMeal} onDelete={deleteMeal} />
        ))}
        <TouchableOpacity style={styles.addBtn} onPress={() => addMeal(timeNow(), '', 'some')}>
          <Text style={styles.addBtnText}>+ Add meal</Text>
        </TouchableOpacity>
      </Section>

      {/* DIAPERS */}
      <Section title="🩲  Diaper / toilet">
        {diapers.map(d => (
          <DiaperRow key={d.id} d={d} onUpdate={updateDiaper} onDelete={deleteDiaper} />
        ))}
        <TouchableOpacity style={styles.addBtn} onPress={() => addDiaper(timeNow())}>
          <Text style={styles.addBtnText}>+ Add diaper / toilet entry</Text>
        </TouchableOpacity>
      </Section>

      {/* SLEEP */}
      <Section title="😴  Sleep">
        {sleeps.map(s => (
          <SleepRow key={s.id} s={s} onUpdate={updateSleep} onDelete={deleteSleep} />
        ))}
        <TouchableOpacity style={styles.addBtn} onPress={() => addSleep(timeNow())}>
          <Text style={styles.addBtnText}>+ Add nap</Text>
        </TouchableOpacity>
      </Section>

      {/* ACTIVITIES */}
      <Section title="🎨  Activities">
        <View style={styles.chipWrap}>
          {ACTIVITIES.map(a => (
            <Chip key={a} label={a} selected={selectedActivities.includes(a)}
              onPress={() => toggleActivity(a)} color={colors.purple} lightColor={colors.purpleLight} />
          ))}
        </View>
      </Section>

      {/* SUPPLIES */}
      <Section title="📦  Please bring more">
        <View style={styles.chipWrap}>
          {SUPPLIES.map(s => (
            <Chip key={s.label} label={`${s.emoji} ${s.label}`} selected={selectedSupplies.includes(s.label)}
              onPress={() => toggleSupply(s.label)} color={colors.coral} lightColor={colors.coralLight} />
          ))}
        </View>
      </Section>

      {/* NOTES */}
      <Section title="📝  Notes & comments">
        <TextInput
          value={notes}
          onChangeText={setNotes}
          onBlur={() => updateNotes(notes, comments)}
          placeholder="Notes about today..."
          placeholderTextColor={colors.textMuted}
          multiline numberOfLines={3}
          style={styles.notesInput}
        />
        <TextInput
          value={comments}
          onChangeText={setComments}
          onBlur={() => updateNotes(notes, comments)}
          placeholder="Comments for parents..."
          placeholderTextColor={colors.textMuted}
          multiline numberOfLines={3}
          style={[styles.notesInput, { marginTop: spacing.sm, marginBottom: 0 }]}
        />
      </Section>

      {log && <PhotoSection logId={log.id} childId={child.id} readOnly={false} />}

      <Button
        label={log?.sent_to_parents ? '✓ Already sent to parents' : '📤  Send to parents'}
        onPress={handleSend}
        loading={sending}
        style={styles.sendBtn}
      />
      <View style={{ height: spacing.xxxl }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.lg },
  back: { fontSize: 15, color: colors.primary, fontWeight: '500' },
  childPill: {
    backgroundColor: colors.primaryLight, borderRadius: radius.full,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, alignItems: 'center',
  },
  childName: { fontSize: 15, fontWeight: '600', color: colors.primary },
  headerDate: { fontSize: 12, color: colors.primaryDark },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap' },

  // Time button
  timeBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: colors.bg, borderWidth: 1.5, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    minWidth: 80,
  },
  timeBtnText: { fontSize: 15, fontWeight: '600', color: colors.textPrimary },
  timeBtnIcon: { fontSize: 13 },

  // Meal card
  mealCard: {
    backgroundColor: colors.bg, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.sm,
  },
  mealCardTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  foodInput: {
    flex: 1, fontSize: 15, color: colors.textPrimary,
    backgroundColor: colors.surface, borderWidth: 1.5,
    borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    minHeight: 42,
  },
  amountRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  amountLabel: { fontSize: 12, color: colors.textSecondary, marginRight: 4 },
  amountBtn: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 2,
    borderRadius: radius.full, borderWidth: 1.5, borderColor: colors.border,
  },
  amountText: { fontSize: 13, color: colors.textSecondary },

  // Diaper card
  diaperCard: {
    backgroundColor: colors.bg, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.sm,
  },
  diaperTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  diaperFlags: { flexDirection: 'row', gap: spacing.sm },
  typeRow: { flex: 1, flexDirection: 'row', gap: spacing.sm },
  typeBtn: {
    flex: 1, paddingVertical: spacing.sm, borderRadius: radius.md,
    borderWidth: 1.5, borderColor: colors.border, alignItems: 'center',
  },
  typeBtnSelected: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  typeText: { fontSize: 13, color: colors.textSecondary },

  // Sleep card
  sleepCard: {
    backgroundColor: colors.bg, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.sm,
  },
  sleepRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  sleepLabel: { fontSize: 13, color: colors.textSecondary, fontWeight: '500' },
  sleepDuration: { fontSize: 12, color: colors.success, marginTop: spacing.sm, fontWeight: '500' },

  deleteBtn: { padding: spacing.xs },
  deleteX: { fontSize: 16, color: colors.textMuted, fontWeight: '600' },
  addBtn: {
    borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.border,
    borderRadius: radius.md, padding: spacing.md, alignItems: 'center', marginTop: spacing.xs,
  },
  addBtnText: { fontSize: 14, color: colors.textSecondary, fontWeight: '500' },
  notesInput: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    padding: spacing.md, fontSize: 14, color: colors.textPrimary,
    backgroundColor: colors.surface, minHeight: 80, textAlignVertical: 'top',
    marginBottom: spacing.sm,
  },
  sendBtn: { marginTop: spacing.sm, marginBottom: spacing.md },
  copyBtn: {
    backgroundColor: colors.amberLight, borderRadius: radius.md,
    padding: spacing.md, alignItems: 'center', marginBottom: spacing.md,
    borderWidth: 1, borderColor: colors.amber + '44',
  },
  copyBtnText: { fontSize: 14, color: colors.amber, fontWeight: '500' },
  headerActions: { flexDirection: 'row', gap: spacing.sm },
  headerBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.primary + '44',
  },
  headerBtnText: { fontSize: 16 },
});

// Time picker styles
const tp = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: 40 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.border },
  title: { fontSize: 16, fontWeight: '600', color: colors.textPrimary },
  cancel: { fontSize: 16, color: colors.textSecondary },
  done: { fontSize: 16, color: colors.primary, fontWeight: '600' },
  pickerRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'center', padding: spacing.lg },
  col: { width: 100, alignItems: 'center' },
  colLabel: { fontSize: 12, color: colors.textMuted, marginBottom: spacing.sm, fontWeight: '500', textTransform: 'uppercase' },
  scroll: { height: 200 },
  item: { paddingVertical: spacing.sm, paddingHorizontal: spacing.lg, borderRadius: radius.md, width: '100%', alignItems: 'center' },
  itemSelected: { backgroundColor: colors.primaryLight },
  itemText: { fontSize: 22, color: colors.textSecondary, fontWeight: '400' },
  itemTextSelected: { color: colors.primary, fontWeight: '700' },
  colon: { fontSize: 28, fontWeight: '700', color: colors.textPrimary, marginTop: 48, marginHorizontal: spacing.md },
  quickRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  quick: { backgroundColor: colors.bg, borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderWidth: 1, borderColor: colors.border },
  quickText: { fontSize: 13, color: colors.textSecondary, fontWeight: '500' },
});
