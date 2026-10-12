import { supabase } from '../lib/supabase';

function unwrap(result) {
  if (result.error) throw result.error;
  return result.data;
}

export async function getChildConsents(childId) {
  return unwrap(await supabase.rpc('get_mobile_child_consents', {
    p_child_id: childId,
  }));
}

export async function getClassroomConsents(classroomId) {
  return unwrap(await supabase.rpc('get_mobile_classroom_consents', {
    p_classroom_id: classroomId,
  }));
}

export async function getPhotoConsentStatuses(childIds) {
  return unwrap(await supabase.rpc('get_mobile_children_photo_consent', {
    p_child_ids: childIds,
  }));
}

export async function setParentConsent(childId, kind, granted) {
  return unwrap(await supabase.rpc('set_mobile_parent_consent', {
    p_child_id: childId,
    p_kind: kind,
    p_granted: granted,
  }));
}

export async function sendEventRsvp(announcementId, response, guests, childId = null) {
  return unwrap(await supabase.rpc('send_mobile_event_rsvp', {
    p_announcement_id: announcementId,
    p_response: response,
    p_guests: guests,
    p_child_id: childId,
  }));
}

export async function getEventRsvpSummary(announcementId) {
  return unwrap(await supabase.rpc('get_mobile_event_rsvp_summary', {
    p_announcement_id: announcementId,
  }));
}

export async function remindEventNonresponders(announcementId) {
  return unwrap(await supabase.rpc('remind_mobile_event_nonresponders', {
    p_announcement_id: announcementId,
  }));
}
