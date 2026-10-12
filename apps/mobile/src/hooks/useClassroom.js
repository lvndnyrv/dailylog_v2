import { createContext, useContext, useState, useEffect } from 'react';
import { isAdminRole } from '@dailylog/shared';
import { AppState } from 'react-native';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';

const ClassroomContext = createContext({});

export function ClassroomProvider({ children }) {
  const { profile, user, fetchProfile } = useAuth();
  const [classrooms, setClassrooms]     = useState([]);
  const [active, setActive]             = useState(null);
  const [loading, setLoading]           = useState(true);

  useEffect(() => {
    if (profile?.role === 'educator' && profile?.daycare_id) {
      loadClassrooms();
    } else if (isAdminRole(profile?.role) && profile?.daycare_id) {
      loadAllClassrooms();
    } else {
      setClassrooms([]);
      setActive(null);
      setLoading(false);
    }
  }, [profile?.id, profile?.role, profile?.daycare_id]);

  useEffect(() => {
    if (profile?.role !== 'educator' || !profile?.daycare_id) return undefined;
    const refreshCoverage = () => loadClassrooms({ quiet: true });
    const channel = supabase
      .channel(`educator-room-coverage:${profile.id}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'room_coverage_assignments',
      }, refreshCoverage)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'room_combinations',
      }, refreshCoverage)
      .subscribe();
    const poll = setInterval(refreshCoverage, 60_000);
    const appState = AppState.addEventListener('change', state => {
      if (state === 'active') refreshCoverage();
    });
    return () => {
      clearInterval(poll);
      appState.remove();
      supabase.removeChannel(channel);
    };
  }, [profile?.id, profile?.role, profile?.daycare_id]);

  // Admins see every classroom in the daycare (no junction membership needed)
  async function loadAllClassrooms() {
    setLoading(true);
    const { data } = await supabase.rpc('get_my_operational_classrooms');
    const rooms = data || [];
    setClassrooms(rooms);
    setActive(rooms.find(r => r.id === profile.classroom_id) || rooms[0] || null);
    setLoading(false);
  }

  async function loadClassrooms({ quiet = false } = {}) {
    if (!quiet) setLoading(true);

    const { data, error } = await supabase.rpc('get_my_operational_classrooms');
    if (error) {
      if (!quiet) setLoading(false);
      return;
    }
    const rooms = data || [];
    setClassrooms(rooms);
    setActive(current => rooms.find(room => room.id === current?.id)
      || rooms.find(room => room.id === profile.classroom_id) || rooms[0] || null);
    if (!quiet) setLoading(false);
  }

  async function switchClassroom(classroomId) {
    const room = classrooms.find(c => c.id === classroomId);
    if (!room) return;

    setActive(room);

    // Visiting a combined/coverage room must never make it a permanent home room.
    if (room.temporary) return;

    // Update profile's active classroom
    await supabase
      .from('profiles')
      .update({ classroom_id: classroomId })
      .eq('id', profile.id);

    // Keep profile.classroom_id in sync without showing the app-level auth
    // loading gate. A full refresh unmounts the navigator and would send the
    // user back to their role's initial tab after every classroom switch.
    if (user) await fetchProfile(user.id, { silent: true });
  }

  async function joinClassroom(classroomId) {
    await supabase
      .from('educator_classrooms')
      .upsert({ educator_id: profile.id, classroom_id: classroomId }, { onConflict: 'educator_id,classroom_id' });
    await switchClassroom(classroomId);
    await loadClassrooms();
  }

  async function createAndJoinClassroom(name, ageGroup) {
    const { data: newRoom, error } = await supabase
      .from('classrooms')
      .insert({
        daycare_id: profile.daycare_id,
        name,
        age_group: ageGroup || null,
      })
      .select()
      .single();

    if (error) return { error };

    await supabase
      .from('educator_classrooms')
      .insert({ educator_id: profile.id, classroom_id: newRoom.id });

    await switchClassroom(newRoom.id);
    await loadClassrooms();
    return { data: newRoom };
  }

  async function leaveClassroom(classroomId) {
    await supabase
      .from('educator_classrooms')
      .delete()
      .eq('educator_id', profile.id)
      .eq('classroom_id', classroomId);

    // If leaving the active classroom, switch to another
    if (active?.id === classroomId) {
      const remaining = classrooms.filter(c => c.id !== classroomId);
      if (remaining.length) {
        await switchClassroom(remaining[0].id);
      }
    }

    await loadClassrooms();
  }

  return (
    <ClassroomContext.Provider value={{
      classrooms,
      active,
      loading,
      switchClassroom,
      joinClassroom,
      createAndJoinClassroom,
      leaveClassroom,
      reload: isAdminRole(profile?.role) ? loadAllClassrooms : loadClassrooms,
    }}>
      {children}
    </ClassroomContext.Provider>
  );
}

export const useClassroom = () => useContext(ClassroomContext);
