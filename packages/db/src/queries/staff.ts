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
  credential_number?: string | null;
  document_id?: string | null;
  required?: boolean;
  ratio_qualifying?: boolean;
  missing?: boolean;
}

export interface StaffCredentialRow {
  id: string;
  name: string;
  issuer: string | null;
  completed_on: string | null;
  expires_on: string | null;
  credential_number: string | null;
  document_id: string | null;
  required: boolean;
  ratio_qualifying: boolean;
  archived_at: string | null;
}

export interface StaffCredentialSubmissionRow {
  id: string;
  credential_id: string;
  status: string;
  issuer: string;
  completed_on: string;
  expires_on: string;
  credential_number: string | null;
  review_notes: string | null;
  reviewed_at: string | null;
  created_at: string;
  credential: { id: string; name: string } | null;
  document: {
    id: string;
    title: string;
    storage_path: string;
    mime_type: string | null;
    size_bytes: number | null;
  } | null;
  submitter: { id: string; full_name: string } | null;
  reviewer: { id: string; full_name: string } | null;
}

export interface StaffRow {
  id: string;
  job_title: string | null;
  employment_type: string | null;
  started_on: string | null;
  background_check_required: boolean;
  certifications: Certification[];
  credentials: StaffCredentialRow[];
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

export interface StaffRegularScheduleRow {
  id: string;
  weekday: number;
  starts_local: string;
  ends_local: string;
  unpaid_break_minutes: number;
  classroom: { id: string; name: string } | null;
}

// classrooms must be pinned to the direct FK — profiles also reaches
// classrooms through educator_classrooms, and PostgREST refuses the ambiguity.
const STAFF_SELECT = `id, job_title, employment_type, started_on, certifications, status, background_check_required,
  credentials:staff_credentials(id, name, issuer, completed_on, expires_on,
    credential_number, document_id, required, ratio_qualifying, archived_at),
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
    .map(withNormalizedCredentials)
    .sort((a, b) => (a.profile!.full_name < b.profile!.full_name ? -1 : 1));
}

export async function getStaffMember(client: Client, staffId: string): Promise<StaffRow> {
  const { data, error } = await client
    .from('staff_members')
    .select(STAFF_SELECT)
    .eq('id', staffId)
    .single();

  if (error) throw error;
  return withNormalizedCredentials(data as unknown as StaffRow);
}

export async function listStaffRegularSchedule(
  client: Client,
  staffId: string,
): Promise<StaffRegularScheduleRow[]> {
  const { data, error } = await client
    .from('staff_regular_schedules')
    .select('id, weekday, starts_local, ends_local, unpaid_break_minutes, classroom:classrooms(id, name)')
    .eq('staff_member_id', staffId)
    .order('weekday');

  if (error) throw error;
  return (data ?? []) as unknown as StaffRegularScheduleRow[];
}

function withNormalizedCredentials(row: StaffRow): StaffRow {
  const credentials = (row.credentials ?? []).filter((credential) => credential && !credential.archived_at);
  if (credentials.length === 0) return { ...row, credentials: [] };
  return {
    ...row,
    credentials,
    certifications: credentials.map((credential) => ({
      item: credential.name,
      issuer: credential.issuer,
      issued: credential.completed_on,
      expires_on: credential.expires_on,
      credential_number: credential.credential_number,
      document_id: credential.document_id,
      required: credential.required,
      ratio_qualifying: credential.ratio_qualifying,
      missing:
        credential.required &&
        (credential.completed_on == null || credential.document_id == null),
    })),
  };
}

export async function listStaffCredentialSubmissions(
  client: Client,
  staffId: string,
): Promise<StaffCredentialSubmissionRow[]> {
  const { data, error } = await client
    .from('staff_credential_submissions')
    .select(`id, credential_id, status, issuer, completed_on, expires_on,
      credential_number, review_notes, reviewed_at, created_at,
      credential:staff_credentials!staff_credential_submissions_credential_id_fkey(id, name),
      document:documents!staff_credential_submissions_document_id_fkey(
        id, title, storage_path, mime_type, size_bytes
      ),
      submitter:profiles!staff_credential_submissions_submitted_by_fkey(id, full_name),
      reviewer:profiles!staff_credential_submissions_reviewed_by_fkey(id, full_name)`)
    .eq('staff_member_id', staffId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data ?? []) as unknown as StaffCredentialSubmissionRow[];
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
    ...(values.classroomId != null ? { p_classroom_id: values.classroomId } : {}),
    ...(values.fullName != null ? { p_full_name: values.fullName } : {}),
    ...(values.jobTitle != null ? { p_job_title: values.jobTitle } : {}),
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

export type DelegationAccessLevel = 'specific_areas' | 'full_admin';

export interface StaffDelegationRow {
  id: string;
  delegate_profile_id: string;
  delegate_name: string;
  delegate_role: string;
  classroom_name: string | null;
  access_level: DelegationAccessLevel;
  areas: string[];
  starts_at: string;
  ends_at: string;
  granted_by_name: string;
  revoked_at: string | null;
  revoked_by_name: string | null;
  action_count: number;
}

export async function listStaffDelegations(client: Client): Promise<StaffDelegationRow[]> {
  const { data, error } = await client.rpc('get_staff_delegations');
  if (error) throw error;
  return (data ?? []) as unknown as StaffDelegationRow[];
}

export async function grantStaffDelegation(
  client: Client,
  values: {
    delegateProfileId: string;
    accessLevel: DelegationAccessLevel;
    areas: string[];
    endsAt: string;
  },
): Promise<string> {
  const { data, error } = await client.rpc('grant_staff_delegation', {
    p_delegate_profile_id: values.delegateProfileId,
    p_access_level: values.accessLevel,
    p_areas: values.areas,
    p_ends_at: values.endsAt,
  });
  if (error) throw error;
  return data;
}

export async function revokeStaffDelegation(
  client: Client,
  delegationId: string,
): Promise<void> {
  const { error } = await client.rpc('revoke_staff_delegation', {
    p_delegation_id: delegationId,
  });
  if (error) throw error;
}
