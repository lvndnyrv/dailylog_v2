import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types.gen';

type Client = SupabaseClient<Database>;

export interface IncidentRow {
  id: string;
  occurred_at: string;
  location: string;
  severity: string;
  injury_type: string;
  injury_side: string | null;
  body_parts: string[] | null;
  description: string;
  first_aid_given: string;
  first_aid_by: string | null;
  witness_id: string | null;
  witnesses: string[] | null;
  submitted_at: string | null;
  status: string;
  signed_off_at: string | null;
  parent_notified_at: string | null;
  parent_acknowledged_at: string | null;
  parent_acknowledge_name: string | null;
  child: { id: string; first_name: string; last_name: string; date_of_birth: string | null } | null;
  educator: { id: string; full_name: string } | null;
  first_aid_provider: { id: string; full_name: string } | null;
  witness: { id: string; full_name: string } | null;
  classroom: { id: string; name: string } | null;
}

const INCIDENT_SELECT = `id, occurred_at, location, severity, injury_type, injury_side, body_parts,
  description, first_aid_given, first_aid_by, witness_id, witnesses, submitted_at,
  status, signed_off_at, parent_notified_at, parent_acknowledged_at, parent_acknowledge_name,
  child:children(id, first_name, last_name, date_of_birth),
  educator:profiles!incident_reports_educator_id_fkey(id, full_name),
  first_aid_provider:profiles!incident_reports_first_aid_by_fkey(id, full_name),
  witness:profiles!incident_reports_witness_id_fkey(id, full_name),
  classroom:classrooms(id, name)`;

// Reports waiting for an admin signature (9b's queue on the dashboard).
export async function listIncidentsAwaitingSignoff(client: Client): Promise<IncidentRow[]> {
  const { data, error } = await client
    .from('incident_reports')
    .select(INCIDENT_SELECT)
    .eq('status', 'submitted')
    .order('occurred_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as IncidentRow[];
}

export async function listRecentIncidents(client: Client, limit = 10): Promise<IncidentRow[]> {
  const { data, error } = await client
    .from('incident_reports')
    .select(INCIDENT_SELECT)
    .neq('status', 'draft')
    .order('occurred_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as unknown as IncidentRow[];
}

// The signature locks the report and stamps the family notification.
export async function signOffIncident(
  client: Client,
  incidentId: string,
  adminId: string,
): Promise<void> {
  const { data, error } = await client
    .from('incident_reports')
    .update({
      status: 'signed_off',
      signed_off_by: adminId,
      signed_off_at: new Date().toISOString(),
      parent_notified_at: new Date().toISOString(),
    })
    .eq('id', incidentId)
    .eq('status', 'submitted')
    .select('id')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('This incident was already reviewed or is no longer available.');
}
