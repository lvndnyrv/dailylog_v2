"use client";

import Link from "next/link";
import { Settings2 } from "lucide-react";
import { useState } from "react";
import { useNotificationCenter } from "./notification-center";
import {
  notificationDayKey,
  notificationPresentation,
  relativeNotificationTime,
} from "./notification-visuals";

type TrayFilter = "all" | "alerts" | "sessions";

export function NotificationTray({ onClose }: { onClose: () => void }) {
  const {
    notifications,
    unreadCount,
    actionError,
    markRead,
    markAllRead,
    openSettings,
  } = useNotificationCenter();
  const [filter, setFilter] = useState<TrayFilter>("all");

  const filtered = notifications
    .filter((notification) => {
      if (filter === "all") return true;
      return notificationPresentation(notification).category === filter;
    })
    .slice(0, 6);

  return (
    <div
      className="absolute right-0 top-[48px] z-40 flex w-[372px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border-[1.5px] border-hairline bg-card"
      style={{ boxShadow: "0 16px 44px rgba(23,51,91,.22)" }}
      role="dialog"
      aria-label="Notifications"
    >
      <span
        aria-hidden
        className="absolute -top-2 right-[98px] size-[15px] rotate-45 border-l-[1.5px] border-t-[1.5px] border-hairline bg-card"
      />
      <div className="flex items-center gap-2 px-4 pb-2.5 pt-3.5">
        <span className="text-[15px] font-extrabold text-ink">Notifications</span>
        {unreadCount > 0 && (
          <span className="rounded-full bg-danger-bg px-2 py-0.5 text-[10.5px] font-bold text-danger">
            {unreadCount} new
          </span>
        )}
        <span className="flex-1" />
        {unreadCount > 0 && (
          <button
            type="button"
            onClick={() => void markAllRead()}
            className="text-[11.5px] font-bold text-primary hover:text-primary-hover"
          >
            Mark all read
          </button>
        )}
      </div>

      <div className="flex gap-1.5 border-b border-[#EDF3FB] px-4 pb-2.5">
        {(["all", "alerts", "sessions"] as TrayFilter[]).map((value) => (
          <button
            type="button"
            key={value}
            onClick={() => setFilter(value)}
            className={`rounded-full px-3 py-[5px] text-[11px] font-bold capitalize ${
              filter === value
                ? "bg-primary text-white"
                : "border-[1.5px] border-hairline bg-canvas text-muted hover:bg-[#EDF3FB]"
            }`}
          >
            {value}
          </button>
        ))}
      </div>

      <div className="flex max-h-[296px] flex-col overflow-y-auto px-2 pb-1.5 pt-2">
        {filtered.length === 0 && (
          <p className="px-3 py-8 text-center text-[12px] text-faint">
            Nothing in this view yet.
          </p>
        )}
        {filtered.map((notification, index) => {
          const presentation = notificationPresentation(notification);
          const Icon = presentation.icon;
          const day = notificationDayKey(notification.created_at);
          const previousDay =
            index > 0 ? notificationDayKey(filtered[index - 1].created_at) : null;
          const showDay = day !== previousDay;
          return (
            <div key={notification.id}>
              {showDay && (
                <span className="block px-2 pb-[3px] pt-[5px] font-mono text-[9.5px] font-bold tracking-[.09em] text-faint">
                  {day === "today" ? "TODAY" : day === "yesterday" ? "YESTERDAY" : "EARLIER"}
                </span>
              )}
              <Link
                href={presentation.href}
                onClick={() => {
                  void markRead(notification.id);
                  onClose();
                }}
                className={`flex gap-[11px] rounded-[11px] px-[9px] py-2.5 hover:bg-canvas ${
                  notification.read_at ? "" : "bg-[#F5F9FE]"
                }`}
              >
                <span className={`grid size-8 flex-none place-items-center rounded-[9px] ${presentation.iconClassName}`}>
                  <Icon size={15} strokeWidth={1.65} aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-bold text-ink">{notification.title}</span>
                  {notification.body && (
                    <span className={`block text-[11.5px] leading-[1.4] ${notification.read_at ? "text-faint" : "text-muted"}`}>
                      {notification.body}
                    </span>
                  )}
                </span>
                <span className="flex flex-none flex-col items-end gap-[5px] text-[10.5px] text-faint">
                  {relativeNotificationTime(notification.created_at)}
                  {!notification.read_at && <span className="size-[7px] rounded-full bg-primary" />}
                </span>
              </Link>
            </div>
          );
        })}
        {actionError && (
          <p role="alert" className="px-3 py-2 text-[11px] text-danger">
            {actionError}
          </p>
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-[#EDF3FB] bg-[#FAFCFE] px-3.5 py-[11px]">
        <Link
          href="/notifications"
          onClick={onClose}
          className="text-[12px] font-bold text-primary hover:text-primary-hover"
        >
          See all activity
        </Link>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => {
            onClose();
            openSettings();
          }}
          className="flex items-center gap-1.5 text-[12px] font-bold text-muted hover:text-ink"
        >
          <Settings2 size={13} strokeWidth={1.6} aria-hidden />
          Settings
        </button>
      </div>
    </div>
  );
}
