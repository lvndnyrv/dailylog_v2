import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types.gen';
import type { TablesInsert, TablesUpdate } from '../types';

type Client = SupabaseClient<Database>;

// ─────────────────────────────────────────────────────────────────────────────
// Roster (20a) + medical register (20b)
// ─────────────────────────────────────────────────────────────────────────────

export interface RosterGuardian {
  relationship: string | null;
  is_primary: boolean;
  parent: { id: string; full_name: string; email: string } | null;
}

export interface RosterChild {
  id: string;
  first_name: string;
  last_name: string;
  date_of_birth: string | null;
  photo_url: string | null;
  allergies: string[] | null;
  medical_notes: string | null;
  emergency_contacts: unknown;
  enrolled_on: string | null;
  classroom: { id: string; name: string } | null;
  guardians: RosterGuardian[];
}

const ROSTER_SELECT = `id, first_name, last_name, date_of_birth, photo_url,
  allergies, medical_notes, emergency_contacts, enrolled_on,
  classroom:classrooms(id, name),
  guardians:parent_children(relationship, is_primary,
    parent:profiles(id, full_name, email))`;

export async function listRoster(client: Client): Promise<RosterChild[]> {
  const { data, error } = await client
    .from('children')
    .select(ROSTER_SELECT)
    .is('archived_at', null)
    .order('first_name');

  if (error) throw error;
  return (data ?? []) as unknown as RosterChild[];
}

export interface MedicalRegisterRow {
  id: string;
  first_name: string;
  last_name: string;
  allergies: string[] | null;
  medical_notes: string | null;
  classroom: { id: string; name: string } | null;
  medications: { id: string; name: string; active: boolean }[];
}

export async function listMedicalRegister(client: Client): Promise<MedicalRegisterRow[]> {
  const { data, error } = await client
    .from('children')
    .select(
      `id, first_name, last_name, allergies, medical_notes,
       classroom:classrooms(id, name),
       medications:medication_authorizations(id, name, active)`,
    )
    .is('archived_at', null)
    .order('first_name');

  if (error) throw error;
  return (data ?? []) as unknown as MedicalRegisterRow[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Child profile (19a)
// ─────────────────────────────────────────────────────────────────────────────

export interface ChildPickup {
  id: string;
  full_name: string;
  relationship: string | null;
  phone: string | null;
  pin: string;
  is_primary: boolean;
}

export interface PendingParentInvite {
  id: string;
  email: string | null;
  relationship: string | null;
  code: string;
  expires_at: string | null;
}

export async function getChildProfile(client: Client, childId: string) {
  const [childRes, pickupsRes, medsRes, consentsRes, invitesRes] = await Promise.all([
    client
      .from('children')
      .select(
        `*, classroom:classrooms(id, name, age_group, min_age_months, max_age_months),
         guardians:parent_children(relationship, is_primary, pickup_authorized,
           parent:profiles(id, full_name, email, phone))`,
      )
      .eq('id', childId)
      .is('archived_at', null)
      .single(),
    client
      .from('child_pickups')
      .select('id, full_name, relationship, phone, pin, is_primary')
      .eq('child_id', childId)
      .is('archived_at', null)
      .order('is_primary', { ascending: false }),
    client
      .from('medication_authorizations')
      .select('id, name, dosage, schedule, active, parent:profiles(full_name)')
      .eq('child_id', childId)
      .order('active', { ascending: false }),
    client
      .from('consents')
      .select('id, kind, version, granted, granted_at')
      .eq('child_id', childId),
    client
      .from('child_invite_codes')
      .select('id, email, relationship, code, expires_at')
      .eq('child_id', childId)
      .is('used_at', null),
  ]);

  if (childRes.error) throw childRes.error;
  return {
    child: childRes.data,
    pickups: (pickupsRes.data ?? []) as ChildPickup[],
    medications: medsRes.data ?? [],
    consents: consentsRes.data ?? [],
    pendingInvites: (invitesRes.data ?? []) as PendingParentInvite[],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Mutations
// ─────────────────────────────────────────────────────────────────────────────

export async function createChild(
  client: Client,
  values: TablesInsert<'children'>,
): Promise<string> {
  const { data, error } = await client
    .from('children')
    .insert(values)
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

export async function updateChild(
  client: Client,
  childId: string,
  values: TablesUpdate<'children'>,
): Promise<void> {
  const { error } = await client.from('children').update(values).eq('id', childId);
  if (error) throw error;
}

// Soft delete only — the schema has no delete policy for children.
export async function archiveChild(client: Client, childId: string): Promise<void> {
  await updateChild(client, childId, { archived_at: new Date().toISOString() });
}

// Server-generated PIN, unique per center (kiosk integrity). Returns the PIN.
export async function addPickup(
  client: Client,
  values: {
    child_id: string;
    full_name: string;
    relationship?: string | null;
    phone?: string | null;
  },
): Promise<string> {
  const { data, error } = await client.rpc('create_pickup', {
    p_child_id: values.child_id,
    p_full_name: values.full_name,
    p_relationship: values.relationship ?? null,
    p_phone: values.phone ?? null,
  });
  if (error) throw error;
  return data;
}

export async function removePickup(client: Client, pickupId: string): Promise<void> {
  const { error } = await client
    .from('child_pickups')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', pickupId);
  if (error) throw error;
}

export async function createParentInvite(
  client: Client,
  childId: string,
  email: string,
  relationship?: string,
): Promise<string> {
  const { data, error } = await client.rpc('create_parent_invite', {
    p_child_id: childId,
    p_email: email,
    p_relationship: relationship ?? null,
  });
  if (error) throw error;
  return data;
}

// Unlink a guardian from a child (19d "Unlink"). RLS admins-manage-links.
export async function unlinkParent(
  client: Client,
  childId: string,
  parentId: string,
): Promise<void> {
  const { error } = await client
    .from('parent_children')
    .delete()
    .eq('child_id', childId)
    .eq('parent_id', parentId);
  if (error) throw error;
}

// Toggle a per-child consent (19d Consents tab). Upsert on (child_id, kind,
// version); admins-manage-consents in RLS.
export async function setChildConsent(
  client: Client,
  values: { daycare_id: string; child_id: string; kind: string; granted: boolean },
): Promise<void> {
  const { error } = await client.from('consents').upsert(
    {
      daycare_id: values.daycare_id,
      child_id: values.child_id,
      kind: values.kind,
      version: '1',
      granted: values.granted,
      granted_at: values.granted ? new Date().toISOString() : null,
    },
    { onConflict: 'child_id,kind,version' },
  );
  if (error) throw error;
}
