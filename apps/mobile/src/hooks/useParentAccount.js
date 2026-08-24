import { useCallback, useState } from 'react';
import { supabase } from '../lib/supabase';

function messageFor(error, fallback) {
  return error?.message || fallback;
}

export function useParentAccount() {
  const [hub, setHub] = useState(null);
  const [notifications, setNotifications] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const refreshHub = useCallback(async () => {
    setLoading(true);
    setError('');
    const { data, error: loadError } = await supabase.rpc('get_parent_account_hub');
    setLoading(false);
    if (loadError) {
      const message = messageFor(loadError, 'Your account could not be loaded.');
      setError(message);
      throw new Error(message);
    }
    setHub(data);
    return data;
  }, []);

  const refreshNotifications = useCallback(async () => {
    setLoading(true);
    setError('');
    const { data, error: loadError } = await supabase.rpc('get_parent_notification_settings');
    setLoading(false);
    if (loadError) {
      const message = messageFor(loadError, 'Notification settings could not be loaded.');
      setError(message);
      throw new Error(message);
    }
    setNotifications(data);
    return data;
  }, []);

  const setNotification = useCallback(async (kind, enabled) => {
    const { data, error: saveError } = await supabase.rpc(
      'set_parent_notification_preference',
      { p_kind: kind, p_enabled: enabled }
    );
    if (saveError) {
      throw new Error(messageFor(saveError, 'The notification setting could not be saved.'));
    }
    const nextEnabled = Boolean(data);
    setNotifications((current) => current ? {
      ...current,
      preferences: { ...current.preferences, [kind]: nextEnabled },
    } : current);
    return nextEnabled;
  }, []);

  const setQuietHours = useCallback(async (enabled, start = '20:00', end = '07:00') => {
    const { data, error: saveError } = await supabase.rpc('set_parent_quiet_hours', {
      p_enabled: enabled,
      p_start: start,
      p_end: end,
    });
    if (saveError) {
      throw new Error(messageFor(saveError, 'Quiet hours could not be saved.'));
    }
    setNotifications((current) => current ? { ...current, ...data } : current);
    return data;
  }, []);

  const inviteGuardian = useCallback(async (childId, email, relationship) => {
    const { data, error: inviteError } = await supabase.rpc(
      'create_parent_co_guardian_invite',
      {
        p_child_id: childId,
        p_email: email,
        p_relationship: relationship || 'Parent/guardian',
      }
    );
    if (inviteError) {
      throw new Error(messageFor(inviteError, 'The invitation could not be created.'));
    }
    return data;
  }, []);

  const cancelGuardianInvite = useCallback(async (inviteId) => {
    const { error: cancelError } = await supabase.rpc(
      'cancel_parent_co_guardian_invite',
      { p_invite_id: inviteId }
    );
    if (cancelError) {
      throw new Error(messageFor(cancelError, 'The invitation could not be cancelled.'));
    }
    setHub((current) => current ? {
      ...current,
      children: (current.children || []).map((child) => ({
        ...child,
        pending_invites: (child.pending_invites || []).filter((invite) => invite.id !== inviteId),
      })),
    } : current);
  }, []);

  const requestDataAction = useCallback(async (requestType) => {
    const { data, error: requestError } = await supabase.rpc('request_parent_data_action', {
      p_request_type: requestType,
    });
    if (requestError) {
      throw new Error(messageFor(requestError, 'The request could not be submitted.'));
    }
    setHub((current) => {
      if (!current) return current;
      const requests = [data, ...(current.data_requests || []).filter((request) => request.id !== data.id)];
      return { ...current, data_requests: requests, latest_data_request: requests[0] };
    });
    return data;
  }, []);

  const cancelDataRequest = useCallback(async (requestId) => {
    const { error: cancelError } = await supabase.rpc('cancel_parent_data_request', {
      p_request_id: requestId,
    });
    if (cancelError) {
      throw new Error(messageFor(cancelError, 'The request could not be cancelled.'));
    }
    setHub((current) => {
      if (!current) return current;
      const requests = (current.data_requests || []).map((request) => (
        request.id === requestId ? { ...request, status: 'cancelled' } : request
      ));
      return { ...current, data_requests: requests, latest_data_request: requests[0] || null };
    });
  }, []);

  return {
    hub,
    notifications,
    loading,
    error,
    refreshHub,
    refreshNotifications,
    setNotification,
    setQuietHours,
    inviteGuardian,
    cancelGuardianInvite,
    requestDataAction,
    cancelDataRequest,
  };
}
