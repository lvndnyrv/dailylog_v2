import { supabase } from './supabase';

export async function listLocalizedAnnouncements(limit = 50) {
  const { data, error } = await supabase.rpc('get_my_localized_announcements', {
    p_limit: limit,
    p_announcement_id: null,
  });
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export async function getLocalizedAnnouncement(announcementId) {
  if (!announcementId) return null;
  const { data, error } = await supabase.rpc('get_my_localized_announcements', {
    p_limit: 1,
    p_announcement_id: announcementId,
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] || null : null;
}

export async function savePreferredLanguage(languageCode) {
  const { data, error } = await supabase.rpc('set_my_preferred_language', {
    p_language: languageCode,
  });
  if (error) throw error;
  return data;
}
