"use server";

import {
  getMyProfile,
  markAllNotificationsRead,
  markNotificationRead,
  saveNotificationDeliverySettings,
  saveNotificationPreferences,
} from "@dailylog/db/queries";
import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";
import {
  NOTIFICATION_PREFERENCE_KINDS,
  type NotificationPreferenceInput,
} from "@/lib/notifications/config";

export interface NotificationActionResult {
  ok?: boolean;
  error?: string;
}

export async function markNotificationReadAction(
  notificationId: string,
): Promise<NotificationActionResult> {
  if (!notificationId) return { error: "Notification not found." };
  try {
    const supabase = await getServerSupabase();
    await markNotificationRead(supabase, notificationId);
    revalidatePath("/notifications");
    return { ok: true };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Could not mark the notification read.",
    };
  }
}

export async function markAllNotificationsReadAction(): Promise<NotificationActionResult> {
  try {
    const supabase = await getServerSupabase();
    await markAllNotificationsRead(supabase);
    revalidatePath("/notifications");
    return { ok: true };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Could not mark notifications read.",
    };
  }
}

export async function saveNotificationPreferencesAction(values: {
  preferences: NotificationPreferenceInput[];
  quietHoursEnabled: boolean;
}): Promise<NotificationActionResult> {
  try {
    const supabase = await getServerSupabase();
    const profile = await getMyProfile(supabase);
    if (!profile?.daycare_id) return { error: "No center on your profile." };

    const byKind = new Map(values.preferences.map((preference) => [preference.kind, preference]));
    const normalized = NOTIFICATION_PREFERENCE_KINDS.map((kind) => {
      const preference = byKind.get(kind);
      return {
        profile_id: profile.id,
        daycare_id: profile.daycare_id!,
        kind,
        in_app: kind === "ratio_alert" || kind === "incident_report" || kind === "new_device_sign_in"
          ? true
          : Boolean(preference?.inApp),
        push: kind === "ratio_alert" ? true : Boolean(preference?.push),
        email: Boolean(preference?.email),
      };
    });

    await Promise.all([
      saveNotificationPreferences(supabase, normalized),
      saveNotificationDeliverySettings(supabase, {
        profile_id: profile.id,
        daycare_id: profile.daycare_id,
        quiet_hours_enabled: Boolean(values.quietHoursEnabled),
        quiet_hours_start: "22:00",
        quiet_hours_end: "06:00",
        email_mode: "daily_digest",
      }),
    ]);
    revalidatePath("/notifications");
    return { ok: true };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Could not save notification settings.",
    };
  }
}
