"use client";

import Link from "next/link";
import { Bell, Clock3, Mail, Smartphone } from "lucide-react";
import { useState } from "react";
import { useNotificationCenter } from "./notification-center";
import {
  notificationDayKey,
  notificationPresentation,
} from "./notification-visuals";

type ActivityFilter =
  | "all"
  | "unread"
  | "alerts"
  | "compliance"
  | "sessions"
  | "billing";

const FILTERS: Array<{ value: ActivityFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "unread", label: "Unread" },
  { value: "alerts", label: "Alerts" },
  { value: "compliance", label: "Compliance" },
  { value: "sessions", label: "Sessions" },
  { value: "billing", label: "Billing" },
];

export function NotificationActivityView() {
  const {
    notifications,
    unreadCount,
    preferences,
    quietHoursEnabled,
    actionError,
    markRead,
    markAllRead,
    openSettings,
  } = useNotificationCenter();
  const [filter, setFilter] = useState<ActivityFilter>("all");

  const filtered = notifications.filter((notification) => {
    if (filter === "all") return true;
    if (filter === "unread") return !notification.read_at;
    return notificationPresentation(notification).category === filter;
  });
  const pushOn = preferences.some((preference) => preference.push);
  const emailOn = preferences.some((preference) => preference.email);

  return (
    <div className="flex flex-1 gap-5 p-7 pt-5">
      <main className="flex min-w-0 flex-1 flex-col gap-4">
        <div className="flex items-center gap-2.5">
          <span className="min-w-0">
            <h1 className="text-[18px] font-extrabold text-ink">Notifications</h1>
            <p className="text-[12px] text-muted">
              Everything that needed you, from every corner of the console
            </p>
          </span>
          <span className="flex-1" />
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={() => void markAllRead()}
              className="text-[12.5px] font-bold text-primary hover:text-primary-hover"
            >
              Mark all read
            </button>
          )}
        </div>

        <div className="flex flex-wrap gap-2" aria-label="Notification filters">
          {FILTERS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
              className={`rounded-full px-3.5 py-[7px] text-[12px] font-bold ${
                filter === value
                  ? "bg-primary text-white"
                  : "border-[1.5px] border-[#D6E1F0] bg-card text-ink hover:bg-canvas"
              }`}
            >
              {label}
              {value === "unread" && unreadCount > 0 && (
                <span className={`ml-1 ${filter === value ? "text-white" : "text-danger"}`}>
                  {unreadCount}
                </span>
              )}
            </button>
          ))}
        </div>

        {actionError && (
          <p role="alert" className="rounded-xl bg-danger-bg px-3 py-2 text-[11.5px] text-danger">
            {actionError}
          </p>
        )}

        {filtered.length === 0 && (
          <div className="rounded-2xl border-[1.5px] border-[#D6E1F0] bg-card px-5 py-12 text-center">
            <Bell size={22} strokeWidth={1.6} className="mx-auto text-faint" aria-hidden />
            <p className="mt-2 text-[13px] font-bold text-ink">Nothing in this view</p>
            <p className="text-[11.5px] text-faint">Try another filter or check back later.</p>
          </div>
        )}

        {filtered.map((notification, index) => {
          const presentation = notificationPresentation(notification);
          const Icon = presentation.icon;
          const day = notificationDayKey(notification.created_at);
          const previousDay =
            index > 0 ? notificationDayKey(filtered[index - 1].created_at) : null;
          const showDay = day !== previousDay;
          return (
            <div key={notification.id} className="flex flex-col gap-2">
              {showDay && (
                <span className="font-mono text-[9.5px] font-bold tracking-[.09em] text-faint">
                  {day === "today"
                    ? `TODAY · ${new Date().toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric" }).toUpperCase()}`
                    : day === "yesterday"
                      ? "YESTERDAY"
                      : "EARLIER"}
                </span>
              )}
              <article
                className={`relative flex gap-[13px] rounded-[14px] border-[1.5px] bg-card px-4 py-3.5 ${
                  presentation.urgent && !notification.read_at
                    ? "border-[#EFD9B5]"
                    : "border-[#D6E1F0]"
                }`}
              >
                <span className={`absolute bottom-3.5 left-0 top-3.5 w-[3px] rounded-r ${presentation.accentClassName}`} />
                <span className={`grid size-[38px] flex-none place-items-center rounded-[10px] ${presentation.iconClassName}`}>
                  <Icon size={17} strokeWidth={1.65} aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-[14px] font-bold text-ink">{notification.title}</span>
                    <span className="rounded-[5px] border border-hairline bg-canvas px-[7px] py-0.5 text-[9px] font-bold uppercase tracking-[.04em] text-muted">
                      {presentation.source}
                    </span>
                    {!notification.read_at && <span className="size-[7px] rounded-full bg-primary" />}
                  </span>
                  {notification.body && (
                    <span className="mt-0.5 block text-[12.5px] leading-normal text-muted">
                      {notification.body}
                    </span>
                  )}
                </span>
                <span className="flex flex-none flex-col items-end gap-2.5">
                  <time className="whitespace-nowrap text-[11px] text-faint">
                    {notification.created_at
                      ? new Date(notification.created_at).toLocaleString("en-CA", {
                          month: day === "today" ? undefined : "short",
                          day: day === "today" ? undefined : "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })
                      : "Now"}
                  </time>
                  <Link
                    href={presentation.href}
                    onClick={() => void markRead(notification.id)}
                    className={`whitespace-nowrap rounded-btn px-3.5 py-2 text-[12px] font-bold ${
                      presentation.urgent && notification.kind === "ratio_alert"
                        ? "bg-primary text-white hover:bg-primary-hover"
                        : "border-[1.5px] border-[#D6E1F0] bg-card text-ink hover:bg-canvas"
                    }`}
                  >
                    {presentation.actionLabel}
                  </Link>
                </span>
              </article>
            </div>
          );
        })}
      </main>

      <aside className="flex w-72 flex-none flex-col gap-4">
        <section className="rounded-2xl border-[1.5px] border-[#D6E1F0] bg-card p-4">
          <h2 className="mb-3 text-[14px] font-extrabold text-ink">How you&apos;re notified</h2>
          <DeliveryRow icon={Bell} label="In-app" value="On" active />
          <DeliveryRow icon={Smartphone} label="Push · this phone" value={pushOn ? "On" : "Off"} active={pushOn} />
          <DeliveryRow icon={Mail} label="Email" value={emailOn ? "Daily digest" : "Off"} active={emailOn} />
          <button
            type="button"
            onClick={openSettings}
            className="mt-3 text-[12px] font-bold text-primary hover:text-primary-hover"
          >
            Notification settings →
          </button>
        </section>

        <section className="rounded-2xl border-[1.5px] border-[#D6E1F0] bg-card p-4">
          <h2 className="mb-2.5 text-[14px] font-extrabold text-ink">Muted</h2>
          <MutedRow label="Daily summary" onUnmute={openSettings} />
          <MutedRow label="Family messages · in Messages only" onUnmute={openSettings} />
        </section>

        <section className="rounded-2xl border-[1.5px] border-[#D6E1F0] bg-canvas p-4">
          <div className="flex items-center gap-2">
            <Clock3 size={15} strokeWidth={1.6} className="text-muted" aria-hidden />
            <h2 className="text-[13.5px] font-extrabold text-ink">Quiet hours</h2>
          </div>
          <p className="mt-1.5 text-[12px] leading-normal text-muted">
            {quietHoursEnabled ? "10:00 PM – 6:00 AM · push paused." : "Off · push can arrive any time."}{" "}
            <b className="text-ink">Ratio &amp; incident alerts still ring.</b>
          </p>
          <button
            type="button"
            onClick={openSettings}
            className="mt-2.5 text-[12px] font-bold text-primary hover:text-primary-hover"
          >
            Edit quiet hours →
          </button>
        </section>
      </aside>
    </div>
  );
}
function DeliveryRow({
  icon: Icon,
  label,
  value,
  active,
}: {
  icon: typeof Bell;
  label: string;
  value: string;
  active: boolean;
}) {
  return (
    <div className="flex items-center gap-2.5 py-1.5">
      <Icon size={15} strokeWidth={1.6} className="text-body" aria-hidden />
      <span className="flex-1 text-[12.5px] text-ink">{label}</span>
      <span className={`text-[11px] font-bold ${active ? "text-success" : "text-muted"}`}>{value}</span>
    </div>
  );
}

function MutedRow({ label, onUnmute }: { label: string; onUnmute: () => void }) {
  return (
    <div className="flex items-center gap-2 py-1.5">
      <span className="min-w-0 flex-1 text-[12px] text-muted">{label}</span>
      <button type="button" onClick={onUnmute} className="text-[11.5px] font-bold text-primary">
        Unmute
      </button>
    </div>
  );
}
