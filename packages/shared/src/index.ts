// Domain rules shared by mobile and web. Business logic lives here, not in
// screens (CLAUDE.md).

export const ROLES = ['owner_admin', 'admin', 'educator', 'parent'] as const;
export type Role = (typeof ROLES)[number];

export function isAdminRole(role: string | null | undefined): boolean {
  return role === 'owner_admin' || role === 'admin';
}

export function isStaffRole(role: string | null | undefined): boolean {
  return role === 'owner_admin' || role === 'admin' || role === 'educator';
}

// Enrollment pipeline stages, in order (design 2b–2m).
export const ENROLLMENT_STAGES = [
  'inquiry',
  'tour',
  'application',
  'offer',
  'enrolled',
  'withdrawn',
] as const;
export type EnrollmentStage = (typeof ENROLLMENT_STAGES)[number];

export const INCIDENT_STATUSES = ['draft', 'submitted', 'signed_off', 'acknowledged'] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

// The consents a center tracks per child (design 19d Consents tab). Parents
// grant these from their app; admins can also toggle them from the console.
export const CONSENT_KINDS = [
  'Photo & media consent',
  'Field-trip permission',
  'Sunscreen application',
  'Water / splash play',
] as const;
export type ConsentKind = (typeof CONSENT_KINDS)[number];

// An emergency contact row (children.emergency_contacts jsonb).
export interface EmergencyContact {
  name: string;
  relation: string;
  phone: string;
}

// Role permissions matrix (design 4o). Each area carries view/edit/approve;
// center_roles.permissions is keyed by area key and enforced by database RLS
// plus sensitive security-definer trigger guards.
export interface AreaPermission {
  view: boolean;
  edit: boolean;
  approve: boolean;
}
export type RolePermissions = Record<string, AreaPermission>;

export const PERMISSION_AREAS = [
  {
    group: 'Care & daily logs',
    items: [
      { key: 'daily_logs', label: 'Daily logs' },
      { key: 'attendance', label: 'Attendance & check-in' },
      { key: 'medications', label: 'Medications' },
      { key: 'incidents', label: 'Incident reports' },
    ],
  },
  {
    group: 'Children & families',
    items: [
      { key: 'children', label: 'Children & profiles' },
      { key: 'enrollment', label: 'Enrollment & waitlist' },
      { key: 'broadcasts', label: 'Broadcasts' },
    ],
  },
  {
    group: 'Operations',
    items: [
      { key: 'billing', label: 'Billing & payments' },
      { key: 'reports', label: 'Reports' },
      { key: 'staff', label: 'Staff & permissions' },
    ],
  },
] as const;

export const PERMISSION_AREA_KEYS = PERMISSION_AREAS.flatMap((g) =>
  g.items.map((i) => i.key),
);

// Flat list of every area item, for rendering hidden inputs / rows without
// grouping. `.map` (not the raw tuple) keeps the element type uniform.
export const PERMISSION_ITEMS: { key: string; label: string }[] =
  PERMISSION_AREAS.flatMap((g) => g.items.map((i) => ({ key: i.key, label: i.label })));

export function emptyPermission(): AreaPermission {
  return { view: false, edit: false, approve: false };
}

export function ageInMonths(dateOfBirth: string | Date, at: Date = new Date()): number {
  const dob = typeof dateOfBirth === 'string'
    ? /^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)
      ? new Date(
          Number(dateOfBirth.slice(0, 4)),
          Number(dateOfBirth.slice(5, 7)) - 1,
          Number(dateOfBirth.slice(8, 10)),
        )
      : new Date(dateOfBirth)
    : dateOfBirth;
  return (
    (at.getFullYear() - dob.getFullYear()) * 12 +
    (at.getMonth() - dob.getMonth()) -
    (at.getDate() < dob.getDate() ? 1 : 0)
  );
}

// "1y 4m" for toddlers, "3y" once months stop mattering, "8m" for infants.
export function formatAge(dateOfBirth: string | Date, at: Date = new Date()): string {
  const months = ageInMonths(dateOfBirth, at);
  if (months < 12) return `${months}m`;
  const years = Math.floor(months / 12);
  const rem = months % 12;
  return years >= 3 || rem === 0 ? `${years}y` : `${years}y ${rem}m`;
}

// Room ratio rule (design 7a–f): children per educator, over-ratio flagged.
export function isOverRatio(
  presentChildren: number,
  presentEducators: number,
  ratioChildrenPerEducator: number,
): boolean {
  if (presentEducators <= 0) return presentChildren > 0;
  return presentChildren / presentEducators > ratioChildrenPerEducator;
}

// Child setup checklist (19b / mobile 13b): the same five-item model on both
// apps, derived from the record so "40% complete" always means the same thing.
export interface SetupItem {
  key: 'basics' | 'photo' | 'medical' | 'emergency' | 'parents';
  label: string;
  hint: string;
  done: boolean;
}

export function childSetupChecklist(child: {
  first_name: string;
  date_of_birth: string | null;
  photo_url: string | null;
  allergies: string[] | null;
  medical_notes: string | null;
  emergency_contacts: unknown;
  setup_state?: unknown;
  guardianCount: number;
  pendingInviteCount: number;
}): { items: SetupItem[]; percent: number; incomplete: number } {
  const contacts = Array.isArray(child.emergency_contacts) ? child.emergency_contacts : [];
  const setupState =
    child.setup_state && typeof child.setup_state === 'object' && !Array.isArray(child.setup_state)
      ? (child.setup_state as Record<string, unknown>)
      : {};
  const reviewed = (key: SetupItem['key'], fallback: boolean) =>
    typeof setupState[key] === 'boolean' ? (setupState[key] as boolean) : fallback;
  const items: SetupItem[] = [
    {
      key: 'basics',
      label: 'Basic details',
      hint: 'Name & birthday',
      done: reviewed('basics', Boolean(child.first_name && child.date_of_birth)),
    },
    {
      key: 'photo',
      label: 'Photo',
      hint: 'Helps educators at pickup',
      done: reviewed('photo', Boolean(child.photo_url)),
    },
    {
      key: 'medical',
      label: 'Medical info',
      hint: 'Allergies, notes, medications',
      done: reviewed(
        'medical',
        Boolean((child.allergies?.length ?? 0) > 0 || child.medical_notes),
      ),
    },
    {
      key: 'emergency',
      label: 'Emergency contacts',
      hint: 'At least one required',
      done: reviewed('emergency', contacts.length > 0),
    },
    {
      key: 'parents',
      label: 'Linked parents',
      hint: 'Invite by email or choose existing',
      done: reviewed(
        'parents',
        child.guardianCount > 0 || child.pendingInviteCount > 0,
      ),
    },
  ];
  const done = items.filter((i) => i.done).length;
  return {
    items,
    percent: Math.round((done / items.length) * 100),
    incomplete: items.length - done,
  };
}

export function initials(fullName: string): string {
  return fullName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('');
}
