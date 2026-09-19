import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types.gen';

type Client = SupabaseClient<Database>;

export type ReportSchedule = Database['public']['Tables']['report_schedules']['Row'];
export type ReportExport = Database['public']['Tables']['report_exports']['Row'];

export interface ReportAdmin {
  id: string;
  full_name: string;
  email: string;
}

export async function listReportSchedules(client: Client): Promise<ReportSchedule[]> {
  const { data, error } = await client
    .from('report_schedules')
    .select('*')
    .order('active', { ascending: false })
    .order('next_run_at', { ascending: true, nullsFirst: false });
  if (error) throw error;
  return data ?? [];
}

export async function listRecentReportExports(
  client: Client,
  limit = 8,
): Promise<ReportExport[]> {
  const { data, error } = await client
    .from('report_exports')
    .select('*')
    .order('generated_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

export async function listReportAdmins(client: Client): Promise<ReportAdmin[]> {
  const { data, error } = await client
    .from('profiles')
    .select('id,full_name,email')
    .in('role', ['owner_admin', 'admin'])
    .is('archived_at', null)
    .order('full_name');
  if (error) throw error;
  return data ?? [];
}
