import { useState, useEffect, useCallback, useRef } from 'react';
import { AppState } from 'react-native';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import { useClassroom } from './useClassroom';

/**
 * Returns total unread message count for the current user.
 * Uses recipient-specific read receipts so one guardian or staff member cannot
 * clear another person's badge.
 * Auto-refreshes via realtime, polling, and app state changes.
 */
export function useUnreadMessages() {
  const { profile } = useAuth();
  const { active } = useClassroom();
  const roomKey = (active?.member_room_ids?.length ? active.member_room_ids : active?.id ? [active.id] : []).join(',');
  const [count, setCount] = useState(0);
  const intervalRef = useRef(null);
  const requestId = useRef(0);

  const refresh = useCallback(async () => {
    const currentRequest = ++requestId.current;
    if (!profile) { setCount(0); return; }

    try {
      if (profile.role === 'parent') {
        // Parent: count unread messages across all linked children
        const { data: links } = await supabase
          .from('parent_children')
          .select('child_id')
          .eq('parent_id', profile.id);

        if (currentRequest !== requestId.current) return;
        if (!links?.length) { setCount(0); return; }

        const { data: unreadRows, error } = await supabase.rpc(
          'get_unread_child_message_counts',
          { p_child_ids: links.map((link) => link.child_id) },
        );
        if (error) throw error;
        if (currentRequest !== requestId.current) return;
        setCount((unreadRows || []).reduce(
          (total, row) => total + Number(row.unread_count || 0),
          0,
        ));
      } else {
        // Staff: count the active operating group, including a temporary partner room.
        const classroomId = active?.id || profile?.classroom_id;
        if (!classroomId) { setCount(0); return; }
        const roomIds = roomKey ? roomKey.split(',') : [classroomId];

        const { data: children } = await supabase
          .from('children')
          .select('id')
          .in('classroom_id', roomIds)
          .is('archived_at', null);

        if (currentRequest !== requestId.current) return;
        if (!children?.length) { setCount(0); return; }

        const { data: unreadRows, error } = await supabase.rpc(
          'get_unread_child_message_counts',
          { p_child_ids: children.map((child) => child.id) },
        );
        if (error) throw error;
        if (currentRequest !== requestId.current) return;
        setCount((unreadRows || []).reduce(
          (total, row) => total + Number(row.unread_count || 0),
          0,
        ));
      }
    } catch (e) {
      // Silently fail — badge is non-critical
    }
  }, [profile?.id, profile?.role, active?.id, profile?.classroom_id, roomKey]);

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
    // A unique channel is required because React Strict Mode may mount the
    // effect again before removeChannel has finished closing the old channel.
    // Reusing the subscribed name makes supabase-js reject additional `.on()`
    // callbacks during fast refresh and foreground transitions.
    const channel = supabase
      .channel(`unread-badge:${profile.id}:${Date.now()}:${Math.random().toString(36).slice(2)}`)
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
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'message_reads',
      }, () => setTimeout(refresh, 250))
      .subscribe();

    return () => {
      requestId.current += 1;
      clearInterval(intervalRef.current);
      appStateSub.remove();
      supabase.removeChannel(channel);
    };
  }, [refresh]);

  return { unreadCount: count, refresh };
}
