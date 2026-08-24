import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from './useAuth';
import { supabase } from '../lib/supabase';

const ParentFamilyContext = createContext(null);
const SELECTED_CHILD_KEY_PREFIX = '@dailylog/parent-selected-child';

function selectedChildStorageKey(profileId) {
  return `${SELECTED_CHILD_KEY_PREFIX}:${profileId}`;
}

export function ParentFamilyProvider({ children: content }) {
  const { profile } = useAuth();
  const [links, setLinks] = useState([]);
  const [selectedChildId, setSelectedChildId] = useState(null);
  const selectedChildIdRef = useRef(null);
  const [hydratedProfileId, setHydratedProfileId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const refresh = useCallback(async ({ silent = false, preferredChildId = null } = {}) => {
    if (!profile?.id || profile.role !== 'parent') {
      setLinks([]);
      setSelectedChildId(null);
      selectedChildIdRef.current = null;
      setLoading(false);
      setRefreshing(false);
      return [];
    }

    if (silent) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const { data, error: queryError } = await supabase
        .from('parent_children')
        .select(`
          consent_given_at,
          consent_declined_at,
          consent_version,
          child:children(
            *,
            classroom:classrooms(id, name, age_group)
          )
        `)
        .eq('parent_id', profile.id);

      if (queryError) throw queryError;

      const activeLinks = (data || []).filter((link) => (
        link.child && !link.child.archived_at
      ));
      setLinks(activeLinks);
      const availableIds = new Set(activeLinks.map((link) => link.child.id));
      const requestedId = preferredChildId || selectedChildIdRef.current;
      const nextChildId = requestedId && availableIds.has(requestedId)
        ? requestedId
        : activeLinks[0]?.child?.id || null;
      selectedChildIdRef.current = nextChildId;
      setSelectedChildId(nextChildId);
      if (nextChildId) {
        AsyncStorage.setItem(selectedChildStorageKey(profile.id), nextChildId).catch(() => {});
      } else {
        AsyncStorage.removeItem(selectedChildStorageKey(profile.id)).catch(() => {});
      }
      return activeLinks;
    } catch (loadError) {
      setError(loadError.message || 'We could not load your linked children.');
      throw loadError;
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [profile?.id, profile?.role]);

  useEffect(() => {
    let active = true;
    setLinks([]);
    setSelectedChildId(null);
    selectedChildIdRef.current = null;

    if (!profile?.id || profile.role !== 'parent') {
      setLoading(false);
      setRefreshing(false);
      setHydratedProfileId(null);
      return () => { active = false; };
    }

    setLoading(true);
    async function hydrate() {
      let savedChildId = null;
      try {
        savedChildId = await AsyncStorage.getItem(selectedChildStorageKey(profile.id));
      } catch {
        // Family loading remains available if local preference storage is unavailable.
      }
      if (!active) return;
      selectedChildIdRef.current = savedChildId;
      setSelectedChildId(savedChildId);
      try {
        await refresh({ preferredChildId: savedChildId });
      } catch {
        // The provider exposes the query error and lets its screens offer retry.
      } finally {
        if (active) setHydratedProfileId(profile.id);
      }
    }
    hydrate();

    return () => { active = false; };
  }, [profile?.id, profile?.role, refresh]);

  useEffect(() => {
    if (!profile?.id || profile.role !== 'parent') return undefined;

    const channel = supabase
      .channel(`parent-family:${profile.id}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'parent_children',
        filter: `parent_id=eq.${profile.id}`,
      }, () => refresh({ silent: true }).catch(() => {}))
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, [profile?.id, profile?.role, refresh]);

  const children = useMemo(
    () => links.map((link) => link.child).filter(Boolean),
    [links],
  );
  const selectedChild = useMemo(
    () => children.find((child) => child.id === selectedChildId) || children[0] || null,
    [children, selectedChildId],
  );
  const pendingConsentChild = useMemo(
    () => links.find((link) => !link.consent_given_at)?.child || null,
    [links],
  );

  const selectChild = useCallback((childOrId) => {
    const id = typeof childOrId === 'string' ? childOrId : childOrId?.id;
    if (!id || !links.some((link) => link.child?.id === id)) return false;
    selectedChildIdRef.current = id;
    setSelectedChildId(id);
    if (profile?.id) {
      AsyncStorage.setItem(selectedChildStorageKey(profile.id), id).catch(() => {});
    }
    return true;
  }, [links, profile?.id]);

  const value = useMemo(() => ({
    links,
    children,
    selectedChild,
    selectedChildId: selectedChild?.id || null,
    pendingConsentChild,
    loading: profile?.role === 'parent' && hydratedProfileId !== profile?.id
      ? true
      : loading,
    refreshing,
    error,
    hydratedProfileId,
    refresh,
    selectChild,
  }), [
    children,
    error,
    links,
    loading,
    pendingConsentChild,
    refresh,
    refreshing,
    selectChild,
    selectedChild,
    hydratedProfileId,
    profile?.id,
    profile?.role,
  ]);

  return (
    <ParentFamilyContext.Provider value={value}>
      {content}
    </ParentFamilyContext.Provider>
  );
}

export function useParentFamily() {
  const context = useContext(ParentFamilyContext);
  if (!context) {
    throw new Error('useParentFamily must be used inside ParentFamilyProvider.');
  }
  return context;
}
