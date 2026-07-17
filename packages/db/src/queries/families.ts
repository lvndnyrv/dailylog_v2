import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types.gen';

type Client = SupabaseClient<Database>;

export interface FamilyMember {
  family_id: string;
  profile_id: string;
  role: string;
  relationship: string | null;
  receives_messages: boolean;
  receives_billing: boolean;
  profile: {
    id: string;
    full_name: string;
    email: string;
    phone: string | null;
  } | null;
}

export interface FamilyChild {
  family_id: string;
  child_id: string;
  is_primary: boolean;
  child: {
    id: string;
    first_name: string;
    last_name: string;
    photo_url: string | null;
    classroom: { id: string; name: string } | null;
  } | null;
}

export interface FamilyRow {
  id: string;
  daycare_id: string;
  display_name: string;
  primary_contact_id: string | null;
  billing_email: string | null;
  billing_phone: string | null;
  status: string;
  archived_at: string | null;
  members: FamilyMember[];
  children: FamilyChild[];
}

const FAMILY_SELECT = `id, daycare_id, display_name, primary_contact_id,
  billing_email, billing_phone, status, archived_at,
  members:family_members(
    family_id, profile_id, role, relationship, receives_messages,
    receives_billing, profile:profiles(id, full_name, email, phone)
  ),
  children:family_children(
    family_id, child_id, is_primary,
    child:children(id, first_name, last_name, photo_url,
      classroom:classrooms(id, name))
  )`;

// RLS returns the whole center for staff and only the caller's household(s)
// for parents. Keeping this primitive role-neutral makes it reusable by web
// billing and the parent app.
export async function listFamilies(client: Client): Promise<FamilyRow[]> {
  const { data, error } = await client
    .from('families')
    .select(FAMILY_SELECT)
    .eq('status', 'active')
    .is('archived_at', null)
    .order('display_name');

  if (error) throw error;
  return (data ?? []) as unknown as FamilyRow[];
}

export async function getFamily(client: Client, familyId: string): Promise<FamilyRow> {
  const { data, error } = await client
    .from('families')
    .select(FAMILY_SELECT)
    .eq('id', familyId)
    .single();

  if (error) throw error;
  return data as unknown as FamilyRow;
}
