import { useCallback, useState } from 'react';
import * as Calendar from 'expo-calendar/legacy';

import { supabase } from '../lib/supabase';

function localDate(value) {
  if (!value) return null;
  const [year, month, day] = String(value).split('-').map(Number);
  return new Date(year, month - 1, day);
}

function dayAfter(value) {
  const date = localDate(value);
  if (!date) return null;
  date.setDate(date.getDate() + 1);
  return date;
}

export function useParentSchedule() {
  const [hub, setHub] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data, error: loadError } = await supabase.rpc('get_parent_schedule_hub');
      if (loadError) throw loadError;
      setHub(data);
      return data;
    } catch (loadError) {
      const message = loadError?.message || 'The family calendar could not be loaded.';
      setError(message);
      throw new Error(message);
    } finally {
      setLoading(false);
    }
  }, []);

  const addClosureToCalendar = useCallback(async (closure, daycare) => {
    if (!closure?.starts_on || !closure?.ends_on) {
      throw new Error('This closure does not have valid dates yet.');
    }
    const available = await Calendar.isAvailableAsync();
    if (!available) throw new Error('A calendar app is not available on this device.');

    return Calendar.createEventInCalendarAsync({
      title: `${daycare?.name || 'Childcare center'} closed — ${closure.reason}`,
      startDate: localDate(closure.starts_on),
      endDate: dayAfter(closure.ends_on),
      allDay: true,
      notes: [
        closure.family_message,
        closure.billing_treatment === 'no_charge'
          ? 'This closure is marked as a no-charge day by the center.'
          : null,
      ].filter(Boolean).join('\n\n'),
      alarms: closure.reminder_days_before > 0
        ? [{ relativeOffset: -closure.reminder_days_before * 24 * 60 }]
        : [],
    });
  }, []);

  return {
    hub,
    loading,
    error,
    refresh,
    addClosureToCalendar,
  };
}
