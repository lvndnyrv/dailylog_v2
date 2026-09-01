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
  setup_state: unknown;
  enrolled_on: string | null;
  classroom: { id: string; name: string } | null;
  guardians: RosterGuardian[];
}

const ROSTER_SELECT = `id, first_name, last_name, date_of_birth, photo_url,
  allergies, medical_notes, emergency_contacts, setup_state, enrolled_on,
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
  emergency_contacts: unknown;
  classroom: { id: string; name: string } | null;
  medications: { id: string; name: string; active: boolean }[];
}

export async function listMedicalRegister(client: Client): Promise<MedicalRegisterRow[]> {
  const { data, error } = await client
    .from('children')
    .select(
      `id, first_name, last_name, allergies, medical_notes, emergency_contacts,
       classroom:classrooms(id, name),
       medications:medication_authorizations(id, name, active)`,
    )
    .is('archived_at', null)
    .order('first_name');

  if (error) throw error;
  return (data ?? []) as unknown as MedicalRegisterRow[];
}

export interface ConsentRegisterRow {
  id: string;
  first_name: string;
  last_name: string;
  classroom: { id: string; name: string } | null;
  consents: {
    id: string;
    kind: string;
    granted: boolean;
    updated_at: string | null;
  }[];
}

export async function listConsentRegister(client: Client): Promise<ConsentRegisterRow[]> {
  const { data, error } = await client
    .from('children')
    .select(
      `id, first_name, last_name,
       classroom:classrooms(id, name),
       consents(id, kind, granted, updated_at)`,
    )
    .is('archived_at', null)
    .order('first_name');

  if (error) throw error;
  return (data ?? []) as unknown as ConsentRegisterRow[];
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
  approval_status: 'pending' | 'approved' | 'rejected';
  requested_at: string | null;
  reviewed_at: string | null;
  review_note: string | null;
}

export interface PickupSecurityEvent {
  id: string;
  attempted_name: string | null;
  notes: string | null;
  status: 'open' | 'resolved';
  created_at: string;
  resolved_at: string | null;
  reporter: { full_name: string } | null;
  resolver: { full_name: string } | null;
}

export interface PendingParentInvite {
  id: string;
  email: string | null;
  relationship: string | null;
  code: string;
  expires_at: string | null;
  created_at: string | null;
}

export interface ChildDocument {
  id: string;
  title: string;
  category: string | null;
  storage_path: string;
  mime_type: string | null;
  size_bytes: number | null;
  created_at: string | null;
}

export interface ParentDocumentRequestReviewRow {
  id: string;
  kind: string;
  title: string;
  message: string | null;
  due_on: string | null;
  status: string;
  requested_at: string;
  submitted_at: string | null;
  completed_at: string | null;
  rejection_reason: string | null;
  latest_document: {
    id: string;
    title: string;
    mime_type: string | null;
    size_bytes: number | null;
    created_at: string | null;
  } | null;
  submissions: {
    id: string;
    status: string;
    submitted_at: string;
    reviewed_at: string | null;
    rejection_reason: string | null;
  }[];
}

export async function getChildProfile(client: Client, childId: string) {
  const [
    childRes,
    pickupsRes,
    medsRes,
    consentsRes,
    invitesRes,
    documentsRes,
    documentRequestsRes,
    pickupSecurityRes,
  ] = await Promise.all([
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
      .select(
        'id, full_name, relationship, phone, pin, is_primary, approval_status, requested_at, reviewed_at, review_note',
      )
      .eq('child_id', childId)
      .is('archived_at', null)
      .order('is_primary', { ascending: false }),
    client
      .from('medication_authorizations')
      .select(
        'id, parent_id, name, dosage, schedule, notes, active, parent:profiles!medication_authorizations_parent_id_fkey(full_name)',
      )
      .eq('child_id', childId)
      .order('active', { ascending: false }),
    client
      .from('consents')
      .select('id, kind, version, granted, granted_at')
      .eq('child_id', childId),
    client
      .from('child_invite_codes')
      .select('id, email, relationship, code, expires_at, created_at')
      .eq('child_id', childId)
      .is('used_at', null),
    client
      .from('documents')
      .select('id, title, category, storage_path, mime_type, size_bytes, created_at')
      .eq('child_id', childId)
      .is('archived_at', null)
      .order('created_at', { ascending: false }),
    client
      .from('parent_document_requests')
      .select(
        `id, kind, title, message, due_on, status, requested_at, submitted_at,
         completed_at, rejection_reason,
         latest_document:documents!parent_document_requests_latest_document_id_fkey(
           id, title, mime_type, size_bytes, created_at
         ),
         submissions:parent_document_submissions(
           id, status, submitted_at, reviewed_at, rejection_reason
         )`,
      )
      .eq('child_id', childId)
      .neq('status', 'cancelled')
      .order('requested_at', { ascending: false }),
    client
      .from('pickup_security_events')
      .select(
        `id, attempted_name, notes, status, created_at, resolved_at,
         reporter:profiles!pickup_security_events_reported_by_fkey(full_name),
         resolver:profiles!pickup_security_events_resolved_by_fkey(full_name)`,
      )
      .eq('child_id', childId)
      .order('created_at', { ascending: false })
      .limit(10),
  ]);

  if (childRes.error) throw childRes.error;
  if (pickupsRes.error) throw pickupsRes.error;
  if (medsRes.error) throw medsRes.error;
  if (consentsRes.error) throw consentsRes.error;
  if (invitesRes.error) throw invitesRes.error;
  if (documentsRes.error) throw documentsRes.error;
  if (documentRequestsRes.error) throw documentRequestsRes.error;
  if (pickupSecurityRes.error) throw pickupSecurityRes.error;
  return {
    child: childRes.data,
    pickups: (pickupsRes.data ?? []) as ChildPickup[],
    medications: medsRes.data ?? [],
    consents: consentsRes.data ?? [],
    pendingInvites: (invitesRes.data ?? []) as PendingParentInvite[],
    documents: (documentsRes.data ?? []) as ChildDocument[],
    documentRequests: (documentRequestsRes.data ?? []) as unknown as ParentDocumentRequestReviewRow[],
    pickupSecurityEvents: (pickupSecurityRes.data ?? []) as unknown as PickupSecurityEvent[],
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
    ...(values.relationship != null ? { p_relationship: values.relationship } : {}),
    ...(values.phone != null ? { p_phone: values.phone } : {}),
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

export async function reviewParentPickup(
  client: Client,
  pickupId: string,
  decision: 'approved' | 'rejected',
  note?: string | null,
): Promise<void> {
  const { error } = await client.rpc('review_parent_authorized_pickup', {
    p_pickup_id: pickupId,
    p_decision: decision,
    ...(note != null ? { p_note: note } : {}),
  });
  if (error) throw error;
}

export async function resolvePickupSecurityEvent(
  client: Client,
  eventId: string,
  childId: string,
  resolvedBy: string,
): Promise<void> {
  const { error } = await client
    .from('pickup_security_events')
    .update({
      status: 'resolved',
      resolved_by: resolvedBy,
      resolved_at: new Date().toISOString(),
    })
    .eq('id', eventId)
    .eq('child_id', childId)
    .eq('status', 'open');
  if (error) throw error;
}

export async function saveMedicationAuthorization(
  client: Client,
  values: {
    id?: string;
    daycare_id: string;
    child_id: string;
    parent_id?: string | null;
    name: string;
    dosage: string;
    schedule?: string | null;
    notes?: string | null;
    active: boolean;
  },
): Promise<void> {
  const record = {
    parent_id: values.parent_id ?? null,
    name: values.name,
    dosage: values.dosage,
    schedule: values.schedule ?? null,
    notes: values.notes ?? null,
    active: values.active,
  };
  const result = values.id
    ? await client
        .from('medication_authorizations')
        .update(record)
        .eq('id', values.id)
        .eq('child_id', values.child_id)
    : await client.from('medication_authorizations').insert({
        ...record,
        daycare_id: values.daycare_id,
        child_id: values.child_id,
      });
  if (result.error) throw result.error;
}

export async function getChildDocument(client: Client, documentId: string) {
  const { data, error } = await client
    .from('documents')
    .select('id, child_id, title, storage_path, mime_type')
    .eq('id', documentId)
    .is('archived_at', null)
    .single();
  if (error) throw error;
  return data;
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
    ...(relationship != null ? { p_relationship: relationship } : {}),
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
