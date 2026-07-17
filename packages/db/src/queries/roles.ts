import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types.gen';

type Client = SupabaseClient<Database>;

// Structural mirror of @dailylog/shared's RolePermissions. Kept local so the
// data layer stays dependency-free; the two are assignable by shape.
export type RolePermissions = Record<
  string,
  { view: boolean; edit: boolean; approve: boolean }
>;

export interface CenterRole {
  id: string;
  name: string;
  description: string | null;
  base_role: string;
  is_locked: boolean;
  is_system: boolean;
  sort: number;
  permissions: RolePermissions;
  member_count: number;
}

export async function listCenterRoles(client: Client): Promise<CenterRole[]> {
  const { data, error } = await client.rpc('get_center_roles');
  if (error) throw error;
  return (data ?? []) as unknown as CenterRole[];
}

export async function hasPermission(
  client: Client,
  area: string,
  action: 'view' | 'edit' | 'approve' = 'view',
): Promise<boolean> {
  const { data, error } = await client.rpc('has_permission', {
    p_area: area,
    p_action: action,
  });
  if (error) throw error;
  return data;
}

export async function createCenterRole(
  client: Client,
  values: {
    daycare_id: string;
    name: string;
    description?: string | null;
    base_role: string;
    permissions: RolePermissions;
    sort?: number;
  },
): Promise<string> {
  const { data, error } = await client
    .from('center_roles')
    .insert({
      daycare_id: values.daycare_id,
      name: values.name,
      description: values.description ?? null,
      base_role: values.base_role,
      permissions: values.permissions as never,
      sort: values.sort ?? 100,
    })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

export async function updateCenterRole(
  client: Client,
  id: string,
  values: { name?: string; description?: string | null; permissions?: RolePermissions },
): Promise<void> {
  const { error } = await client
    .from('center_roles')
    .update({
      ...(values.name !== undefined ? { name: values.name } : {}),
      ...(values.description !== undefined ? { description: values.description } : {}),
      ...(values.permissions !== undefined ? { permissions: values.permissions as never } : {}),
    })
    .eq('id', id);
  if (error) throw error;
}

export async function deleteCenterRole(client: Client, id: string): Promise<void> {
  const { error } = await client.from('center_roles').delete().eq('id', id).eq('is_locked', false);
  if (error) throw error;
}
