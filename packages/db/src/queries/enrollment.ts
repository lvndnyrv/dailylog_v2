import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types.gen';
import type { Json, Tables, TablesInsert, TablesUpdate } from '../types';

type Client = SupabaseClient<Database>;

export type Enrollment = Tables<'enrollments'>;
export type EnrollmentSettings = Tables<'enrollment_settings'>;

export interface RoomVacancyReview {
  id: string;
  daycare_id: string;
  classroom_id: string;
  room_name: string;
  available_on: string;
  source_transition_plan_id: string;
  moved_child_name: string;
  updated_at: string;
  candidate_enrollment_id: string | null;
  candidate_guardian_name: string | null;
  candidate_guardian_email: string | null;
  candidate_child_first_name: string | null;
  candidate_child_last_name: string | null;
  candidate_child_date_of_birth: string | null;
  candidate_desired_start_date: string | null;
  candidate_offer_start_on: string | null;
  candidate_waitlist_position: number | null;
  candidate_waitlist_priority: string | null;
  candidate_offer_tuition_cents: number | null;
  candidate_offer_deposit_cents: number | null;
  candidate_age_months: number | null;
  projected_children: number | null;
  capacity: number | null;
  active_waitlist_count: number;
  blocking_reason: string | null;
}

export type EnrollmentFitStatus = 'pass' | 'warning' | 'fail' | 'unknown';

export interface EnrollmentFitCheck {
  enrollment_id: string;
  classroom_id: string | null;
  room_name: string | null;
  start_on: string | null;
  age_months: number | null;
  min_age_months: number | null;
  max_age_months: number | null;
  age_status: EnrollmentFitStatus;
  age_message: string;
  projected_children_before: number | null;
  projected_children_after: number | null;
  capacity: number | null;
  capacity_status: EnrollmentFitStatus;
  capacity_message: string;
  staffing_status: EnrollmentFitStatus;
  staffing_message: string;
  coverage_segments: number;
  undercovered_segments: number;
  maximum_educator_gap: number;
}

export interface EnrollmentTourSlotRow extends Tables<'enrollment_tour_slots'> {
  classroom: { id: string; name: string } | null;
  host: { id: string; full_name: string } | null;
  enrollment: {
    id: string;
    guardian_name: string | null;
    child_first_name: string | null;
  } | null;
}

export interface EnrollmentChildRow {
  id: string;
  first_name: string;
  last_name: string;
  date_of_birth: string | null;
  enrolled_on: string | null;
  archived_at: string | null;
  classroom: { id: string; name: string } | null;
  departure: {
    id: string;
    last_day: string;
    reason: string;
    notes: string | null;
    status: string;
    offer_spot_automatically: boolean;
  }[];
}

export async function listEnrollments(client: Client): Promise<Enrollment[]> {
  const { data, error } = await client
    .from('enrollments')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function listRoomVacancyReviews(client: Client): Promise<RoomVacancyReview[]> {
  const { data, error } = await client.rpc('get_room_vacancy_reviews');
  if (error) throw error;
  return (data ?? []) as RoomVacancyReview[];
}

export async function getEnrollment(client: Client, enrollmentId: string): Promise<Enrollment | null> {
  const { data, error } = await client
    .from('enrollments')
    .select('*')
    .eq('id', enrollmentId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getEnrollmentFitCheck(
  client: Client,
  enrollmentId: string,
): Promise<EnrollmentFitCheck | null> {
  const { data, error } = await client.rpc('get_enrollment_fit_check', {
    p_enrollment_id: enrollmentId,
  });
  if (error) throw error;
  return (data?.[0] ?? null) as EnrollmentFitCheck | null;
}

export async function createEnrollment(
  client: Client,
  values: TablesInsert<'enrollments'>,
): Promise<string> {
  const { data, error } = await client.from('enrollments').insert(values).select('id').single();
  if (error) throw error;
  return data.id;
}

export async function updateEnrollment(
  client: Client,
  enrollmentId: string,
  values: TablesUpdate<'enrollments'>,
): Promise<void> {
  const { error } = await client.from('enrollments').update(values).eq('id', enrollmentId);
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

export async function listEnrollmentTourSlots(client: Client): Promise<EnrollmentTourSlotRow[]> {
  const { data, error } = await client
    .from('enrollment_tour_slots')
    .select(
      `*, classroom:classrooms(id, name), host:profiles!enrollment_tour_slots_host_id_fkey(id, full_name),
       enrollment:enrollments(id, guardian_name, child_first_name)`,
    )
    .neq('status', 'cancelled')
    .order('starts_at');
  if (error) throw error;
  return (data ?? []) as unknown as EnrollmentTourSlotRow[];
}

export async function getEnrollmentSettings(client: Client): Promise<EnrollmentSettings | null> {
  const { data, error } = await client.from('enrollment_settings').select('*').maybeSingle();
  if (error) throw error;
  return data;
}

export async function listEnrollmentChildren(client: Client): Promise<EnrollmentChildRow[]> {
  const { data, error } = await client
    .from('children')
    .select(
      `id, first_name, last_name, date_of_birth, enrolled_on, archived_at, classroom:classrooms(id, name),
       departure:child_departures(id, last_day, reason, notes, status, offer_spot_automatically)`,
    )
    .order('first_name');
  if (error) throw error;
  return (data ?? []) as unknown as EnrollmentChildRow[];
}

export async function processDueChildDepartures(client: Client): Promise<number> {
  const { data, error } = await client.rpc('process_due_child_departures');
  if (error) throw error;
  return data;
}

export function enrollmentJson(value: Json): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
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
    ...(lastName != null ? { p_last_name: lastName } : {}),
  });
  if (error) throw error;
  return data;
}

// ── Public inquiry form (2g) — anon-callable ────────────────────────────────

export interface PublicCenterInfo {
  name: string;
  programs: { id: string; name: string }[];
}

export async function getPublicCenterInfo(
  client: Client,
  daycareId: string,
): Promise<PublicCenterInfo | null> {
  const { data, error } = await client.rpc('get_public_center_info', {
    p_daycare_id: daycareId,
  });
  if (error) throw error;
  return (data?.[0] as unknown as PublicCenterInfo | undefined) ?? null;
}

export async function submitEnrollmentInquiry(
  client: Client,
  values: {
    daycareId: string;
    guardianName: string;
    guardianEmail: string;
    guardianPhone?: string;
    childFullName: string;
    childDateOfBirth?: string;
    classroomId?: string;
    desiredStart?: string;
    daysPerWeek: number;
  },
): Promise<{ enrollmentId: string; journeyCode: string }> {
  const { data, error } = await client.rpc('submit_parent_enrollment_inquiry', {
    p_daycare_id: values.daycareId,
    p_guardian_name: values.guardianName,
    p_guardian_email: values.guardianEmail,
    // Supabase's generated function Args do not preserve nullable SQL inputs.
    p_guardian_phone: (values.guardianPhone ?? null) as unknown as string,
    p_child_full_name: values.childFullName,
    p_child_date_of_birth: (values.childDateOfBirth ?? null) as unknown as string,
    p_classroom_id: (values.classroomId ?? null) as unknown as string,
    p_desired_start: (values.desiredStart ?? null) as unknown as string,
    p_days_per_week: values.daysPerWeek,
  });
  if (error) throw error;
  const result = data as { enrollment_id?: string; journey_code?: string } | null;
  if (!result?.enrollment_id || !result.journey_code) {
    throw new Error('The inquiry was saved, but its family link could not be created.');
  }
  return { enrollmentId: result.enrollment_id, journeyCode: result.journey_code };
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

export async function getClosureForDate(
  client: Client,
  date: string,
): Promise<Closure | null> {
  const { data, error } = await client
    .from('center_closures')
    .select('*')
    .lte('starts_on', date)
    .gte('ends_on', date)
    .order('starts_on')
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
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
