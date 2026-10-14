import { useCallback, useEffect, useRef, useState } from 'react';
import { useIsFocused } from '@react-navigation/native';
import { isAdminRole } from '@dailylog/shared';

import { useAuth } from './useAuth';
import { supabase } from '../lib/supabase';

// A role alone does not authorize room mutations. Keep the entry points in
// sync with save_room_settings, which requires both admin role and rooms/edit.
export function useRoomEditAccess() {
  const { profile } = useAuth();
  const isFocused = useIsFocused();
  const scope = `${profile?.id || ''}:${profile?.daycare_id || ''}:${profile?.role || ''}`;
  const request = useRef(0);
  const [state, setState] = useState({ scope: null, ready: false, canEdit: false, error: null });

  const refresh = useCallback(async () => {
    const version = ++request.current;
    setState({ scope, ready: false, canEdit: false, error: null });
    if (!profile?.id || !profile?.daycare_id || !isAdminRole(profile?.role)) {
      setState({ scope, ready: true, canEdit: false, error: null });
      return;
    }
    try {
      const { data, error } = await supabase.rpc('has_permission', {
        p_area: 'rooms', p_action: 'edit',
      });
      if (version !== request.current) return;
      setState({ scope, ready: true, canEdit: !error && data === true, error: error || null });
    } catch (error) {
      if (version === request.current) {
        setState({ scope, ready: true, canEdit: false, error });
      }
    }
  }, [scope, profile?.id, profile?.daycare_id, profile?.role]);

  useEffect(() => {
    if (isFocused) refresh();
    return () => { request.current += 1; };
  }, [isFocused, refresh]);

  const current = state.scope === scope && isFocused;
  return {
    canEditRooms: current && state.ready && state.canEdit,
    roomEditAccessReady: current && state.ready,
    roomEditAccessError: current ? state.error : null,
    refreshRoomEditAccess: refresh,
  };
}
