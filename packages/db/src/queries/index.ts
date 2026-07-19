import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types.gen';

export * from './attendance';
export * from './auth';
export * from './billing';
export * from './inbox';
export * from './incidents';
export * from './ledger';
export * from './notifications';
export * from './children';
export * from './enrollment';
export * from './families';
export * from './roles';
export * from './rooms';
export * from './scheduling';
export * from './staff';

type Client = SupabaseClient<Database>;

export interface ChildWithClassroom {
  id: string;
  first_name: string;
  last_name: string;
  date_of_birth: string | null;
  photo_url: string | null;
  classroom: { id: string; name: string } | null;
}

// Active (non-archived) children for the caller's daycare, RLS-scoped.
export async function listChildren(client: Client): Promise<ChildWithClassroom[]> {
  const { data, error } = await client
    .from('children')
    .select('id, first_name, last_name, date_of_birth, photo_url, classroom:classrooms(id, name)')
    .is('archived_at', null)
    .order('first_name');

  if (error) throw error;
  return (data ?? []) as unknown as ChildWithClassroom[];
}

export async function listClassrooms(client: Client) {
  // Age order, the way the designs present rooms everywhere
  const { data, error } = await client
    .from('classrooms')
    .select('id, name, age_group, capacity')
    .is('archived_at', null)
    .order('min_age_months', { ascending: true, nullsFirst: false })
    .order('name');

  if (error) throw error;
  return data ?? [];
}

export async function updateMyDaycare(
  client: Client,
  values: { name?: string; address?: string | null; phone?: string | null },
) {
  const profile = await getMyProfile(client);
  if (!profile?.daycare_id) throw new Error('No center on your profile');

  const { error } = await client
    .from('daycares')
    .update(values)
    .eq('id', profile.daycare_id);
  if (error) throw error;
}

export async function getMyDaycare(client: Client) {
  const profile = await getMyProfile(client);
  if (!profile?.daycare_id) return null;

  const { data, error } = await client
    .from('daycares')
    .select('*')
    .eq('id', profile.daycare_id)
    .single();

  if (error) throw error;
  return data;
}

export interface DaycareLocationRow {
  id: string;
  group_name: string;
  location_label: string;
  address: string | null;
  color: string;
  checked_in_count: number;
  is_active: boolean;
}

export async function listMyDaycareLocations(client: Client): Promise<DaycareLocationRow[]> {
  const { data, error } = await client.rpc('list_my_daycare_locations');
  if (error) throw error;
  return (data ?? []) as DaycareLocationRow[];
}

export async function switchDaycareLocation(client: Client, daycareId: string): Promise<void> {
  const { error } = await client.rpc('switch_daycare_location', { p_daycare_id: daycareId });
  if (error) throw error;
}

export async function createDaycareLocation(
  client: Client,
  values: { label: string; address?: string | null; color?: string },
): Promise<string> {
  const { data, error } = await client.rpc('create_daycare_location', {
    p_location_label: values.label,
    p_address: values.address ?? null,
    p_color: values.color ?? '#2F7CD8',
  });
  if (error) throw error;
  return data;
}

export async function getMyProfile(client: Client) {
  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError || !userData.user) return null;

  const { data, error } = await client
    .from('profiles')
    .select('*')
    .eq('id', userData.user.id)
    .single();

  if (error) throw error;
  return data;
}
