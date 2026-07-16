import { useState, useEffect, useCallback, useRef } from 'react';
import { AppState } from 'react-native';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import { useClassroom } from './useClassroom';

/**
 * Returns total unread message count for the current user.
 * Uses read_at column — messages from others where read_at is null.
 * Auto-refreshes via realtime, polling, and app state changes.
 */
export function useUnreadMessages() {
  const { profile } = useAuth();
  const { active } = useClassroom();
  const [count, setCount] = useState(0);
  const intervalRef = useRef(null);

  const refresh = useCallback(async () => {
    if (!profile) { setCount(0); return; }

    try {
      if (profile.role === 'parent') {
        // Parent: count unread messages across all linked children
        const { data: links } = await supabase
          .from('parent_children')
          .select('child_id')
          .eq('parent_id', profile.id);

        if (!links?.length) { setCount(0); return; }

        const { count: unread } = await supabase
          .from('messages')
          .select('id', { count: 'exact', head: true })
          .in('child_id', links.map(l => l.child_id))
          .neq('sender_id', profile.id)
          .is('read_at', null);

        setCount(unread || 0);
      } else {
        // Educator/Admin: count unread messages for active classroom's children
        const classroomId = active?.id || profile?.classroom_id;
        if (!classroomId) { setCount(0); return; }

        const { data: children } = await supabase
          .from('children')
          .select('id')
          .eq('classroom_id', classroomId)
          .is('archived_at', null);

        if (!children?.length) { setCount(0); return; }

        const { count: unread } = await supabase
          .from('messages')
          .select('id', { count: 'exact', head: true })
          .in('child_id', children.map(c => c.id))
          .neq('sender_id', profile.id)
          .is('read_at', null);

        setCount(unread || 0);
      }
    } catch (e) {
      // Silently fail — badge is non-critical
    }
  }, [profile?.id, profile?.role, active?.id, profile?.classroom_id]);

  useEffect(() => {
    refresh();

    if (!profile) return;

    // Poll every 30 seconds as a fallback
    intervalRef.current = setInterval(refresh, 30000);

    // Refresh when app comes to foreground
    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });

    // Listen for new/updated messages via realtime
    const channel = supabase
      .channel('unread-badge')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
      }, () => setTimeout(refresh, 500))
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'messages',
      }, () => setTimeout(refresh, 500))
      .subscribe();

    return () => {
      clearInterval(intervalRef.current);
      appStateSub.remove();
      supabase.removeChannel(channel);
    };
  }, [refresh]);

  return { unreadCount: count, refresh };
}


