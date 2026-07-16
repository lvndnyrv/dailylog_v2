import { createContext, useContext, useState, useEffect } from 'react';
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
    } else if (profile?.role === 'admin' && profile?.daycare_id) {
      loadAllClassrooms();
    } else {
      setLoading(false);
    }
  }, [profile?.id]);

  // Admins see every classroom in the daycare (no junction membership needed)
  async function loadAllClassrooms() {
    setLoading(true);
    const { data } = await supabase
      .from('classrooms')
      .select('id, name, age_group')
      .eq('daycare_id', profile.daycare_id)
      .order('name');
    const rooms = data || [];
    setClassrooms(rooms);
    setActive(rooms.find(r => r.id === profile.classroom_id) || rooms[0] || null);
    setLoading(false);
  }

  async function loadClassrooms() {
    setLoading(true);

    // Get all classrooms this educator belongs to
    const { data: links } = await supabase
      .from('educator_classrooms')
      .select('classroom:classrooms(id, name, age_group)')
      .eq('educator_id', profile.id);

    const rooms = (links || []).map(l => l.classroom).filter(Boolean);

    // If no junction entries yet but profile has classroom_id, use that
    if (!rooms.length && profile.classroom_id) {
      const { data: fallback } = await supabase
        .from('classrooms')
        .select('id, name, age_group')
        .eq('id', profile.classroom_id)
        .single();
      if (fallback) rooms.push(fallback);
    }

    setClassrooms(rooms);

    // Set active to profile's current classroom, or first available
    const current = rooms.find(r => r.id === profile.classroom_id);
    setActive(current || rooms[0] || null);
    setLoading(false);
  }

  async function switchClassroom(classroomId) {
    const room = classrooms.find(c => c.id === classroomId);
    if (!room) return;

    setActive(room);

    // Update profile's active classroom
    await supabase
      .from('profiles')
      .update({ classroom_id: classroomId })
      .eq('id', profile.id);

    // Refresh profile in auth context
    if (user) await fetchProfile(user.id);
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
      reload: profile?.role === 'admin' ? loadAllClassrooms : loadClassrooms,
    }}>
      {children}
    </ClassroomContext.Provider>
  );
}

export const useClassroom = () => useContext(ClassroomContext);
