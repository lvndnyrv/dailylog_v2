import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types.gen';
import type { Tables, TablesInsert } from '../types';

type Client = SupabaseClient<Database>;

export type Enrollment = Tables<'enrollments'>;

export async function listEnrollments(client: Client): Promise<Enrollment[]> {
  const { data, error } = await client
    .from('enrollments')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function createEnrollment(
  client: Client,
  values: TablesInsert<'enrollments'>,
): Promise<void> {
  const { error } = await client.from('enrollments').insert(values);
  if (error) throw error;
}

export async function setEnrollmentStage(
  client: Client,
  enrollmentId: string,
  stage: string,
): Promise<void> {
  const { error } = await client
    .from('enrollments')
    .update({ stage, stage_changed_at: new Date().toISOString() })
    .eq('id', enrollmentId);
  if (error) throw error;
}

// Enrolling creates the child record atomically and closes the pipeline card.
export async function enrollFromPipeline(
  client: Client,
  enrollmentId: string,
  classroomId: string,
  lastName?: string,
): Promise<string> {
  const { data, error } = await client.rpc('enroll_from_pipeline', {
    p_enrollment_id: enrollmentId,
    p_classroom_id: classroomId,
    p_last_name: lastName ?? null,
  });
  if (error) throw error;
  return data;
}

// ── Public inquiry form (2g) — anon-callable ────────────────────────────────

export async function getPublicCenterInfo(client: Client, daycareId: string) {
  const { data, error } = await client.rpc('get_public_center_info', {
    p_daycare_id: daycareId,
  });
  if (error) throw error;
  return data?.[0] ?? null;
}

export async function submitEnrollmentInquiry(
  client: Client,
  values: {
    daycareId: string;
    guardianName: string;
    guardianEmail: string;
    guardianPhone?: string;
    childFirstName?: string;
    childDateOfBirth?: string;
    classroomId?: string;
    desiredStart?: string;
  },
): Promise<void> {
  const { error } = await client.rpc('submit_enrollment_inquiry', {
    p_daycare_id: values.daycareId,
    p_guardian_name: values.guardianName,
    p_guardian_email: values.guardianEmail,
    p_guardian_phone: values.guardianPhone ?? null,
    p_child_first_name: values.childFirstName ?? null,
    p_child_date_of_birth: values.childDateOfBirth ?? null,
    p_classroom_id: values.classroomId ?? null,
    p_desired_start: values.desiredStart ?? null,
  });
  if (error) throw error;
}

// ── Closures (11c) ──────────────────────────────────────────────────────────

export type Closure = Tables<'center_closures'>;

export async function listClosures(client: Client): Promise<Closure[]> {
  const { data, error } = await client
    .from('center_closures')
    .select('*')
    .order('starts_on');
  if (error) throw error;
  return data ?? [];
}

export async function createClosure(
  client: Client,
  values: TablesInsert<'center_closures'>,
): Promise<void> {
  const { error } = await client.from('center_closures').insert(values);
  if (error) throw error;
}

export async function deleteClosure(client: Client, closureId: string): Promise<void> {
  const { error } = await client.from('center_closures').delete().eq('id', closureId);
  if (error) throw error;
}
