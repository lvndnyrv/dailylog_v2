import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types.gen';

type Client = SupabaseClient<Database>;

export interface StaffInvitePreview {
  email: string;
  full_name: string | null;
  role: string;
  job_title: string | null;
  require_background_check: boolean;
  daycare_name: string;
  classroom_name: string | null;
  invited_by_name: string | null;
  expires_at: string | null;
}

// Invite preview for the accept-invite card (10d). Anon-callable; returns null
// for invalid/expired/used codes.
export async function getStaffInvite(
  client: Client,
  code: string,
): Promise<StaffInvitePreview | null> {
  const { data, error } = await client.rpc('get_staff_invite', { p_code: code });
  if (error) throw error;
  return data?.[0] ?? null;
}

export const STAFF_TERMS_VERSION = '2026-08-08';

export async function acceptStaffInvite(
  client: Client,
  code: string,
  termsAccepted: boolean,
): Promise<void> {
  const { error } = await client.rpc('accept_staff_invite', {
    p_code: code,
    p_terms_version: STAFF_TERMS_VERSION,
    p_terms_accepted: termsAccepted,
  });
  if (error) throw error;
}

export interface CenterRegistrationPreview {
  center_name: string;
  expires_at: string;
}

// Public preflight only. The code remains unconsumed until the authenticated,
// guarded center-setup RPC succeeds.
export async function checkCenterRegistrationCode(
  client: Client,
  code: string,
  email: string,
): Promise<CenterRegistrationPreview | null> {
  const { data, error } = await client.rpc('check_center_registration_code', {
    p_code: code,
    p_email: email,
  });
  if (error) throw error;
  return data?.[0] ?? null;
}

export async function completeCenterSetup(
  client: Client,
  values: {
    centerName: string;
    address: string;
    phone: string;
    registrationCode: string;
  },
): Promise<void> {
  const { error } = await client.rpc('complete_center_setup', {
    p_center_name: values.centerName,
    p_address: values.address,
    p_phone: values.phone,
    p_classrooms: [],
    p_educator_emails: [],
    p_registration_code: values.registrationCode,
  });
  if (error) throw error;
}
