import React, { useState, useEffect } from 'react';
import { View, Text, FlatList, TouchableOpacity, TextInput, StyleSheet, RefreshControl } from 'react-native';
import { useAuth } from '../../hooks/useAuth';
import { useClassroom } from '../../hooks/useClassroom';
import { useIsFocused } from '@react-navigation/native';
import { supabase } from '../../lib/supabase';
import { LoadingScreen, EmptyState } from '../../components/ui';
import { ClassroomSwitcher } from '../../components/ClassroomSwitcher';
import { ChildAvatar } from '../../components/ChildAvatar';
import { colors, spacing, radius } from '../../theme';
import { format, subDays, addDays, isToday as checkIsToday } from 'date-fns';

export default function RosterScreen({ navigation }) {
  const { profile }                     = useAuth();
  const { active: activeClassroom }     = useClassroom();
  const isFocused                       = useIsFocused();
  const [children, setChildren]         = useState([]);
  const [logStatus, setLogStatus]       = useState({});
  const [loading, setLoading]           = useState(true);
  const [refreshing, setRefreshing]     = useState(false);
  const [filter, setFilter]             = useState('all');
  const [searchQuery, setSearchQuery]   = useState('');
  const [selectedDate, setSelectedDate] = useState(new Date());

  const dateStr   = format(selectedDate, 'yyyy-MM-dd');
  const isToday   = checkIsToday(selectedDate);
  const classroomId = activeClassroom?.id || profile?.classroom_id;

  async function load() {
    if (!classroomId) return;

    const { data: kids } = await supabase
      .from('children')
      .select('*')
      .eq('classroom_id', classroomId)
      .order('first_name');

    setChildren(kids || []);

    if (kids?.length) {
      const { data: logs } = await supabase
        .from('daily_logs')
        .select('id, child_id, sent_to_parents, moods')
        .in('child_id', kids.map(k => k.id))
        .eq('log_date', dateStr);

      const status = {};
      await Promise.all((logs || []).map(async log => {
        const [meals, diapers, activities] = await Promise.all([
          supabase.from('meal_entries').select('id', { count: 'exact', head: true }).eq('daily_log_id', log.id),
          supabase.from('diaper_entries').select('id', { count: 'exact', head: true }).eq('daily_log_id', log.id),
          supabase.from('activity_entries').select('id', { count: 'exact', head: true }).eq('daily_log_id', log.id),
        ]);
        status[log.child_id] = {
          sent: log.sent_to_parents,
          mood: log.moods?.[0],
          entryCount: (meals.count || 0) + (diapers.count || 0) + (activities.count || 0),
        };
      }));
      setLogStatus(status);
    }

    setLoading(false);
    setRefreshing(false);
  }

  useEffect(() => {
    if (isFocused && classroomId) load();
  }, [isFocused, classroomId, dateStr]);

  if (loading) return <LoadingScreen />;

  const moodEmoji = { Happy: '😊', Fussy: '😤', Curious: '🧐', Irritable: '😠', Sleepy: '😴', Sick: '🤒' };

  // Summary counts for header
  const sent    = Object.values(logStatus).filter(s => s.sent).length;
  const started = Object.values(logStatus).filter(s => s.entryCount > 0 && !s.sent).length;
  const empty   = children.length - sent - started;

  function renderChild({ item }) {
    const status    = logStatus[item.id];
    const hasEntries = status?.entryCount > 0;
    const isSent     = status?.sent;

    return (
      <TouchableOpacity
        style={styles.childCard}
        onPress={() => navigation.navigate('DailyLog', { child: item })}
        activeOpacity={0.7}
      >
        <View style={styles.childAvatarWrap}>
          <ChildAvatar child={item} size={48} />
        </View>
        <View style={styles.childInfo}>
          <Text style={styles.childName}>{item.first_name} {item.last_name}</Text>
          <View style={styles.statusRow}>
            {hasEntries
              ? <Text style={styles.entryCount}>{status.entryCount} entries</Text>
              : <Text style={styles.noEntries}>No entries</Text>
            }
            {status?.mood && <Text style={styles.moodBadge}>{moodEmoji[status.mood] || '😊'}</Text>}
          </View>
        </View>
        <View style={styles.rightCol}>
          {isSent
            ? <View style={styles.sentBadge}><Text style={styles.sentText}>Sent ✓</Text></View>
            : hasEntries
              ? <View style={styles.draftBadge}><Text style={styles.draftText}>Draft</Text></View>
              : null
          }
          <Text style={styles.chevron}>›</Text>
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>Good {getTimeOfDay()}, {profile?.full_name?.split(' ')[0]} 👋</Text>
          <ClassroomSwitcher />
        </View>
        <View style={styles.countBadge}>
          <Text style={styles.countText}>{children.length}</Text>
          <Text style={styles.countLabel}>children</Text>
        </View>
      </View>

      {/* Date navigation */}
      <View style={styles.dateNav}>
        <TouchableOpacity onPress={() => setSelectedDate(d => subDays(d, 1))} style={styles.dateBtn}>
          <Text style={styles.dateBtnText}>‹</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setSelectedDate(new Date())} style={styles.dateCenter}>
          <Text style={styles.dateLabel}>{isToday ? 'Today' : format(selectedDate, 'EEE, MMM d')}</Text>
          {!isToday && <Text style={styles.dateTap}>Tap for today</Text>}
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setSelectedDate(d => addDays(d, 1))}
          style={[styles.dateBtn, isToday && { opacity: 0.3 }]}
          disabled={isToday}
        >
          <Text style={styles.dateBtnText}>›</Text>
        </TouchableOpacity>
      </View>

      {/* Filter bar */}
      {children.length > 0 && (
        <View style={styles.filterBar}>
          {[
            { key: 'all',     label: 'All',     count: children.length },
            { key: 'pending', label: 'Pending', count: empty + started },
            { key: 'sent',    label: 'Sent',    count: sent },
          ].map(f => (
            <TouchableOpacity
              key={f.key}
              onPress={() => setFilter(f.key)}
              style={[styles.filterBtn, filter === f.key && styles.filterBtnActive]}
            >
              <Text style={[styles.filterText, filter === f.key && styles.filterTextActive]}>
                {f.label} ({f.count})
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Search bar */}
      {children.length > 5 && (
        <View style={styles.searchBar}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search by name..."
            placeholderTextColor={colors.textMuted}
            autoCorrect={false}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')} style={styles.searchClear}>
              <Text style={styles.searchClearText}>✕</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      <FlatList
        data={children.filter(c => {
          // Search filter
          const query = searchQuery.toLowerCase().trim();
          if (query) {
            const fullName = `${c.first_name} ${c.last_name}`.toLowerCase();
            if (!fullName.includes(query)) return false;
          }
          // Status filter
          if (filter === 'all') return true;
          const s = logStatus[c.id];
          if (filter === 'sent') return s?.sent;
          if (filter === 'pending') return !s?.sent;
          return true;
        })}
        keyExtractor={c => c.id}
        renderItem={renderChild}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />
        }
        ListEmptyComponent={
          <EmptyState icon="🏫" message={"No children in your classroom yet.\nGo to Settings → Manage classroom to add them."} />
        }
      />
    </View>
  );
}

function getTimeOfDay() {
  const h = new Date().getHours();
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  return 'evening';
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: spacing.xl, paddingTop: spacing.xl + spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  greeting: { fontSize: 17, fontWeight: '600', color: colors.textPrimary },
  date: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
  countBadge: {
    backgroundColor: colors.primaryLight, borderRadius: radius.lg,
    padding: spacing.md, alignItems: 'center', minWidth: 60,
  },
  countText: { fontSize: 22, fontWeight: '700', color: colors.primary },
  countLabel: { fontSize: 11, color: colors.primary, fontWeight: '500' },
  dateNav: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.surface,
    borderBottomWidth: 1, borderBottomColor: colors.border,
    paddingHorizontal: spacing.sm,
  },
  dateBtn: { padding: spacing.md },
  dateBtnText: { fontSize: 20, color: colors.primary, fontWeight: '500' },
  dateCenter: { flex: 1, alignItems: 'center', paddingVertical: spacing.sm },
  dateLabel: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  dateTap: { fontSize: 11, color: colors.primary, marginTop: 2 },
  filterBar: {
    flexDirection: 'row', gap: spacing.sm,
    paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm,
  },
  filterBtn: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: radius.full, borderWidth: 1.5, borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  filterBtnActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  filterText: { fontSize: 13, color: colors.textSecondary, fontWeight: '500' },
  filterTextActive: { color: colors.primary, fontWeight: '600' },
  searchBar: {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: spacing.lg, marginTop: spacing.sm, marginBottom: spacing.xs,
    backgroundColor: colors.surface, borderRadius: radius.full,
    borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.md, height: 40,
  },
  searchIcon: { fontSize: 14, marginRight: spacing.sm },
  searchInput: {
    flex: 1, fontSize: 14, color: colors.textPrimary,
    paddingVertical: 0,
  },
  searchClear: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: colors.border, alignItems: 'center', justifyContent: 'center',
  },
  searchClearText: { fontSize: 11, color: colors.textSecondary, fontWeight: '700' },
  list: { padding: spacing.lg },
  childCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.surface, borderRadius: radius.lg,
    padding: spacing.lg, marginBottom: spacing.sm,
    borderWidth: 1, borderColor: colors.border,
  },
  childAvatarWrap: {
    marginRight: spacing.md,
  },
  childInfo: { flex: 1 },
  childName: { fontSize: 16, fontWeight: '600', color: colors.textPrimary },
  statusRow: { flexDirection: 'row', alignItems: 'center', marginTop: 3, gap: spacing.sm },
  entryCount: { fontSize: 13, color: colors.textSecondary },
  noEntries: { fontSize: 13, color: colors.textMuted },
  moodBadge: { fontSize: 14 },
  rightCol: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  sentBadge: { backgroundColor: colors.successLight, paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.full },
  sentText: { fontSize: 12, fontWeight: '500', color: colors.success },
  draftBadge: { backgroundColor: colors.amberLight, paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.full },
  draftText: { fontSize: 12, fontWeight: '500', color: colors.amber },
  chevron: { fontSize: 22, color: colors.textMuted, marginLeft: spacing.xs },
});
