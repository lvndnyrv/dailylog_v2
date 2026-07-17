import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types.gen';
import type { TablesUpdate } from '../types';

type Client = SupabaseClient<Database>;

// Certifications live as jsonb on staff_members; expiry logic is Phase 5 —
// Phase 1 stores and shows the fields (PHASE_1 Module D).
export interface Certification {
  item: string;
  issuer: string | null;
  issued: string | null;
  expires_on: string | null;
}

export interface StaffRow {
  id: string;
  job_title: string | null;
  employment_type: string | null;
  started_on: string | null;
  certifications: Certification[];
  status: string;
  profile: {
    id: string;
    full_name: string;
    email: string;
    phone: string | null;
    role: string;
    classroom: { id: string; name: string } | null;
  } | null;
}

// classrooms must be pinned to the direct FK — profiles also reaches
// classrooms through educator_classrooms, and PostgREST refuses the ambiguity.
const STAFF_SELECT = `id, job_title, employment_type, started_on, certifications, status,
  profile:profiles(id, full_name, email, phone, role,
    classroom:classrooms!profiles_classroom_id_fkey(id, name))`;

export async function listStaff(client: Client): Promise<StaffRow[]> {
  const { data, error } = await client
    .from('staff_members')
    .select(STAFF_SELECT)
    .is('archived_at', null)
    .neq('status', 'inactive');

  if (error) throw error;
  const rows = (data ?? []) as unknown as StaffRow[];
  return rows
    .filter((r) => r.profile)
    .sort((a, b) => (a.profile!.full_name < b.profile!.full_name ? -1 : 1));
}

export async function getStaffMember(client: Client, staffId: string): Promise<StaffRow> {
  const { data, error } = await client
    .from('staff_members')
    .select(STAFF_SELECT)
    .eq('id', staffId)
    .single();

  if (error) throw error;
  return data as unknown as StaffRow;
}

export interface PendingStaffInvite {
  id: string;
  email: string;
  role: string;
  code: string;
  job_title: string | null;
  require_background_check: boolean;
  expires_at: string | null;
  created_at: string | null;
  classroom: { id: string; name: string } | null;
}

export async function listPendingStaffInvites(client: Client): Promise<PendingStaffInvite[]> {
  const { data, error } = await client
    .from('staff_invites')
    .select(
      'id, email, role, code, job_title, require_background_check, expires_at, created_at, classroom:classrooms(id, name)',
    )
    .is('accepted_at', null)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data ?? []) as unknown as PendingStaffInvite[];
}

// invite_staff RPC (admins only, enforced in the function) returns the code.
export async function inviteStaff(
  client: Client,
  values: {
    email: string;
    role: string;
    classroomId?: string | null;
    fullName?: string | null;
    jobTitle?: string | null;
    requireBackgroundCheck?: boolean;
  },
): Promise<string> {
  const { data, error } = await client.rpc('invite_staff', {
    p_email: values.email,
    p_role: values.role,
    p_classroom_id: values.classroomId ?? null,
    p_full_name: values.fullName ?? null,
    p_job_title: values.jobTitle ?? null,
    p_require_background_check: values.requireBackgroundCheck ?? false,
  });
  if (error) throw error;
  return data;
}

export async function revokeStaffInvite(client: Client, inviteId: string): Promise<void> {
  const { error } = await client.from('staff_invites').delete().eq('id', inviteId);
  if (error) throw error;
}

export async function updateStaffMember(
  client: Client,
  staffId: string,
  values: TablesUpdate<'staff_members'>,
): Promise<void> {
  const { error } = await client.from('staff_members').update(values).eq('id', staffId);
  if (error) throw error;
}
