import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { format } from 'date-fns';

export function useDailyLog(childId, date = new Date()) {
  const dateStr = format(date, 'yyyy-MM-dd');
  const [log, setLog] = useState(null);
  const [meals, setMeals] = useState([]);
  const [diapers, setDiapers] = useState([]);
  const [sleeps, setSleeps] = useState([]);
  const [activities, setActivities] = useState([]);
  const [supplies, setSupplies] = useState([]);
  const [loading, setLoading] = useState(true);

  // Get or create the daily log record
  const getOrCreateLog = useCallback(async () => {
    if (!childId) return;
    setLoading(true);

    let { data } = await supabase
      .from('daily_logs')
      .select('*')
      .eq('child_id', childId)
      .eq('log_date', dateStr)
      .single();

    if (!data) {
      const { data: newLog } = await supabase
        .from('daily_logs')
        .insert({ child_id: childId, log_date: dateStr })
        .select()
        .single();
      data = newLog;
    }

    setLog(data);
    if (data) await fetchAllEntries(data.id);
    setLoading(false);
  }, [childId, dateStr]);

  async function fetchAllEntries(logId) {
    const [mealsRes, diapersRes, sleepsRes, activitiesRes, suppliesRes] = await Promise.all([
      supabase.from('meal_entries').select('*').eq('daily_log_id', logId).order('time'),
      supabase.from('diaper_entries').select('*').eq('daily_log_id', logId).order('time'),
      supabase.from('sleep_entries').select('*').eq('daily_log_id', logId).order('start_time'),
      supabase.from('activity_entries').select('*').eq('daily_log_id', logId),
      supabase.from('supply_requests').select('*').eq('daily_log_id', logId),
    ]);
    setMeals(mealsRes.data || []);
    setDiapers(diapersRes.data || []);
    setSleeps(sleepsRes.data || []);
    setActivities(activitiesRes.data || []);
    setSupplies(suppliesRes.data || []);
  }

  useEffect(() => { getOrCreateLog(); }, [getOrCreateLog]);

  // Real-time subscriptions so parent view updates live
  useEffect(() => {
    if (!log?.id) return;

    const tables = ['meal_entries', 'diaper_entries', 'sleep_entries', 'activity_entries', 'supply_requests'];
    const setters = { meal_entries: setMeals, diaper_entries: setDiapers, sleep_entries: setSleeps, activity_entries: setActivities, supply_requests: setSupplies };

    const channels = tables.map(table =>
      supabase.channel(`${table}:${log.id}`)
        .on('postgres_changes', {
          event: '*', schema: 'public', table,
          filter: `daily_log_id=eq.${log.id}`,
        }, (payload) => {
          setters[table](prev => {
            if (payload.eventType === 'INSERT') return [...prev, payload.new];
            if (payload.eventType === 'UPDATE') return prev.map(r => r.id === payload.new.id ? payload.new : r);
            if (payload.eventType === 'DELETE') return prev.filter(r => r.id !== payload.old.id);
            return prev;
          });
        })
        .subscribe()
    );

    return () => channels.forEach(c => supabase.removeChannel(c));
  }, [log?.id]);

  // ---- MOOD ----
  async function updateMoods(moods) {
    if (!log) return;
    await supabase.from('daily_logs').update({ moods }).eq('id', log.id);
    setLog(prev => ({ ...prev, moods }));
  }

  // ---- NOTES / COMMENTS ----
  async function updateNotes(notes, comments) {
    if (!log) return;
    await supabase.from('daily_logs').update({ notes, comments }).eq('id', log.id);
    setLog(prev => ({ ...prev, notes, comments }));
  }

  // ---- MEALS ----
  async function addMeal(time, foodType, amount) {
    if (!log) return;
    await supabase.from('meal_entries').insert({ daily_log_id: log.id, time, food_type: foodType, amount });
  }

  async function updateMeal(id, updates) {
    await supabase.from('meal_entries').update(updates).eq('id', id);
  }

  async function deleteMeal(id) {
    await supabase.from('meal_entries').delete().eq('id', id);
  }

  // ---- DIAPERS ----
  async function addDiaper(time, type = 'diaper', wet = false, bm = false) {
    if (!log) return;
    await supabase.from('diaper_entries').insert({ daily_log_id: log.id, time, type, wet, bm });
  }

  async function updateDiaper(id, updates) {
    await supabase.from('diaper_entries').update(updates).eq('id', id);
  }

  async function deleteDiaper(id) {
    await supabase.from('diaper_entries').delete().eq('id', id);
  }

  // ---- SLEEP ----
  async function addSleep(startTime) {
    if (!log) return;
    const { data } = await supabase.from('sleep_entries')
      .insert({ daily_log_id: log.id, start_time: startTime })
      .select().single();
    return data;
  }

  async function updateSleep(id, updates) {
    await supabase.from('sleep_entries').update(updates).eq('id', id);
  }

  async function deleteSleep(id) {
    await supabase.from('sleep_entries').delete().eq('id', id);
  }

  // ---- ACTIVITIES ----
  async function toggleActivity(activityName) {
    if (!log) return;
    const existing = activities.find(a => a.activity_name === activityName);
    if (existing) {
      await supabase.from('activity_entries').delete().eq('id', existing.id);
    } else {
      await supabase.from('activity_entries').insert({ daily_log_id: log.id, activity_name: activityName });
    }
  }

  // ---- SUPPLIES ----
  async function toggleSupply(itemName) {
    if (!log) return;
    const existing = supplies.find(s => s.item_name === itemName);
    if (existing) {
      await supabase.from('supply_requests').delete().eq('id', existing.id);
    } else {
      await supabase.from('supply_requests').insert({ daily_log_id: log.id, item_name: itemName });
    }
  }

  // ---- SEND TO PARENTS ----
  async function sendToParents() {
    if (!log) return;
    await supabase.from('daily_logs')
      .update({ sent_to_parents: true, sent_at: new Date().toISOString() })
      .eq('id', log.id);
    setLog(prev => ({ ...prev, sent_to_parents: true }));
  }

  return {
    log, meals, diapers, sleeps, activities, supplies, loading,
    updateMoods, updateNotes,
    addMeal, updateMeal, deleteMeal,
    addDiaper, updateDiaper, deleteDiaper,
    addSleep, updateSleep, deleteSleep,
    toggleActivity, toggleSupply,
    sendToParents,
    refresh: getOrCreateLog,
  };
}

// ---- COPY YESTERDAY ----
// Standalone function — copies yesterday's meals and activities into today's log
export async function copyYesterdayLog(childId, todayLogId) {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = format(yesterday, 'yyyy-MM-dd');

  // Find yesterday's log
  const { data: yLog } = await supabase
    .from('daily_logs')
    .select('id, moods')
    .eq('child_id', childId)
    .eq('log_date', yesterdayStr)
    .single();

  if (!yLog) return { copied: false, reason: 'No log found for yesterday.' };

  // Fetch yesterday's entries
  const [meals, activities] = await Promise.all([
    supabase.from('meal_entries').select('*').eq('daily_log_id', yLog.id).order('time'),
    supabase.from('activity_entries').select('*').eq('daily_log_id', yLog.id),
  ]);

  const inserts = [];

  if (meals.data?.length) {
    inserts.push(
      supabase.from('meal_entries').insert(
        meals.data.map(m => ({
          daily_log_id: todayLogId,
          time: m.time,
          food_type: m.food_type,
          amount: m.amount,
        }))
      )
    );
  }

  if (activities.data?.length) {
    // Only copy activities not already in today's log
    const { data: existingActivities } = await supabase
      .from('activity_entries')
      .select('activity_name')
      .eq('daily_log_id', todayLogId);

    const existing = new Set((existingActivities || []).map(a => a.activity_name));
    const newActivities = activities.data.filter(a => !existing.has(a.activity_name));

    if (newActivities.length) {
      inserts.push(
        supabase.from('activity_entries').insert(
          newActivities.map(a => ({
            daily_log_id: todayLogId,
            activity_name: a.activity_name,
          }))
        )
      );
    }
  }

  await Promise.all(inserts);

  return {
    copied: true,
    mealCount: meals.data?.length || 0,
    activityCount: activities.data?.length || 0,
  };
}
