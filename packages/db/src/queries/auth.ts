import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types.gen';

type Client = SupabaseClient<Database>;

export interface StaffInvitePreview {
  email: string;
  full_name: string | null;
  role: string;
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

export async function acceptStaffInvite(client: Client, code: string): Promise<void> {
  const { error } = await client.rpc('accept_staff_invite', { p_code: code });
  if (error) throw error;
}

// Creates the center and promotes the caller to owner_admin (10e).
export async function startCenter(client: Client, centerName: string): Promise<string> {
  const { data, error } = await client.rpc('start_center', { p_center_name: centerName });
  if (error) throw error;
  return data;
}
