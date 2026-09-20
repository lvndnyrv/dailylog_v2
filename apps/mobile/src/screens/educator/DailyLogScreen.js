import React, { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, Alert, TextInput, Modal, Linking
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../hooks/useAuth';
import { useDailyLog, copyYesterdayLog } from '../../hooks/useDailyLog';
import { supabase } from '../../lib/supabase';
import { exportDailyLogPdf } from '../../lib/export';
import { Chip, Button, LoadingScreen } from '../../components/ui';
import { PhotoSection } from '../../components/PhotoSection';
import { colors, spacing, radius, fonts } from '../../theme';
import { format, isToday as checkIsToday } from 'date-fns';

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
  // Strip seconds if present (DB returns HH:mm:ss, we only need HH:mm)
  const display = value ? value.substring(0, 5) : '--:--';
  return (
    <>
      <TouchableOpacity onPress={() => setOpen(true)} style={styles.timeBtn} activeOpacity={0.7}>
        <Text style={styles.timeBtnText}>{display}</Text>
        <Ionicons name="time-outline" size={16} color={colors.textMuted} />
      </TouchableOpacity>
      {open && (
        <TimePicker
          value={value ? value.substring(0, 5) : value}
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
        <TouchableOpacity
          onPress={() => onDelete(meal.id)}
          style={styles.deleteBtn}
          accessibilityRole="button"
          accessibilityLabel="Remove meal"
        >
          <Ionicons name="close" size={19} color={colors.textMuted} />
        </TouchableOpacity>
      </View>
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
      <View style={styles.amountRow}>
        <Text style={styles.amountLabel}>Amount eaten</Text>
        <View style={styles.amountOptions}>
          {AMOUNTS.map(a => (
            <TouchableOpacity
              key={a}
              onPress={() => onUpdate(meal.id, { amount: a })}
              style={[styles.amountBtn, meal.amount === a && { backgroundColor: AMOUNT_COLORS[a].bg, borderColor: AMOUNT_COLORS[a].text }]}
            >
              <Text style={[styles.amountText, meal.amount === a && { color: AMOUNT_COLORS[a].text, fontFamily: fonts.bold }]}>
                {a.charAt(0).toUpperCase() + a.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
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
        <TouchableOpacity
          onPress={() => onDelete(d.id)}
          style={styles.deleteBtn}
          accessibilityRole="button"
          accessibilityLabel="Remove care entry"
        >
          <Ionicons name="close" size={19} color={colors.textMuted} />
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
      <View style={styles.sleepCardHeader}>
        <Text style={styles.sleepCardTitle}>Nap</Text>
        <TouchableOpacity
          onPress={() => onDelete(s.id)}
          style={styles.sleepDeleteBtn}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Text style={styles.sleepDeleteText}>Remove</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.sleepRow}>
        <Text style={styles.sleepLabel}>Start</Text>
        <TimeButton value={s.start_time} onChange={t => onUpdate(s.id, { start_time: t })} />
        <Text style={styles.sleepLabel}>End</Text>
        <TimeButton value={s.end_time || ''} onChange={t => onUpdate(s.id, { end_time: t })} />
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

// ---- CUSTOM ITEM INPUT ----
// Inline input for adding custom activities or supply items
function CustomItemInput({ placeholder, onAdd, color }) {
  const [text, setText] = useState('');

  function handleAdd() {
    const trimmed = text.trim();
    if (!trimmed) return;
    onAdd(trimmed);
    setText('');
  }

  return (
    <View style={styles.customInputRow}>
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        style={styles.customInput}
        returnKeyType="done"
        onSubmitEditing={handleAdd}
        maxLength={40}
      />
      <TouchableOpacity
        onPress={handleAdd}
        disabled={!text.trim()}
        style={[styles.customAddBtn, { backgroundColor: text.trim() ? color : colors.border }]}
      >
        <Text style={styles.customAddBtnText}>+</Text>
      </TouchableOpacity>
    </View>
  );
}

function LogSection({ icon, title, children, iconColor = colors.primary, iconBackground = colors.primarySoft }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <View style={[styles.sectionIcon, { backgroundColor: iconBackground }]}>
          <Ionicons name={icon} size={19} color={iconColor} />
        </View>
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      {children}
    </View>
  );
}

// ---- MAIN SCREEN ----
export default function DailyLogScreen({ route, navigation }) {
  const { child, date } = route.params;
  const { profile } = useAuth();
  // Date comes from the roster's date navigation (defaults to today)
  const logDate = date ? new Date(`${date}T00:00:00`) : new Date();
  const isToday = checkIsToday(logDate);
  const {
    log, meals, diapers, sleeps, activities, supplies, loading, error,
    updateMoods, updateNotes,
    addMeal, updateMeal, deleteMeal,
    addDiaper, updateDiaper, deleteDiaper,
    addSleep, updateSleep, deleteSleep,
    toggleActivity, toggleSupply,
    sendToParents,
  } = useDailyLog(child.id, logDate, {
    createIfMissing: true,
    educatorId: profile?.id,
    daycareId: profile?.daycare_id,
  });

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

  if (!log) {
    return (
      <View style={styles.errorWrap}>
        <Text style={styles.errorIcon}>⚠️</Text>
        <Text style={styles.errorText}>
          Couldn't open this log{error ? `:\n${error}` : '.'}
        </Text>
        <Button label="← Back to roster" onPress={() => navigation.goBack()} variant="ghost" />
      </View>
    );
  }

  const selectedMoods = log?.moods || [];
  const selectedActivities = activities.map(a => a.activity_name);
  const selectedSupplies = supplies.map(s => s.item_name);
  const readOnly = Boolean(log?.sent_to_parents);
  const reportReady = Boolean(
    notes.trim()
    || comments.trim()
    || (meals.length + diapers.length + sleeps.length + activities.length) >= 2
  );

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
      'Copy previous day\'s log?',
      'This will copy the previous day\'s meals and activities into this log. Existing entries won\'t be replaced.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Copy',
          onPress: async () => {
            setCopying(true);
            const result = await copyYesterdayLog(child.id, log.id, logDate);
            setCopying(false);
            if (!result.copied) {
              Alert.alert('Nothing to copy', result.reason);
            } else {
              Alert.alert(
                'Copied ✓',
                `Copied ${result.mealCount} meals and ${result.activityCount} activities from the previous day.`
              );
            }
          },
        },
      ]
    );
  }

  async function handleSend() {
    if (readOnly) return;
    if (!reportReady) {
      Alert.alert('Add a little more first', 'Add a note or at least two daily updates before sending the final report.');
      return;
    }
    setSending(true);
    await updateNotes(notes, comments);
    const { error: sendError, offline } = await sendToParents();
    if (offline) {
      setSending(false);
      Alert.alert(
        "You're offline",
        'Sending to parents needs a connection so they get notified. Your entries are saved — try again once you\'re back online.'
      );
      return;
    }
    if (sendError) {
      setSending(false);
      Alert.alert('Could not send', sendError.message);
      return;
    }
    setSending(false);
    Alert.alert('Sent! ✓', `${child.first_name}'s daily log has been sent to parents.`, [
      { text: 'OK', onPress: () => navigation.goBack() }
    ]);
  }

  async function handleExportPdf() {
    try {
      await exportDailyLogPdf({
        child, log, meals, diapers, sleeps, activities, supplies,
        dateStr: format(logDate, 'EEEE, MMMM d, yyyy'),
      });
    } catch (err) {
      Alert.alert('Export failed', err.message);
    }
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.topBar}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backButton}
          accessibilityRole="button"
          accessibilityLabel="Back to roster"
        >
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.screenTitle}>Daily report</Text>
        <View style={styles.headerActions}>
          <TouchableOpacity onPress={handleExportPdf} style={styles.headerBtn} accessibilityLabel="Export as PDF">
            <Ionicons name="document-outline" size={19} color={colors.primary} />
          </TouchableOpacity>
          <TouchableOpacity onPress={handleCallParents} style={styles.headerBtn} accessibilityLabel="Call family">
            <Ionicons name="call-outline" size={19} color={colors.primary} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => navigation.navigate('Messaging', { childId: child.id, childName: child.first_name })}
            style={styles.headerBtn}
            accessibilityLabel="Message family"
          >
            <Ionicons name="chatbubble-outline" size={19} color={colors.primary} />
          </TouchableOpacity>
        </View>
      </View>

      {readOnly ? (
        <View style={styles.finalBanner}>
          <View style={styles.finalBannerIcon}>
            <Ionicons name="checkmark" size={18} color={colors.success} />
          </View>
          <View style={styles.finalBannerCopy}>
            <Text style={styles.finalBannerTitle}>Final report sent to family</Text>
            <Text style={styles.finalBannerBody}>
              Sent {log.sent_at ? format(new Date(log.sent_at), 'MMM d · h:mm a') : 'today'}. This report is now read-only.
            </Text>
          </View>
        </View>
      ) : null}

      <View style={styles.childSummary}>
        <View style={styles.childAvatar}>
          <Text style={styles.childAvatarText}>
            {child.first_name?.[0]}{child.last_name?.[0]}
          </Text>
        </View>
        <View style={styles.childSummaryText}>
          <Text style={styles.childName}>{child.first_name} {child.last_name}</Text>
          <Text style={styles.headerDate}>
            {isToday ? `Today · ${format(logDate, 'MMMM d')}` : format(logDate, 'EEEE, MMMM d')}
          </Text>
        </View>
        <View style={[styles.reportStatus, log?.sent_to_parents && styles.reportStatusSent]}>
          <Text style={[styles.reportStatusText, log?.sent_to_parents && styles.reportStatusTextSent]}>
            {log?.sent_to_parents ? 'Sent' : 'Draft'}
          </Text>
        </View>
      </View>

      {/* Allergy warning banner */}
      {child.allergies?.length > 0 && (
        <View style={styles.allergyBanner}>
          <View style={styles.allergyIcon}>
            <Ionicons name="warning-outline" size={19} color={colors.danger} />
          </View>
          <View style={styles.allergyContent}>
            <Text style={styles.allergyLabel}>ALLERGY ALERT</Text>
            <Text style={styles.allergyBannerText}>{child.allergies.join(', ')}</Text>
          </View>
        </View>
      )}

      <View style={styles.quickActions}>
        {!log?.sent_to_parents && (
        <TouchableOpacity
          style={styles.copyBtn}
          onPress={handleCopyYesterday}
          disabled={copying}
          activeOpacity={0.7}
        >
          <View style={styles.quickActionIcon}>
            <Ionicons name={copying ? 'hourglass-outline' : 'copy-outline'} size={19} color={colors.amber} />
          </View>
          <Text style={styles.copyBtnText}>{copying ? 'Copying…' : 'Copy previous day'}</Text>
        </TouchableOpacity>
        )}

        <TouchableOpacity
          style={styles.incidentBtn}
          onPress={() => navigation.navigate('IncidentReport', { child })}
          activeOpacity={0.7}
        >
          <View style={[styles.quickActionIcon, styles.incidentIcon]}>
            <Ionicons name="medkit-outline" size={19} color={colors.danger} />
          </View>
          <Text style={styles.incidentBtnText}>Report incident</Text>
        </TouchableOpacity>
      </View>

      <View pointerEvents={readOnly ? 'none' : 'auto'} style={readOnly ? styles.readOnlyBody : null}>
      {/* MOOD */}
      <LogSection icon="happy-outline" title="Today I felt" iconColor={colors.success} iconBackground={colors.successLight}>
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
      </LogSection>

      {/* MEALS */}
      <LogSection icon="restaurant-outline" title="Meals" iconColor={colors.amber} iconBackground={colors.amberLight}>
        {meals.map(meal => (
          <MealRow key={meal.id} meal={meal} onUpdate={updateMeal} onDelete={deleteMeal} />
        ))}
        <TouchableOpacity style={styles.addBtn} onPress={() => addMeal(timeNow(), '', 'some')}>
          <Text style={styles.addBtnText}>+ Add meal</Text>
        </TouchableOpacity>
      </LogSection>

      {/* DIAPERS */}
      <LogSection icon="water-outline" title="Diaper / toilet">
        {diapers.map(d => (
          <DiaperRow key={d.id} d={d} onUpdate={updateDiaper} onDelete={deleteDiaper} />
        ))}
        <TouchableOpacity style={styles.addBtn} onPress={() => addDiaper(timeNow())}>
          <Text style={styles.addBtnText}>+ Add diaper / toilet entry</Text>
        </TouchableOpacity>
      </LogSection>

      {/* SLEEP */}
      <LogSection icon="moon-outline" title="Sleep" iconColor={colors.purple} iconBackground={colors.purpleLight}>
        {sleeps.map(s => (
          <SleepRow key={s.id} s={s} onUpdate={updateSleep} onDelete={deleteSleep} />
        ))}
        <TouchableOpacity style={styles.addBtn} onPress={() => addSleep(timeNow())}>
          <Text style={styles.addBtnText}>+ Add nap</Text>
        </TouchableOpacity>
      </LogSection>

      {/* ACTIVITIES */}
      <LogSection icon="color-palette-outline" title="Activities" iconColor={colors.purple} iconBackground={colors.purpleLight}>
        <View style={styles.chipWrap}>
          {ACTIVITIES.map(a => (
            <Chip key={a} label={a} selected={selectedActivities.includes(a)}
              onPress={() => toggleActivity(a)} color={colors.purple} lightColor={colors.purpleLight} />
          ))}
          {/* Show custom activities not in default list */}
          {selectedActivities.filter(a => !ACTIVITIES.includes(a)).map(a => (
            <Chip key={a} label={a} selected onPress={() => toggleActivity(a)}
              color={colors.purple} lightColor={colors.purpleLight} />
          ))}
        </View>
        <CustomItemInput
          placeholder="Add custom activity..."
          onAdd={(name) => toggleActivity(name)}
          color={colors.purple}
        />
      </LogSection>

      {/* SUPPLIES */}
      <LogSection icon="cube-outline" title="Please bring more" iconColor={colors.coral} iconBackground={colors.coralLight}>
        <View style={styles.chipWrap}>
          {SUPPLIES.map(s => (
            <Chip key={s.label} label={`${s.emoji} ${s.label}`} selected={selectedSupplies.includes(s.label)}
              onPress={() => toggleSupply(s.label)} color={colors.coral} lightColor={colors.coralLight} />
          ))}
          {/* Show custom supplies not in default list */}
          {selectedSupplies.filter(s => !SUPPLIES.some(def => def.label === s)).map(s => (
            <Chip key={s} label={s} selected onPress={() => toggleSupply(s)}
              color={colors.coral} lightColor={colors.coralLight} />
          ))}
        </View>
        <CustomItemInput
          placeholder="Add custom item..."
          onAdd={(name) => toggleSupply(name)}
          color={colors.coral}
        />
      </LogSection>

      {/* NOTES */}
      <LogSection icon="document-text-outline" title="Notes & comments">
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
      </LogSection>

      {log && <PhotoSection logId={log.id} childId={child.id} readOnly={readOnly} />}
      </View>

      {!readOnly && !reportReady ? (
        <View style={styles.readyHint}>
          <Ionicons name="information-circle-outline" size={18} color={colors.amber} />
          <Text style={styles.readyHintText}>Add a note or at least two daily updates before sending.</Text>
        </View>
      ) : null}

      <Button
        label={readOnly ? 'Sent to family · Final' : 'Send daily report'}
        onPress={handleSend}
        loading={sending}
        disabled={readOnly || !reportReady}
        style={styles.sendBtn}
      />
      <View style={{ height: spacing.xxxl }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.xl, paddingTop: spacing.sm, paddingBottom: spacing.xxxl * 2 },
  topBar: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  backButton: {
    width: 38,
    height: 38,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  screenTitle: {
    flex: 1,
    marginLeft: spacing.md,
    fontSize: 20,
    fontFamily: fonts.black,
    color: colors.textPrimary,
  },
  childSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.lg,
    marginBottom: spacing.md,
    borderRadius: 18,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  childAvatar: {
    width: 46,
    height: 46,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primaryLight,
  },
  childAvatarText: { fontSize: 15, fontFamily: fonts.bold, color: colors.primary },
  childSummaryText: { flex: 1, minWidth: 0, marginLeft: spacing.md },
  childName: { fontSize: 17, fontFamily: fonts.bold, color: colors.textPrimary },
  headerDate: { marginTop: 2, fontSize: 13, fontFamily: fonts.regular, color: colors.textMuted },
  reportStatus: {
    borderRadius: radius.full,
    backgroundColor: colors.amberLight,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  reportStatusSent: { backgroundColor: colors.successLight },
  reportStatusText: { fontSize: 11.5, fontFamily: fonts.bold, color: colors.amber },
  reportStatusTextSent: { color: colors.success },
  finalBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: `${colors.success}55`,
    backgroundColor: colors.successLight,
  },
  finalBannerIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  finalBannerCopy: { flex: 1, minWidth: 0 },
  finalBannerTitle: { color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 13.5 },
  finalBannerBody: { color: colors.textMuted, fontFamily: fonts.regular, fontSize: 11.5, lineHeight: 16, marginTop: 2 },
  readOnlyBody: { opacity: 0.82 },
  readyHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.amberLight,
  },
  readyHintText: { flex: 1, color: colors.amber, fontFamily: fonts.bold, fontSize: 11.5, lineHeight: 16 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: -spacing.sm },
  section: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    padding: spacing.lg,
    marginBottom: spacing.md,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.lg },
  sectionIcon: {
    width: 36,
    height: 36,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  sectionTitle: { fontSize: 17, fontFamily: fonts.bold, color: colors.textPrimary },
  customInputRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    marginTop: spacing.sm,
  },
  customInput: {
    flex: 1, fontSize: 14, fontFamily: fonts.regular, color: colors.textPrimary,
    backgroundColor: colors.bg, borderWidth: 1.5,
    borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    minHeight: 38,
  },
  customAddBtn: {
    width: 38, height: 38, borderRadius: radius.md,
    alignItems: 'center', justifyContent: 'center',
  },
  customAddBtnText: { fontSize: 20, color: colors.white, fontFamily: fonts.bold, marginTop: -1 },

  // Error state
  errorWrap: {
    flex: 1, justifyContent: 'center', alignItems: 'center',
    backgroundColor: colors.bg, padding: spacing.xl,
  },
  errorIcon: { fontSize: 40, marginBottom: spacing.md },
  errorText: {
    fontSize: 14, color: colors.textSecondary, textAlign: 'center',
    lineHeight: 20, marginBottom: spacing.xl,
  },

  // Time button
  timeBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: colors.primarySoft, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 1,
  },
  timeBtnText: { fontSize: 14, fontFamily: fonts.bold, color: colors.textPrimary },

  // Meal card
  mealCard: {
    backgroundColor: colors.primarySoft, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.borderSoft,
    padding: spacing.md, marginBottom: spacing.sm,
  },
  mealCardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  foodInput: {
    width: '100%', fontSize: 14, fontFamily: fonts.regular, color: colors.textPrimary,
    backgroundColor: colors.surface, borderWidth: 1.5,
    borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    minHeight: 44,
  },
  amountRow: { marginTop: spacing.md },
  amountLabel: { fontSize: 11.5, fontFamily: fonts.bold, color: colors.textMuted, marginBottom: spacing.sm },
  amountOptions: { flexDirection: 'row', gap: spacing.sm },
  amountBtn: {
    flex: 1, paddingHorizontal: spacing.sm, paddingVertical: spacing.sm,
    borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border,
    backgroundColor: colors.surface, alignItems: 'center',
  },
  amountText: { fontSize: 12.5, fontFamily: fonts.regular, color: colors.textSecondary },

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
  sleepCardHeader: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: spacing.sm,
  },
  sleepCardTitle: { fontSize: 13, fontFamily: fonts.bold, color: colors.textSecondary },
  sleepDeleteBtn: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 2,
    borderRadius: radius.full, backgroundColor: colors.dangerLight,
    borderWidth: 1, borderColor: colors.danger + '33',
  },
  sleepDeleteText: { fontSize: 12, color: colors.danger, fontFamily: fonts.bold },
  sleepRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  sleepLabel: { fontSize: 13, color: colors.textSecondary, fontFamily: fonts.bold },
  sleepDuration: { fontSize: 12, color: colors.success, marginTop: spacing.sm, fontFamily: fonts.bold },

  deleteBtn: {
    width: 32, height: 32, borderRadius: radius.full,
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface,
  },
  addBtn: {
    borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.border,
    borderRadius: radius.md, padding: spacing.md, alignItems: 'center', marginTop: spacing.xs,
  },
  addBtnText: { fontSize: 14, color: colors.primary, fontFamily: fonts.bold },
  notesInput: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    padding: spacing.md, fontSize: 14, fontFamily: fonts.regular, color: colors.textPrimary,
    backgroundColor: colors.surface, minHeight: 80, textAlignVertical: 'top',
    marginBottom: spacing.sm,
  },
  sendBtn: { marginTop: spacing.sm, marginBottom: spacing.md },
  quickActions: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  copyBtn: {
    flex: 1, minHeight: 76, backgroundColor: colors.surface, borderRadius: radius.lg,
    padding: spacing.md, justifyContent: 'center',
    borderWidth: 1.5, borderColor: colors.border,
  },
  quickActionIcon: {
    width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.amberLight, marginBottom: spacing.sm,
  },
  copyBtnText: { fontSize: 13, color: colors.textPrimary, fontFamily: fonts.bold },
  incidentBtn: {
    flex: 1, minHeight: 76, backgroundColor: colors.surface, borderRadius: radius.lg,
    padding: spacing.md, justifyContent: 'center',
    borderWidth: 1.5, borderColor: colors.border,
  },
  incidentIcon: { backgroundColor: colors.dangerLight },
  incidentBtnText: { fontSize: 13, color: colors.textPrimary, fontFamily: fonts.bold },
  allergyBanner: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.dangerLight,
    borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.md,
    borderWidth: 1, borderColor: colors.danger + '44',
  },
  allergyIcon: {
    width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  allergyContent: { flex: 1, marginLeft: spacing.md },
  allergyLabel: { fontSize: 10, fontFamily: fonts.bold, letterSpacing: 1, color: colors.danger },
  allergyBannerText: { marginTop: 2, fontSize: 14, color: colors.textPrimary, fontFamily: fonts.bold },
  headerActions: { flexDirection: 'row', gap: spacing.sm },
  headerBtn: {
    width: 36, height: 36, borderRadius: radius.full,
    backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.border,
  },
});

// TimePicker styles
const tp = StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.surface, borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl, padding: spacing.xl,
    paddingBottom: spacing.xxxl + spacing.xl,
  },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: spacing.lg,
  },
  cancel: { fontSize: 15, color: colors.textMuted, fontWeight: '500' },
  title: { fontSize: 16, fontWeight: '600', color: colors.textPrimary },
  done: { fontSize: 15, color: colors.primary, fontWeight: '600' },
  pickerRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: spacing.md,
  },
  col: { flex: 1, alignItems: 'center' },
  colLabel: { fontSize: 12, color: colors.textMuted, fontWeight: '500', marginBottom: spacing.sm },
  scroll: { height: 180 },
  item: {
    paddingVertical: spacing.sm, paddingHorizontal: spacing.lg,
    borderRadius: radius.md, marginBottom: 2, alignItems: 'center',
  },
  itemSelected: { backgroundColor: colors.primaryLight },
  itemText: { fontSize: 16, color: colors.textSecondary },
  itemTextSelected: { color: colors.primary, fontWeight: '700' },
  colon: { fontSize: 24, fontWeight: '700', color: colors.textPrimary, marginTop: spacing.lg },
  quickRow: {
    flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm,
    marginTop: spacing.lg, justifyContent: 'center',
  },
  quick: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 2,
    borderRadius: radius.full, backgroundColor: colors.bg,
    borderWidth: 1, borderColor: colors.border,
  },
  quickText: { fontSize: 12, color: colors.textSecondary, fontWeight: '500' },
});
