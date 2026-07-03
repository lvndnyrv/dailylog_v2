import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

const AuthContext = createContext({});

const VALID_ROLES = ['educator', 'parent', 'admin'];

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [recovery, setRecovery] = useState(false); // password-recovery deep link in progress

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      if (session?.user) fetchProfile(session.user.id);
      else setLoading(false);
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
      setUser(session?.user ?? null);
      if (session?.user) fetchProfile(session.user.id);
      else {
        setProfile(null);
        setRecovery(false);
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // Fallback used when the DB trigger hasn't created a profile yet
  // (e.g. OTP-invited parents on an un-migrated database).
  async function ensureProfileFromMetadata() {
    const { data: userRes } = await supabase.auth.getUser();
    const u = userRes?.user;
    if (!u) return null;

    const meta = u.user_metadata || {};
    const role = VALID_ROLES.includes(meta.role) ? meta.role : 'parent';

    await supabase.from('profiles').upsert(
      {
        id: u.id,
        email: u.email,
        full_name: meta.full_name?.trim() || u.email?.split('@')[0] || 'User',
        role,
        phone: meta.phone || '',
      },
      { onConflict: 'id', ignoreDuplicates: true }
    );

    // Process a pending child link from an educator invite
    if (meta.pending_child_id && role === 'parent') {
      await supabase.from('parent_children').upsert(
        { parent_id: u.id, child_id: meta.pending_child_id },
        { onConflict: 'parent_id,child_id', ignoreDuplicates: true }
      );
    }

    const { data } = await supabase.from('profiles').select('*').eq('id', u.id).maybeSingle();
    return data;
  }

  async function fetchProfile(userId) {
    let { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (!data) {
      data = await ensureProfileFromMetadata();
    }

    setProfile(data ?? null);
    setLoading(false);
  }

  async function signIn(email, password) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error };
  }

  async function signUp(email, password, fullName, role, phone = '') {
    // Metadata is consumed by the handle_new_user DB trigger, which
    // creates the profile server-side (works even when email
    // confirmation is enabled and there is no session yet).
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName, role, phone } },
    });
    if (error) return { error };

    // If we already have a session, make sure the profile exists now
    // (covers databases where the trigger migration hasn't run).
    if (data?.session && data?.user) {
      await fetchProfile(data.user.id);
    }
    return { error: null };
  }

  async function resetPassword(email) {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: 'dailylog://auth',
    });
    return { error };
  }

  async function updatePassword(newPassword) {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (!error) setRecovery(false);
    return { error };
  }

  function clearRecovery() {
    setRecovery(false);
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  async function deleteAccount() {
    const { error } = await supabase.rpc('delete_my_account');
    await supabase.auth.signOut();
    return { error };
  }

  return (
    <AuthContext.Provider
      value={{
        user, profile, loading, recovery,
        signIn, signUp, signOut, deleteAccount, fetchProfile,
        resetPassword, updatePassword, clearRecovery,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
