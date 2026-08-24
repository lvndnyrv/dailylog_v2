import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import {
  addDays,
  addWeeks,
  format,
  isSameDay,
  startOfWeek,
  subDays,
} from 'date-fns';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { showToast } from '../../components/Toast';
import { useAuth } from '../../hooks/useAuth';
import { useClassroom } from '../../hooks/useClassroom';
import { supabase } from '../../lib/supabase';
import {
  effectiveMenuItems,
  formatMealTime,
  MEAL_SLOTS,
} from '../../lib/mealMenus';
import { colors, fonts, radius, spacing } from '../../theme';

function blankSlot(slot) {
  return {
    meal_type: slot.id,
    meal_label: slot.label,
    meal_time: slot.defaultTime,
    food_description: '',
    allergens: [],
  };
}

function draftForScope(rows, classroomId) {
  const effective = effectiveMenuItems(rows, classroomId);
  return MEAL_SLOTS.map(slot => {
    const item = effective.find(row => row.meal_type === slot.id);
    if (!item) return blankSlot(slot);
    return {
      ...item,
      inherited: classroomId != null && item.classroom_id == null,
      allergens: item.allergens || [],
    };
  });
}

function ScopePicker({ visible, classrooms, value, onChoose, onClose }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <TouchableOpacity style={styles.modalDismiss} activeOpacity={1} onPress={onClose} />
        <View style={styles.scopeSheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.scopeHeader}>
            <View>
              <Text style={styles.scopeTitle}>Menu applies to</Text>
              <Text style={styles.scopeSubtitle}>Choose every room or one classroom.</Text>
            </View>
            <TouchableOpacity
              onPress={onClose}
              style={styles.iconButton}
              accessibilityRole="button"
              accessibilityLabel="Close classroom picker"
            >
              <Ionicons name="close" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
          <TouchableOpacity
            onPress={() => onChoose(null)}
            style={[styles.scopeRow, value == null && styles.scopeRowSelected]}
            accessibilityRole="radio"
            accessibilityState={{ selected: value == null }}
          >
            <View style={styles.scopeIcon}>
              <Ionicons name="business-outline" size={19} color={colors.primary} />
            </View>
            <View style={styles.scopeCopy}>
              <Text style={styles.scopeRowTitle}>All rooms</Text>
              <Text style={styles.scopeRowSubtitle}>The center-wide default menu</Text>
            </View>
            {value == null && <Ionicons name="checkmark-circle" size={22} color={colors.primary} />}
          </TouchableOpacity>
          {classrooms.map(room => (
            <TouchableOpacity
              key={room.id}
              onPress={() => onChoose(room)}
              style={[styles.scopeRow, value?.id === room.id && styles.scopeRowSelected]}
              accessibilityRole="radio"
              accessibilityState={{ selected: value?.id === room.id }}
            >
              <View style={styles.scopeIcon}>
                <Ionicons name="people-outline" size={19} color={colors.primary} />
              </View>
              <View style={styles.scopeCopy}>
                <Text style={styles.scopeRowTitle}>{room.name}</Text>
                <Text style={styles.scopeRowSubtitle}>{room.age_group || 'Classroom menu'}</Text>
              </View>
              {value?.id === room.id && (
                <Ionicons name="checkmark-circle" size={22} color={colors.primary} />
              )}
            </TouchableOpacity>
          ))}
        </View>
      </View>
    </Modal>
  );
}

function MealEditor({ item, visible, onClose, onApply }) {
  const [food, setFood] = useState('');
  const [time, setTime] = useState('');
  const [allergens, setAllergens] = useState('');

  useEffect(() => {
    if (!visible || !item) return;
    setFood(item.food_description || '');
    setTime(String(item.meal_time || '').slice(0, 5));
    setAllergens((item.allergens || []).join(', '));
  }, [item, visible]);

  function apply() {
    if (food.trim() && !/^\d{2}:\d{2}$/.test(time.trim())) {
      Alert.alert('Check the time', 'Use a 24-hour time such as 09:30 or 15:00.');
      return;
    }
    onApply({
      ...item,
      meal_time: `${time.trim() || String(item.meal_time).slice(0, 5)}:00`,
      food_description: food.trim(),
      allergens: allergens
        .split(',')
        .map(value => value.trim().toLowerCase())
        .filter(Boolean),
      inherited: false,
    });
  }

  if (!item) return null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.modalOverlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <TouchableOpacity style={styles.modalDismiss} activeOpacity={1} onPress={onClose} />
        <View style={styles.editorSheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.editorHeader}>
            <View style={styles.editorHeading}>
              <View style={styles.mealIcon}>
                <Ionicons name="restaurant-outline" size={17} color={colors.primary} />
              </View>
              <View>
                <Text style={styles.editorTitle}>{item.meal_label}</Text>
                <Text style={styles.editorSubtitle}>Set the food, time and allergen flags.</Text>
              </View>
            </View>
            <TouchableOpacity
              onPress={onClose}
              style={styles.iconButton}
              accessibilityRole="button"
              accessibilityLabel="Close meal editor"
            >
              <Ionicons name="close" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          <Text style={styles.fieldLabel}>WHAT WILL BE SERVED?</Text>
          <TextInput
            value={food}
            onChangeText={setFood}
            placeholder="e.g. Pasta, cucumber salad and milk"
            placeholderTextColor={colors.textFaint}
            style={[styles.input, styles.multilineInput]}
            multiline
            accessibilityLabel="Food description"
          />

          <Text style={styles.fieldLabel}>SERVING TIME</Text>
          <TextInput
            value={time}
            onChangeText={setTime}
            placeholder="11:45"
            placeholderTextColor={colors.textFaint}
            style={styles.input}
            keyboardType="numbers-and-punctuation"
            maxLength={5}
            accessibilityLabel="Serving time"
          />

          <Text style={styles.fieldLabel}>CONTAINS · OPTIONAL</Text>
          <TextInput
            value={allergens}
            onChangeText={setAllergens}
            placeholder="gluten, dairy"
            placeholderTextColor={colors.textFaint}
            style={styles.input}
            autoCapitalize="none"
            accessibilityLabel="Allergens"
          />
          <Text style={styles.fieldHint}>Separate allergens with commas. Children are checked automatically.</Text>

          <TouchableOpacity
            onPress={apply}
            style={styles.primaryButton}
            accessibilityRole="button"
          >
            <Text style={styles.primaryButtonText}>
              {food.trim() ? `Use ${item.meal_label.toLowerCase()}` : `Remove ${item.meal_label.toLowerCase()}`}
            </Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function MenuCard({ item, allergyMatches, onPress }) {
  const populated = Boolean(item.food_description);
  if (!populated) {
    return (
      <TouchableOpacity
        onPress={onPress}
        style={styles.emptyMealCard}
        activeOpacity={0.72}
        accessibilityRole="button"
        accessibilityLabel={`Add ${item.meal_label}`}
      >
        <View style={styles.mealIcon}>
          <Ionicons name="add" size={18} color={colors.primary} />
        </View>
        <Text style={styles.emptyMealText}>Add {item.meal_label.toLowerCase()}</Text>
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity
      onPress={onPress}
      style={styles.mealCard}
      activeOpacity={0.72}
      accessibilityRole="button"
      accessibilityLabel={`Edit ${item.meal_label}`}
    >
      <View style={styles.mealCardHeader}>
        <View style={styles.mealIcon}>
          <Ionicons name="restaurant-outline" size={16} color={colors.primary} />
        </View>
        <Text style={styles.mealTitle}>
          {item.meal_label}{' '}
          <Text style={styles.mealTime}>· {formatMealTime(item.meal_time)}</Text>
        </Text>
        <Ionicons name="pencil-outline" size={16} color={colors.primary} />
      </View>
      <Text style={styles.foodDescription}>{item.food_description}</Text>
      {item.inherited && (
        <View style={styles.inheritedBadge}>
          <Text style={styles.inheritedBadgeText}>Using the All rooms menu</Text>
        </View>
      )}
      <View style={styles.badgeRow}>
        {!!item.allergens?.length && (
          <View style={styles.allergenBadge}>
            <Text style={styles.allergenBadgeText}>Contains: {item.allergens.join(', ')}</Text>
          </View>
        )}
        {!!allergyMatches.length && (
          <View style={styles.conflictBadge}>
            <Text style={styles.conflictBadgeText}>
              {allergyMatches.length} {allergyMatches.length === 1 ? 'child' : 'children'} flagged
            </Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

export default function MealMenuScreen({ navigation }) {
  const { profile } = useAuth();
  const { active: activeClassroom, classrooms } = useClassroom();
  const insets = useSafeAreaInsets();
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [scope, setScope] = useState(null);
  const [weekRows, setWeekRows] = useState([]);
  const [children, setChildren] = useState([]);
  const [drafts, setDrafts] = useState(MEAL_SLOTS.map(blankSlot));
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [scopeOpen, setScopeOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const weekStart = useMemo(
    () => startOfWeek(selectedDate, { weekStartsOn: 1 }),
    [selectedDate]
  );
  const weekDays = useMemo(
    () => Array.from({ length: 5 }, (_, index) => addDays(weekStart, index)),
    [weekStart]
  );
  const selectedDateKey = format(selectedDate, 'yyyy-MM-dd');
  const weekStartKey = format(weekStart, 'yyyy-MM-dd');
  const weekEndKey = format(addDays(weekStart, 4), 'yyyy-MM-dd');

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!profile?.daycare_id) return;
    if (!quiet) setLoading(true);

    const menuQuery = supabase
      .from('meal_menu_items')
      .select('*')
      .eq('daycare_id', profile.daycare_id)
      .gte('menu_date', weekStartKey)
      .lte('menu_date', weekEndKey)
      .order('meal_time');

    const childrenQuery = supabase
      .from('children')
      .select('id, first_name, last_name, classroom_id, allergies')
      .eq('daycare_id', profile.daycare_id)
      .is('archived_at', null)
      .order('first_name');

    const [menuResult, childrenResult] = await Promise.all([menuQuery, childrenQuery]);

    if (menuResult.error) {
      showToast(`Couldn't load the meal menu: ${menuResult.error.message}`, 'error');
      setWeekRows([]);
    } else {
      const rows = menuResult.data || [];
      setWeekRows(rows);
      const dayRows = rows.filter(row => row.menu_date === selectedDateKey);
      setDrafts(draftForScope(dayRows, scope?.id || null));
    }

    if (!childrenResult.error) setChildren(childrenResult.data || []);
    setLoading(false);
    setRefreshing(false);
  }, [
    profile?.daycare_id,
    scope?.id,
    selectedDateKey,
    weekEndKey,
    weekStartKey,
  ]);

  useEffect(() => {
    load();
  }, [load]);

  const visibleChildren = useMemo(() => {
    if (scope?.id) return children.filter(child => child.classroom_id === scope.id);
    return children;
  }, [children, scope?.id]);

  function menuCountFor(date) {
    const key = format(date, 'yyyy-MM-dd');
    const rows = weekRows.filter(row => row.menu_date === key);
    return draftForScope(rows, scope?.id || null).filter(item => item.food_description).length;
  }

  function allergyMatchesFor(item) {
    const allergens = new Set((item.allergens || []).map(value => value.toLowerCase()));
    if (!allergens.size) return [];
    return visibleChildren.filter(child =>
      (child.allergies || []).some(allergy => {
        const normalized = allergy.toLowerCase();
        return [...allergens].some(value =>
          normalized.includes(value) || value.includes(normalized)
        );
      })
    );
  }

  function chooseScope(nextScope) {
    setScope(nextScope);
    setScopeOpen(false);
  }

  function applyEdit(updated) {
    setDrafts(previous =>
      previous.map(item => item.meal_type === updated.meal_type ? updated : item)
    );
    setEditing(null);
  }

  async function saveMenu() {
    const populated = drafts.filter(item => item.food_description.trim());
    if (!populated.length) {
      Alert.alert('Add a meal', 'Enter at least one meal before saving this menu.');
      return;
    }

    setSaving(true);
    const { data, error } = await supabase.rpc('save_meal_menu_day', {
      p_menu_date: selectedDateKey,
      p_classroom_id: scope?.id || null,
      p_items: populated.map(item => ({
        meal_type: item.meal_type,
        meal_label: item.meal_label,
        meal_time: item.meal_time,
        food_description: item.food_description,
        allergens: item.allergens || [],
      })),
    });
    setSaving(false);

    if (error) {
      Alert.alert('Could not save the menu', error.message);
      return;
    }

    const otherDates = weekRows.filter(row => row.menu_date !== selectedDateKey);
    setWeekRows([...otherDates, ...(data || [])]);
    setDrafts(draftForScope(data || [], scope?.id || null));
    showToast(`Menu saved for ${format(selectedDate, 'EEEE')}`, 'success');
  }

  function confirmCopyLastWeek() {
    Alert.alert(
      'Copy last week?',
      `Replace the draft for ${format(selectedDate, 'EEEE, MMM d')} with the menu from ${format(subDays(selectedDate, 7), 'EEEE, MMM d')}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Copy menu', onPress: copyLastWeek },
      ]
    );
  }

  async function copyLastWeek() {
    const sourceDate = format(subDays(selectedDate, 7), 'yyyy-MM-dd');
    let query = supabase
      .from('meal_menu_items')
      .select('*')
      .eq('daycare_id', profile.daycare_id)
      .eq('menu_date', sourceDate);

    if (scope?.id) {
      query = query.or(`classroom_id.eq.${scope.id},classroom_id.is.null`);
    } else {
      query = query.is('classroom_id', null);
    }

    const { data, error } = await query.order('meal_time');
    if (error) {
      Alert.alert('Could not copy last week', error.message);
      return;
    }

    const copied = draftForScope(data || [], scope?.id || null);
    if (!copied.some(item => item.food_description)) {
      Alert.alert('No menu last week', 'There is no menu to copy for this room and weekday.');
      return;
    }
    setDrafts(copied.map(item => ({ ...item, id: undefined, inherited: false })));
    showToast('Last week’s menu copied into this draft', 'success');
  }

  if (loading) {
    return (
      <View style={styles.loadingScreen}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Loading the meal menu…</Text>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: Math.max(insets.bottom, spacing.xl) + 78 },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={colors.primary}
            onRefresh={() => {
              setRefreshing(true);
              load({ quiet: true });
            }}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={styles.backButton}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <Ionicons name="chevron-back" size={21} color={colors.textPrimary} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setScopeOpen(true)}
            style={styles.titleCopy}
            activeOpacity={0.72}
            accessibilityRole="button"
            accessibilityLabel={`Meal menu for ${scope?.name || 'all rooms'}. Change`}
          >
            <Text style={styles.title}>Meal menu</Text>
            <Text style={styles.subtitle}>
              {scope?.name || 'All rooms'} · <Text style={styles.subtitleLink}>change</Text>
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={confirmCopyLastWeek}
            style={styles.copyButton}
            accessibilityRole="button"
          >
            <Text style={styles.copyButtonText}>Copy last week</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.weekHeader}>
          <TouchableOpacity
            onPress={() => setSelectedDate(previous => addWeeks(previous, -1))}
            style={styles.weekArrow}
            accessibilityLabel="Previous week"
          >
            <Ionicons name="chevron-back" size={16} color={colors.textMuted} />
          </TouchableOpacity>
          {weekDays.map(day => {
            const selected = isSameDay(day, selectedDate);
            const count = menuCountFor(day);
            return (
              <TouchableOpacity
                key={day.toISOString()}
                onPress={() => setSelectedDate(day)}
                style={styles.dayColumn}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={`${format(day, 'EEEE, MMMM d')}${count ? `, ${count} meals set` : ', no menu set'}`}
              >
                <Text style={styles.dayName}>{format(day, 'EEE')}</Text>
                <View style={[styles.dayNumber, selected && styles.dayNumberSelected]}>
                  <Text style={[styles.dayNumberText, selected && styles.dayNumberTextSelected]}>
                    {format(day, 'd')}
                  </Text>
                </View>
                <View style={[
                  styles.dayDot,
                  count === 3 && styles.dayDotComplete,
                  count > 0 && count < 3 && styles.dayDotPartial,
                ]} />
              </TouchableOpacity>
            );
          })}
          <TouchableOpacity
            onPress={() => setSelectedDate(previous => addWeeks(previous, 1))}
            style={styles.weekArrow}
            accessibilityLabel="Next week"
          >
            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        <View style={styles.autofillBanner}>
          <Ionicons name="flash-outline" size={17} color={colors.primary} />
          <Text style={styles.autofillText}>
            Today’s menu auto-fills every child’s meal log — educators only record how much was eaten.
          </Text>
        </View>

        <View style={styles.dateHeading}>
          <View>
            <Text style={styles.dateTitle}>{format(selectedDate, 'EEEE, MMMM d')}</Text>
            <Text style={styles.dateSubtitle}>
              {drafts.filter(item => item.food_description).length} of {MEAL_SLOTS.length} meals planned
            </Text>
          </View>
          {isSameDay(selectedDate, new Date()) && (
            <View style={styles.todayBadge}>
              <Text style={styles.todayBadgeText}>TODAY</Text>
            </View>
          )}
        </View>

        <View style={styles.menuList}>
          {drafts.map(item => (
            <MenuCard
              key={item.meal_type}
              item={item}
              allergyMatches={allergyMatchesFor(item)}
              onPress={() => setEditing(item)}
            />
          ))}
        </View>

        <Text style={styles.parentHint}>
          Parents see the saved menu in their child’s daily report.
        </Text>
      </ScrollView>

      <View style={[styles.fixedFooter, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
        <TouchableOpacity
          onPress={saveMenu}
          disabled={saving}
          style={[styles.primaryButton, saving && styles.buttonDisabled]}
          accessibilityRole="button"
          accessibilityState={{ busy: saving, disabled: saving }}
        >
          {saving ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <Text style={styles.primaryButtonText}>
              Save menu for {format(selectedDate, 'EEEE')}
            </Text>
          )}
        </TouchableOpacity>
      </View>

      <ScopePicker
        visible={scopeOpen}
        classrooms={classrooms}
        value={scope}
        onChoose={chooseScope}
        onClose={() => setScopeOpen(false)}
      />
      <MealEditor
        item={editing}
        visible={Boolean(editing)}
        onClose={() => setEditing(null)}
        onApply={applyEdit}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  scroll: { flex: 1 },
  content: { paddingHorizontal: spacing.xl, paddingTop: spacing.md },
  loadingScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
  },
  loadingText: {
    marginTop: spacing.md,
    fontSize: 13,
    fontFamily: fonts.regular,
    color: colors.textFaint,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  backButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleCopy: { flex: 1, minWidth: 0 },
  title: {
    fontSize: 23,
    lineHeight: 28,
    fontFamily: fonts.black,
    color: colors.textPrimary,
  },
  subtitle: {
    marginTop: 1,
    fontSize: 12.5,
    fontFamily: fonts.regular,
    color: colors.textMuted,
  },
  subtitleLink: { color: colors.primary, fontFamily: fonts.bold },
  copyButton: {
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    backgroundColor: colors.primaryLight,
  },
  copyButtonText: {
    fontSize: 12,
    fontFamily: fonts.bold,
    color: colors.primary,
  },
  weekHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.sm,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  weekArrow: {
    width: 26,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayColumn: { flex: 1, alignItems: 'center', gap: 4 },
  dayName: {
    fontSize: 10.5,
    fontFamily: fonts.bold,
    color: colors.textFaint,
  },
  dayNumber: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  dayNumberSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  dayNumberText: {
    fontSize: 13,
    fontFamily: fonts.bold,
    color: colors.textPrimary,
  },
  dayNumberTextSelected: { color: colors.white },
  dayDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: 'transparent',
  },
  dayDotComplete: { backgroundColor: colors.success },
  dayDotPartial: { backgroundColor: '#D9B36A' },
  autofillBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginTop: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.primaryLight,
  },
  autofillText: {
    flex: 1,
    fontSize: 12.5,
    lineHeight: 18,
    fontFamily: fonts.regular,
    color: colors.textSecondary,
  },
  dateHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xl,
    marginBottom: spacing.md,
  },
  dateTitle: {
    fontSize: 16,
    fontFamily: fonts.black,
    color: colors.textPrimary,
  },
  dateSubtitle: {
    marginTop: 2,
    fontSize: 12,
    fontFamily: fonts.regular,
    color: colors.textFaint,
  },
  todayBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.full,
    backgroundColor: colors.primaryLight,
  },
  todayBadgeText: {
    fontSize: 9.5,
    fontFamily: fonts.bold,
    letterSpacing: 0.6,
    color: colors.primary,
  },
  menuList: { gap: spacing.md },
  mealCard: {
    padding: spacing.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
  },
  mealCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  mealIcon: {
    width: 32,
    height: 32,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primarySoft,
  },
  mealTitle: {
    flex: 1,
    minWidth: 0,
    fontSize: 14.5,
    fontFamily: fonts.black,
    color: colors.textPrimary,
  },
  mealTime: {
    fontSize: 12,
    fontFamily: fonts.regular,
    color: colors.textFaint,
  },
  foodDescription: {
    marginTop: spacing.sm,
    fontSize: 14,
    lineHeight: 21,
    fontFamily: fonts.regular,
    color: colors.textSecondary,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: spacing.sm,
  },
  allergenBadge: {
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 4,
    borderRadius: radius.full,
    backgroundColor: colors.amberLight,
  },
  allergenBadgeText: {
    fontSize: 10.5,
    fontFamily: fonts.bold,
    color: colors.amber,
  },
  conflictBadge: {
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 4,
    borderRadius: radius.full,
    backgroundColor: colors.dangerLight,
  },
  conflictBadgeText: {
    fontSize: 10.5,
    fontFamily: fonts.bold,
    color: colors.danger,
  },
  inheritedBadge: {
    alignSelf: 'flex-start',
    marginTop: spacing.sm,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 4,
    borderRadius: radius.full,
    backgroundColor: colors.primarySoft,
  },
  inheritedBadgeText: {
    fontSize: 10.5,
    fontFamily: fonts.bold,
    color: colors.primary,
  },
  emptyMealCard: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.lg,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.borderStrong,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
  },
  emptyMealText: {
    flex: 1,
    fontSize: 14,
    fontFamily: fonts.bold,
    color: colors.primary,
  },
  parentHint: {
    marginTop: spacing.lg,
    fontSize: 12,
    lineHeight: 18,
    fontFamily: fonts.regular,
    color: colors.textFaint,
    textAlign: 'center',
  },
  fixedFooter: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.borderSoft,
    backgroundColor: colors.bg,
  },
  primaryButton: {
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.primary,
  },
  primaryButtonText: {
    fontSize: 15.5,
    fontFamily: fonts.bold,
    color: colors.white,
  },
  buttonDisabled: { opacity: 0.55 },
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(23,51,91,0.42)',
  },
  modalDismiss: { flex: 1 },
  sheetHandle: {
    width: 44,
    height: 5,
    alignSelf: 'center',
    marginBottom: spacing.md,
    borderRadius: radius.full,
    backgroundColor: colors.border,
  },
  scopeSheet: {
    maxHeight: '76%',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxxl,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    backgroundColor: colors.bg,
  },
  scopeHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  scopeTitle: {
    fontSize: 20,
    fontFamily: fonts.black,
    color: colors.textPrimary,
  },
  scopeSubtitle: {
    marginTop: 3,
    fontSize: 12.5,
    fontFamily: fonts.regular,
    color: colors.textFaint,
  },
  iconButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primarySoft,
  },
  scopeRow: {
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  scopeRowSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
  },
  scopeIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primaryLight,
  },
  scopeCopy: { flex: 1 },
  scopeRowTitle: {
    fontSize: 14,
    fontFamily: fonts.bold,
    color: colors.textPrimary,
  },
  scopeRowSubtitle: {
    marginTop: 2,
    fontSize: 11.5,
    fontFamily: fonts.regular,
    color: colors.textFaint,
  },
  editorSheet: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxxl,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    backgroundColor: colors.bg,
  },
  editorHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: spacing.xl,
  },
  editorHeading: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  editorTitle: {
    fontSize: 18,
    fontFamily: fonts.black,
    color: colors.textPrimary,
  },
  editorSubtitle: {
    marginTop: 2,
    fontSize: 11.5,
    fontFamily: fonts.regular,
    color: colors.textFaint,
  },
  fieldLabel: {
    marginBottom: spacing.sm,
    fontSize: 11,
    fontFamily: fonts.bold,
    letterSpacing: 0.85,
    color: colors.textFaint,
  },
  input: {
    minHeight: 50,
    marginBottom: spacing.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    fontSize: 14,
    fontFamily: fonts.regular,
    color: colors.textPrimary,
  },
  multilineInput: {
    minHeight: 84,
    textAlignVertical: 'top',
  },
  fieldHint: {
    marginTop: -spacing.sm,
    marginBottom: spacing.lg,
    fontSize: 11.5,
    lineHeight: 17,
    fontFamily: fonts.regular,
    color: colors.textFaint,
  },
});
