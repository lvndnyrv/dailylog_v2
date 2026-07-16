import React, { createContext, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';

const AuthContext = createContext({});

const VALID_ROLES = ['educator', 'parent', 'admin'];

// Remembered account (last successful sign-in) — survives logout on purpose,
// so returning users only need to enter their password.
const REMEMBERED_EMAIL_KEY = 'dailylog_remembered_email';
const REMEMBERED_NAME_KEY = 'dailylog_remembered_name';

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [recovery, setRecovery] = useState(false);
  const [profileFailed, setProfileFailed] = useState(false); // true only after confirmed failure

  useEffect(() => {
    let isMounted = true;
    let fetchingProfile = false;

    async function handleSession(session) {
      if (!session?.user) {
        if (isMounted) {
          setUser(null);
          setProfile(null);
          setProfileFailed(false);
          setLoading(false);
        }
        return;
      }

      if (isMounted) {
        setUser(session.user);
        setLoading(true);
        setProfileFailed(false);
      }

      // Prevent duplicate fetches
      if (fetchingProfile) return;
      fetchingProfile = true;

      let data = null;
      try {
        const res = await supabase
          .from('profiles')
          .select('*')
          .eq('id', session.user.id)
          .maybeSingle();
        data = res.data;

        if (!data) {
          data = await ensureProfileFromMetadata();
        }
      } catch (e) {
        // Network error — don't show failure screen, retry later
      }

      fetchingProfile = false;
      // Remember this account (email + display name) for fast future sign-in.
      // Covers password logins AND magic-link/OTP invites.
      if (data && session.user.email) {
        saveRememberedAccount(session.user.email, data.full_name || '');
      }
      if (isMounted) {
        setProfile(data ?? null);
        setProfileFailed(!data);
        setLoading(false);
      }
    }

    // Listen for auth changes (includes INITIAL_SESSION)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
      if (event === 'SIGNED_OUT') {
        if (isMounted) {
          setUser(null);
          setProfile(null);
          setRecovery(false);
          setProfileFailed(false);
          setLoading(false);
        }
        return;
      }
      handleSession(session);
    });

    // Fallback: get initial session in case INITIAL_SESSION event doesn't fire
    supabase.auth.getSession().then(({ data: { session } }) => {
      handleSession(session);
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
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
    // Remember the account on successful login (name is refreshed once the
    // profile loads in handleSession).
    if (!error) {
      await saveRememberedAccount(email);
    }
    return { error };
  }

  async function saveRememberedAccount(email, name) {
    try {
      if (name !== undefined) {
        await AsyncStorage.multiSet([
          [REMEMBERED_EMAIL_KEY, email],
          [REMEMBERED_NAME_KEY, name || ''],
        ]);
      } else {
        // Email-only update: drop a stale name if the account changed.
        const prevEmail = await AsyncStorage.getItem(REMEMBERED_EMAIL_KEY);
        if (prevEmail && prevEmail !== email) {
          await AsyncStorage.removeItem(REMEMBERED_NAME_KEY);
        }
        await AsyncStorage.setItem(REMEMBERED_EMAIL_KEY, email);
      }
    } catch (e) {
      console.warn('Failed to save remembered account:', e);
    }
  }

  async function getRememberedAccount() {
    try {
      const [[, email], [, name]] = await AsyncStorage.multiGet([
        REMEMBERED_EMAIL_KEY,
        REMEMBERED_NAME_KEY,
      ]);
      return email ? { email, name: name || '' } : null;
    } catch (e) {
      console.warn('Failed to get remembered account:', e);
      return null;
    }
  }

  async function clearRememberedAccount() {
    try {
      await AsyncStorage.multiRemove([REMEMBERED_EMAIL_KEY, REMEMBERED_NAME_KEY]);
    } catch (e) {
      console.warn('Failed to clear remembered account:', e);
    }
  }

  async function signUp(email, password, fullName, role, phone = '', activationCode = '') {
    // Metadata is consumed by the handle_new_user DB trigger, which
    // creates the profile server-side (works even when email
    // confirmation is enabled and there is no session yet).
    // role='admin' additionally requires a valid activation_code —
    // the trigger downgrades to 'parent' otherwise (server-enforced).
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
          role,
          phone,
          ...(activationCode ? { activation_code: activationCode } : {}),
        },
      },
    });
    if (error) return { error };

    // If we already have a session, make sure the profile exists now
    // (covers databases where the trigger migration hasn't run).
    if (data?.session && data?.user) {
      await fetchProfile(data.user.id);
      return { error: null, needsEmailConfirm: false };
    }
    // No session → Supabase email confirmation is enabled;
    // the user must click the link in their inbox before signing in.
    return { error: null, needsEmailConfirm: true };
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
    // Intentionally KEEP the remembered account: after logging out, the user
    // should see their email on the login screen and only type the password.
    await supabase.auth.signOut();
  }

  async function deleteAccount() {
    const { error } = await supabase.rpc('delete_my_account');
    // The account no longer exists — don't suggest it at next login.
    await clearRememberedAccount();
    await supabase.auth.signOut();
    return { error };
  }

  return (
    <AuthContext.Provider
      value={{
        user, profile, loading, recovery, profileFailed,
        signIn, signUp, signOut, deleteAccount, fetchProfile,
        resetPassword, updatePassword, clearRecovery,
        getRememberedAccount, clearRememberedAccount,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
