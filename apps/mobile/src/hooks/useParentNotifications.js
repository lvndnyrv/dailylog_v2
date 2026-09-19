import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { AppState } from 'react-native';

import { supabase } from '../lib/supabase';
import { openNotificationRoute } from '../lib/notificationRoutes';
import { useAuth } from './useAuth';

const ParentNotificationsContext = createContext(null);
const ID_KEYS = [
  'incidentId', 'requestId', 'closureId', 'transitionId', 'invoiceId',
  'paymentId', 'announcementId', 'medicationLogId', 'authorizationId',
  'recordId', 'eventId', 'reportId', 'submissionId', 'eventKey', 'childId', 'logDate',
];
const ID_ALIASES = {
  incidentId: ['incidentId', 'incident_id'],
  requestId: ['requestId', 'request_id'],
  closureId: ['closureId', 'closure_id'],
  transitionId: ['transitionId', 'transition_id'],
  invoiceId: ['invoiceId', 'invoice_id'],
  paymentId: ['paymentId', 'payment_id'],
  announcementId: ['announcementId', 'announcement_id'],
  medicationLogId: ['medicationLogId', 'medication_log_id'],
  authorizationId: ['authorizationId', 'authorization_id'],
  recordId: ['recordId', 'record_id'],
  eventId: ['eventId', 'event_id'],
  reportId: ['reportId', 'report_id', 'absenceId', 'absence_id', 'absenceReportId', 'absence_report_id'],
  submissionId: ['submissionId', 'submission_id'],
  eventKey: ['eventKey', 'event_key', 'dedupeKey', 'dedupe_key'],
  childId: ['childId', 'child_id'],
  logDate: ['logDate', 'log_date', 'date'],
};

function payloadObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function payloadValue(payload, key) {
  for (const alias of ID_ALIASES[key] || [key]) {
    if (payload?.[alias] !== undefined && payload?.[alias] !== null && payload?.[alias] !== '') {
      return String(payload[alias]);
    }
  }
  return null;
}

function payloadMatches(candidate, incoming) {
  const left = payloadObject(candidate.payload);
  const right = payloadObject(incoming);
  const notificationId = right.notificationId || right.notification_id;
  if (notificationId && candidate.id === notificationId) return true;

  const comparable = ID_KEYS.filter((key) => payloadValue(right, key));
  if (comparable.length && comparable.some((key) => (
    payloadValue(left, key) !== payloadValue(right, key)
  ))) return false;
  if (comparable.length) return true;
  return false;
}

export async function markNotificationPayloadRead(payload) {
  const incoming = payloadObject(payload);
  const notificationId = incoming.notificationId || incoming.notification_id;
  if (notificationId) {
    await supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('id', notificationId)
      .is('read_at', null);
    return notificationId;
  }

  const { data } = await supabase
    .from('notifications')
    .select('id, kind, payload, created_at')
    .is('read_at', null)
    .order('created_at', { ascending: false })
    .limit(30);
  const match = (data || []).find((notification) => payloadMatches(notification, incoming));
  if (!match) return null;
  await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', match.id)
    .is('read_at', null);
  return match.id;
}

export function ParentNotificationsProvider({ children }) {
  const { profile } = useAuth();
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async ({ silent = false } = {}) => {
    if (!profile?.id) {
      setNotifications([]);
      setLoading(false);
      setRefreshing(false);
      return [];
    }
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      const { data, error: loadError } = await supabase
        .from('notifications')
        .select('*')
        .eq('profile_id', profile.id)
        .order('created_at', { ascending: false })
        .limit(100);
      if (loadError) throw loadError;
      setNotifications(data || []);
      return data || [];
    } catch (loadError) {
      setError(loadError.message || 'Your notifications could not be loaded.');
      throw loadError;
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [profile?.id, profile?.role]);

  useEffect(() => {
    refresh().catch(() => {});
  }, [refresh]);

  useEffect(() => {
    if (!profile?.id) return undefined;
    const channelInstance = `${Date.now()}:${Math.random().toString(36).slice(2)}`;
    const channel = supabase
      .channel(`profile-notifications:${profile.id}:${channelInstance}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'notifications',
        filter: `profile_id=eq.${profile.id}`,
      }, (event) => {
        setNotifications((current) => {
          if (event.eventType === 'DELETE') {
            return current.filter((row) => row.id !== event.old.id);
          }
          const next = event.new;
          return [next, ...current.filter((row) => row.id !== next.id)]
            .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
        });
      })
      .subscribe();
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh({ silent: true }).catch(() => {});
    });
    return () => {
      appState.remove();
      supabase.removeChannel(channel);
    };
  }, [profile?.id, profile?.role, refresh]);

  const markRead = useCallback(async (notificationId) => {
    const existing = notifications.find((row) => row.id === notificationId);
    if (!existing || existing.read_at) return;
    const readAt = new Date().toISOString();
    setNotifications((current) => current.map((row) => (
      row.id === notificationId ? { ...row, read_at: readAt } : row
    )));
    const { error: saveError } = await supabase
      .from('notifications')
      .update({ read_at: readAt })
      .eq('id', notificationId);
    if (saveError) {
      setNotifications((current) => current.map((row) => (
        row.id === notificationId ? existing : row
      )));
      throw saveError;
    }
  }, [notifications]);

  const markAllRead = useCallback(async () => {
    const unread = notifications.filter((row) => !row.read_at);
    if (!unread.length) return;
    const readAt = new Date().toISOString();
    setNotifications((current) => current.map((row) => ({ ...row, read_at: row.read_at || readAt })));
    const { error: saveError } = await supabase
      .from('notifications')
      .update({ read_at: readAt })
      .eq('profile_id', profile.id)
      .is('read_at', null);
    if (saveError) {
      setNotifications((current) => current.map((row) => {
        const original = unread.find((item) => item.id === row.id);
        return original || row;
      }));
      throw saveError;
    }
  }, [notifications, profile?.id]);

  const open = useCallback(async (notification) => {
    try {
      await markRead(notification.id);
    } catch {
      // Navigation remains useful even when the read receipt is temporarily offline.
    }
    return openNotificationRoute(
      { type: notification.kind, ...(notification.payload || {}) },
      profile?.role,
    );
  }, [markRead, profile?.role]);

  const unreadCount = useMemo(
    () => notifications.filter((notification) => !notification.read_at).length,
    [notifications],
  );
  const value = useMemo(() => ({
    notifications,
    unreadCount,
    loading,
    refreshing,
    error,
    refresh,
    markRead,
    markAllRead,
    open,
  }), [error, loading, markAllRead, markRead, notifications, open, refresh, refreshing, unreadCount]);

  return (
    <ParentNotificationsContext.Provider value={value}>
      {children}
    </ParentNotificationsContext.Provider>
  );
}

export function useParentNotifications() {
  const context = useContext(ParentNotificationsContext);
  if (!context) throw new Error('useParentNotifications must be used inside ParentNotificationsProvider.');
  return context;
}
