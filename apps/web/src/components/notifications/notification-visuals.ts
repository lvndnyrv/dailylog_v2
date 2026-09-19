import type { NotificationRow } from "@dailylog/db/queries";
import type { Json } from "@dailylog/db";
import {
  Award,
  CalendarClock,
  CircleDollarSign,
  ClipboardList,
  ReceiptText,
  MessageCircle,
  ShieldAlert,
  Smartphone,
  TriangleAlert,
  UsersRound,
  type LucideIcon,
} from "lucide-react";

export type NotificationCategory =
  | "alerts"
  | "compliance"
  | "sessions"
  | "billing"
  | "enrollment";

export interface NotificationPresentation {
  icon: LucideIcon;
  iconClassName: string;
  accentClassName: string;
  category: NotificationCategory;
  source: string;
  href: string;
  actionLabel: string;
  urgent: boolean;
}

function payloadRecord(payload: Json | null): Record<string, Json | undefined> {
  if (!payload || Array.isArray(payload) || typeof payload !== "object") return {};
  return payload;
}

function payloadString(payload: Json | null, key: string): string | null {
  const value = payloadRecord(payload)[key];
  return typeof value === "string" ? value : null;
}

export function notificationPresentation(
  notification: NotificationRow,
): NotificationPresentation {
  const payload = notification.payload;
  const overrides = {
    source: payloadString(payload, "source"),
    href: payloadString(payload, "href"),
    actionLabel: payloadString(payload, "action_label"),
  };

  switch (notification.kind) {
    case "parent_messages": {
      const childId = payloadString(payload, "childId");
      return {
        icon: MessageCircle,
        iconClassName: "bg-tint text-primary",
        accentClassName: "bg-primary",
        category: "alerts",
        source: overrides.source ?? "Messages",
        href: overrides.href ?? (childId
          ? `/messages?child=${encodeURIComponent(childId)}`
          : "/messages"),
        actionLabel: overrides.actionLabel ?? "Open conversation",
        urgent: false,
      };
    }
    case "staff_message":
      return {
        icon: MessageCircle,
        iconClassName: "bg-tint text-primary",
        accentClassName: "bg-primary",
        category: "alerts",
        source: overrides.source ?? "Staff message",
        href: overrides.href ?? "/staff",
        actionLabel: overrides.actionLabel ?? "Open message",
        urgent: false,
      };
    case "ratio_alert":
      return {
        icon: TriangleAlert,
        iconClassName: "bg-danger-bg text-danger",
        accentClassName: "bg-danger",
        category: "alerts",
        source: overrides.source ?? "Rooms & ratios",
        href: overrides.href ?? "/rooms",
        actionLabel: overrides.actionLabel ?? "Assign floater",
        urgent: true,
      };
    case "incident_report":
      return {
        icon: ClipboardList,
        iconClassName: "bg-warning-bg text-warning-text",
        accentClassName: "bg-warning",
        category: "alerts",
        source: overrides.source ?? "Dashboard",
        href: overrides.href ?? "/dashboard?review=incident",
        actionLabel: overrides.actionLabel ?? "Review",
        urgent: true,
      };
    case "pickup_security": {
      const childId = payloadString(payload, "childId");
      return {
        icon: ShieldAlert,
        iconClassName: "bg-danger-bg text-danger",
        accentClassName: "bg-danger",
        category: "alerts",
        source: overrides.source ?? "Pickup safety",
        href: overrides.href ?? (childId
          ? `/children/${encodeURIComponent(childId)}#pickup-safety`
          : "/children"),
        actionLabel: overrides.actionLabel ?? "Review alert",
        urgent: true,
      };
    }
    case "parent_document_review": {
      const childId = payloadString(payload, "childId");
      const requestId = payloadString(payload, "requestId");
      const documentAnchor = requestId
        ? `family-document-${encodeURIComponent(requestId)}`
        : "family-documents";
      return {
        icon: ClipboardList,
        iconClassName: "bg-tint text-primary",
        accentClassName: "bg-primary",
        category: "alerts",
        source: overrides.source ?? "Child documents",
        href: overrides.href ?? (childId
          ? `/children/${encodeURIComponent(childId)}#${documentAnchor}`
          : "/children"),
        actionLabel: overrides.actionLabel ?? "Review document",
        urgent: false,
      };
    }
    case "time_off_request":
      return {
        icon: CalendarClock,
        iconClassName: "bg-warning-bg text-warning-text",
        accentClassName: "bg-warning",
        category: "alerts",
        source: overrides.source ?? "Staff · Time off",
        href: overrides.href ?? "/staff?tab=time-off",
        actionLabel: overrides.actionLabel ?? "Review request",
        urgent: true,
      };
    case "coverage_response":
    case "coverage_review":
      return {
        icon: UsersRound,
        iconClassName: "bg-warning-bg text-warning-text",
        accentClassName: "bg-warning",
        category: "alerts",
        source: overrides.source ?? "Rooms & ratios",
        href: overrides.href ?? "/rooms",
        actionLabel: overrides.actionLabel ?? "Review coverage",
        urgent: notification.kind === "coverage_review"
          || payloadString(payload, "response") === "declined",
      };
    case "new_device_sign_in":
      return {
        icon: Smartphone,
        iconClassName: "bg-[#EEF3FA] text-body",
        accentClassName: "bg-faint",
        category: "sessions",
        source: overrides.source ?? "Security",
        href: overrides.href ?? "/settings#security",
        actionLabel: overrides.actionLabel ?? "Review devices",
        urgent: false,
      };
    case "compliance_due":
      return {
        icon: CalendarClock,
        iconClassName: "bg-warning-bg text-warning-text",
        accentClassName: "bg-warning",
        category: "compliance",
        source: overrides.source ?? "Compliance",
        href: overrides.href ?? "/compliance",
        actionLabel: overrides.actionLabel ?? "Review compliance",
        urgent: payloadString(payload, "severity") === "critical",
      };
    case "cert_expiry":
      return {
        icon: Award,
        iconClassName: "bg-warning-bg text-warning-text",
        accentClassName: "bg-warning",
        category: "compliance",
        source: overrides.source ?? "Compliance",
        href: overrides.href ?? "/compliance",
        actionLabel: overrides.actionLabel ?? "Send reminder",
        urgent: false,
      };
    case "credential_review":
      return {
        icon: Award,
        iconClassName: "bg-warning-bg text-warning-text",
        accentClassName: "bg-warning",
        category: "compliance",
        source: overrides.source ?? "Compliance",
        href: overrides.href ?? "/staff",
        actionLabel: overrides.actionLabel ?? "Review renewal",
        urgent: true,
      };
    case "payment_received":
      return {
        icon: CircleDollarSign,
        iconClassName: "bg-[#E4F3EC] text-success",
        accentClassName: "bg-success",
        category: "billing",
        source: overrides.source ?? "Billing",
        href: overrides.href ?? "/billing",
        actionLabel: overrides.actionLabel ?? "View",
        urgent: false,
      };
    case "overdue_billing":
      return {
        icon: ReceiptText,
        iconClassName: "bg-danger-bg text-danger",
        accentClassName: "bg-danger",
        category: "billing",
        source: overrides.source ?? "Billing",
        href: overrides.href ?? "/billing",
        actionLabel: overrides.actionLabel ?? "Review invoices",
        urgent: false,
      };
    default:
      return {
        icon: UsersRound,
        iconClassName: "bg-tint text-primary",
        accentClassName: "bg-primary",
        category: "enrollment",
        source: overrides.source ?? "Enrollment",
        href: overrides.href ?? "/enrollment",
        actionLabel: overrides.actionLabel ?? "Review",
        urgent: false,
      };
  }
}

export function relativeNotificationTime(createdAt: string | null): string {
  if (!createdAt) return "now";
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h`;
  if (minutes < 2880) return "1d";
  return `${Math.floor(minutes / 1440)}d`;
}

export function notificationDayKey(createdAt: string | null): "today" | "yesterday" | "earlier" {
  if (!createdAt) return "today";
  const date = new Date(createdAt);
  const today = new Date();
  const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const startThatDay = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const dayDifference = Math.round((startToday - startThatDay) / 86400000);
  if (dayDifference <= 0) return "today";
  if (dayDifference === 1) return "yesterday";
  return "earlier";
}
