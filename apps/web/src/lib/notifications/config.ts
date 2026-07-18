export const NOTIFICATION_PREFERENCE_KINDS = [
  "ratio_alert",
  "incident_report",
  "cert_expiry",
  "overdue_billing",
  "new_device_sign_in",
  "waitlist_enrollment",
] as const;

export type NotificationPreferenceKind =
  (typeof NOTIFICATION_PREFERENCE_KINDS)[number];

export interface NotificationPreferenceInput {
  kind: NotificationPreferenceKind;
  inApp: boolean;
  push: boolean;
  email: boolean;
}
