"use client";

import type {
  NotificationDeliverySettingsRow,
  NotificationPreferenceRow,
  NotificationRow,
} from "@dailylog/db/queries";
import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import {
  markAllNotificationsReadAction,
  markNotificationReadAction,
} from "@/lib/notifications/actions";
import {
  NOTIFICATION_PREFERENCE_KINDS,
  type NotificationPreferenceInput,
  type NotificationPreferenceKind,
} from "@/lib/notifications/config";
import { NotificationSettingsModal } from "./notification-settings-modal";
import { notificationPresentation } from "./notification-visuals";

interface NotificationCenterValue {
  notifications: NotificationRow[];
  unreadCount: number;
  preferences: NotificationPreferenceInput[];
  quietHoursEnabled: boolean;
  actionError: string | null;
  markRead: (notificationId: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  openSettings: () => void;
  updatePreferences: (
    preferences: NotificationPreferenceInput[],
    quietHoursEnabled: boolean,
  ) => void;
}

const NotificationCenterContext = createContext<NotificationCenterValue | null>(null);

const DEFAULTS: Record<
  NotificationPreferenceKind,
  Omit<NotificationPreferenceInput, "kind">
> = {
  ratio_alert: { inApp: true, push: true, email: false },
  incident_report: { inApp: true, push: true, email: true },
  cert_expiry: { inApp: true, push: false, email: true },
  overdue_billing: { inApp: true, push: false, email: true },
  new_device_sign_in: { inApp: true, push: true, email: true },
  waitlist_enrollment: { inApp: true, push: false, email: false },
};

function normalizedPreferences(rows: NotificationPreferenceRow[]): NotificationPreferenceInput[] {
  const byKind = new Map(rows.map((row) => [row.kind, row]));
  return NOTIFICATION_PREFERENCE_KINDS.map((kind) => {
    const row = byKind.get(kind);
    return {
      kind,
      inApp: row?.in_app ?? DEFAULTS[kind].inApp,
      push: row?.push ?? DEFAULTS[kind].push,
      email: row?.email ?? DEFAULTS[kind].email,
    };
  });
}

export function NotificationCenterProvider({
  profileId,
  initialNotifications,
  initialPreferences,
  initialDeliverySettings,
  children,
}: {
  profileId: string;
  initialNotifications: NotificationRow[];
  initialPreferences: NotificationPreferenceRow[];
  initialDeliverySettings: NotificationDeliverySettingsRow | null;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [notifications, setNotifications] = useState(initialNotifications);
  const [preferences, setPreferences] = useState(() => normalizedPreferences(initialPreferences));
  const [quietHoursEnabled, setQuietHoursEnabled] = useState(
    initialDeliverySettings?.quiet_hours_enabled ?? true,
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [toast, setToast] = useState<NotificationRow | null>(() => {
    const recentCutoff = Date.now() - 10 * 60 * 1000;
    return (
      initialNotifications.find((notification) => {
        const presentation = notificationPresentation(notification);
        return (
          presentation.urgent &&
          !notification.read_at &&
          new Date(notification.created_at ?? 0).getTime() >= recentCutoff
        );
      }) ?? null
    );
  });

  useEffect(() => {
    const supabase = getBrowserSupabase();
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    const subscribe = async () => {
      // The browser client restores auth from SSR cookies asynchronously. Give
      // Realtime that JWT before joining so notification RLS is evaluated as
      // the signed-in admin rather than the anonymous role.
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session) await supabase.realtime.setAuth(session.access_token);
      if (cancelled) return;

      channel = supabase
        .channel(`admin-notifications:${profileId}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "notifications",
            filter: `profile_id=eq.${profileId}`,
          },
          (payload) => {
            const notification = payload.new as NotificationRow;
            setNotifications((current) => [
              notification,
              ...current.filter((row) => row.id !== notification.id),
            ]);
            if (notificationPresentation(notification).urgent) setToast(notification);
          },
        )
        .subscribe();
    };

    void subscribe();

    return () => {
      cancelled = true;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [profileId]);

  const markRead = useCallback(async (notificationId: string) => {
    const readAt = new Date().toISOString();
    setNotifications((current) =>
      current.map((row) => (row.id === notificationId ? { ...row, read_at: readAt } : row)),
    );
    setActionError(null);
    const result = await markNotificationReadAction(notificationId);
    if (result.error) setActionError(result.error);
  }, []);

  const markAllRead = useCallback(async () => {
    const readAt = new Date().toISOString();
    setNotifications((current) => current.map((row) => ({ ...row, read_at: readAt })));
    setActionError(null);
    const result = await markAllNotificationsReadAction();
    if (result.error) setActionError(result.error);
  }, []);

  const updatePreferences = useCallback(
    (nextPreferences: NotificationPreferenceInput[], nextQuietHoursEnabled: boolean) => {
      setPreferences(nextPreferences);
      setQuietHoursEnabled(nextQuietHoursEnabled);
    },
    [],
  );

  const value = useMemo<NotificationCenterValue>(
    () => ({
      notifications,
      unreadCount: notifications.filter((notification) => !notification.read_at).length,
      preferences,
      quietHoursEnabled,
      actionError,
      markRead,
      markAllRead,
      openSettings: () => setSettingsOpen(true),
      updatePreferences,
    }),
    [
      notifications,
      preferences,
      quietHoursEnabled,
      actionError,
      markRead,
      markAllRead,
      updatePreferences,
    ],
  );

  return (
    <NotificationCenterContext.Provider value={value}>
      {children}
      {settingsOpen && (
        <NotificationSettingsModal
          preferences={preferences}
          quietHoursEnabled={quietHoursEnabled}
          onSaved={updatePreferences}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {toast && (
        <UrgentNotificationToast
          notification={toast}
          onDismiss={() => setToast(null)}
          onOpen={(href) => {
            void markRead(toast.id);
            setToast(null);
            router.push(href);
          }}
        />
      )}
    </NotificationCenterContext.Provider>
  );
}

export function useNotificationCenter() {
  const context = useContext(NotificationCenterContext);
  if (!context) throw new Error("NotificationCenterProvider is missing.");
  return context;
}

function UrgentNotificationToast({
  notification,
  onDismiss,
  onOpen,
}: {
  notification: NotificationRow;
  onDismiss: () => void;
  onOpen: (href: string) => void;
}) {
  const presentation = notificationPresentation(notification);
  const Icon = presentation.icon;

  return (
    <div
      role="alert"
      className="fixed right-[18px] top-5 z-[70] flex w-[328px] max-w-[calc(100vw-2rem)] gap-3 rounded-[15px] border-[1.5px] border-[#F0C9C4] bg-card p-3.5 pl-[17px]"
      style={{ boxShadow: "0 16px 44px rgba(23,51,91,.20)" }}
    >
      <span className={`absolute bottom-3.5 left-0 top-3.5 w-[3px] rounded-r ${presentation.accentClassName}`} />
      <span className={`grid size-9 flex-none place-items-center rounded-[10px] ${presentation.iconClassName}`}>
        <Icon size={17} strokeWidth={1.7} aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-bold text-ink">{notification.title}</span>
        {notification.body && (
          <span className="mt-0.5 block text-[11.5px] leading-[1.45] text-muted">
            {notification.body}
          </span>
        )}
        <span className="mt-2.5 flex gap-2">
          <button
            type="button"
            onClick={() => onOpen(presentation.href)}
            className="rounded-btn bg-primary px-3.5 py-[7px] text-[11.5px] font-bold text-white hover:bg-primary-hover"
          >
            {presentation.actionLabel}
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-btn border-[1.5px] border-[#D6E1F0] bg-card px-3.5 py-[7px] text-[11.5px] font-bold text-muted hover:bg-canvas"
          >
            Dismiss
          </button>
        </span>
      </span>
    </div>
  );
}
