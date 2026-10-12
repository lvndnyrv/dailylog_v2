export type MedicationLifecycleFields = {
  active: boolean;
  signed_at?: string | null;
  consented_at?: string | null;
  ended_at?: string | null;
};

export type MedicationLifecycleStatus = "active" | "consent_needed" | "ended";

export function medicationLifecycleStatus(
  medication: MedicationLifecycleFields,
): MedicationLifecycleStatus {
  if (medication.active) return "active";

  // Inactive unsigned records are admin-created drafts awaiting the parent.
  // Once a legal signature/consent exists, an inactive record is historical.
  if (medication.ended_at || medication.signed_at || medication.consented_at) {
    return "ended";
  }

  return "consent_needed";
}
