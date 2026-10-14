import { createContext, useContext, useState, useEffect, useRef } from 'react';
import { isAdminRole } from '@dailylog/shared';
import { AppState } from 'react-native';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import { showToast } from '../components/Toast';

const ClassroomContext = createContext({});

export function ClassroomProvider({ children }) {
  const { profile, user, fetchProfile } = useAuth();
  const [classrooms, setClassrooms]     = useState([]);
  const [active, setActive]             = useState(null);
  const [loading, setLoading]           = useState(true);
  const [loadedScope, setLoadedScope]   = useState(null);
  const loadVersion = useRef(0);
  const scope = `${profile?.id || ''}:${profile?.role || ''}:${profile?.daycare_id || ''}`;
  const currentScope = useRef(scope);
  currentScope.current = scope;

  useEffect(() => {
    if (profile?.role === 'educator' && profile?.daycare_id) {
      loadClassrooms();
    } else if (isAdminRole(profile?.role) && profile?.daycare_id) {
      loadAllClassrooms();
    } else {
      loadVersion.current += 1;
      setClassrooms([]);
      setActive(null);
      setLoadedScope(null);
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
    const version = ++loadVersion.current;
    const requestedScope = scope;
    setLoading(true);
    const { data, error } = await supabase.rpc('get_my_operational_classrooms');
    if (version !== loadVersion.current || requestedScope !== currentScope.current) return;
    if (error) { setLoading(false); return; }
    const rooms = data || [];
    setClassrooms(rooms);
    setActive(current => rooms.find(r => r.id === current?.id)
      || rooms.find(r => r.id === profile.classroom_id) || rooms[0] || null);
    setLoadedScope(requestedScope);
    setLoading(false);
  }

  async function loadClassrooms({ quiet = false } = {}) {
    const version = ++loadVersion.current;
    const requestedScope = scope;
    if (!quiet) setLoading(true);

    const { data, error } = await supabase.rpc('get_my_operational_classrooms');
    if (version !== loadVersion.current || requestedScope !== currentScope.current) return;
    if (error) {
      if (!quiet) setLoading(false);
      return;
    }
    const rooms = data || [];
    setClassrooms(rooms);
    setActive(current => rooms.find(room => room.id === current?.id)
      || rooms.find(room => room.id === profile.classroom_id) || rooms[0] || null);
    setLoadedScope(requestedScope);
    if (!quiet) setLoading(false);
  }

  async function switchClassroom(classroomId) {
    const room = classrooms.find(c => c.id === classroomId);
    if (!room) return false;
    const requestedScope = scope;

    // Visiting a combined/coverage room must never make it a permanent home room.
    // Admin room browsing is also a local view, not a staff-room assignment.
    if (room.temporary || isAdminRole(profile?.role)) {
      setActive(room);
      return true;
    }

    // Educators can persist only an administrator-assigned permanent room.
    // Do not show a new active room if that guarded update was rejected.
    const { data, error } = await supabase
      .from('profiles')
      .update({ classroom_id: classroomId })
      .eq('id', profile.id)
      .select('id')
      .maybeSingle();
    if (requestedScope !== currentScope.current) return false;
    if (error || !data) {
      showToast(error?.message || 'Could not switch classrooms. Please try again.', 'error');
      return false;
    }
    setActive(room);

    // Keep profile.classroom_id in sync without showing the app-level auth
    // loading gate. A full refresh unmounts the navigator and would send the
    // user back to their role's initial tab after every classroom switch.
    if (user) await fetchProfile(user.id, { silent: true });
    return true;
  }

  return (
    <ClassroomContext.Provider value={{
      classrooms: loadedScope === scope ? classrooms : [],
      active: loadedScope === scope ? active : null,
      loading,
      switchClassroom,
      reload: isAdminRole(profile?.role) ? loadAllClassrooms : loadClassrooms,
    }}>
      {children}
    </ClassroomContext.Provider>
  );
}

export const useClassroom = () => useContext(ClassroomContext);
