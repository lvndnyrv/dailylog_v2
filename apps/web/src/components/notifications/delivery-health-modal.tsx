"use client";

import type {
  NotificationDeliveryHealth,
  NotificationDeliveryStatus,
  PushDeliveryReachability,
} from "@dailylog/db/queries";
import { Mail, RotateCcw, Smartphone } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { retryNotificationDeliveryAction } from "@/lib/notifications/actions";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Notice } from "@/components/ui/notice";

const STATUS: Record<NotificationDeliveryStatus, { label: string; className: string }> = {
  delivered: { label: "Delivered", className: "bg-success-bg text-success" },
  queued: { label: "Queued", className: "bg-[#E5F0FF] text-primary" },
  retrying: { label: "Retrying", className: "bg-warning-bg text-warning-text" },
  processing: { label: "Sending", className: "bg-[#E5F0FF] text-primary" },
  skipped: { label: "Skipped", className: "bg-canvas text-muted" },
  failed: { label: "Failed", className: "bg-danger-bg text-danger" },
};

export function DeliveryHealthModal({
  health,
  pushReachability,
  onClose,
}: {
  health: NotificationDeliveryHealth;
  pushReachability: PushDeliveryReachability;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const providerSetupNeeded = health.deliveries.some(
    (delivery) => delivery.issue === "Email provider is not configured.",
  );

  const retry = (deliveryId: string) => {
    setError(null);
    setRetryingId(deliveryId);
    startTransition(async () => {
      const result = await retryNotificationDeliveryAction(deliveryId);
      if (result.error) {
        setError(result.error);
        setRetryingId(null);
        return;
      }
      router.refresh();
      onClose();
    });
  };

  return (
    <Modal onClose={onClose} width={720}>
      <div>
        <h2 className="text-[19px] font-extrabold text-ink">Notification delivery</h2>
        <p className="mt-0.5 text-[12.5px] text-muted">
          Push and email activity from the last {health.windowDays} days. Recipient identities stay private.
        </p>
      </div>

      <div className="grid grid-cols-4 gap-2.5">
        <Metric label="Delivered" value={health.counts.delivered} tone="success" />
        <Metric label="Queued" value={health.counts.queued + health.counts.processing} />
        <Metric label="Retrying" value={health.counts.retrying} tone="warning" />
        <Metric label="Needs attention" value={health.counts.failed} tone="danger" />
      </div>

      <section className="rounded-[14px] border-[1.5px] border-[#D6E1F0] bg-canvas p-4">
        <div className="flex items-start gap-4">
          <span className="min-w-0 flex-1">
            <h3 className="text-[13.5px] font-extrabold text-ink">Push reachability</h3>
            <p className="mt-0.5 text-[11px] text-muted">
              {pushReachability.counts.pushReady} of {pushReachability.counts.total} active accounts have a registered device.
            </p>
          </span>
          <span className="rounded-full bg-card px-3 py-1 text-[11px] font-bold text-ink">
            {pushReachability.counts.withoutPush} without push
          </span>
        </div>
        {pushReachability.gaps.length > 0 && (
          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 border-t border-[#D6E1F0] pt-3">
            {pushReachability.gaps.slice(0, 8).map((profile) => (
              <div key={profile.profileId} className="flex min-w-0 items-center gap-2 text-[10.5px]">
                <span className="min-w-0 flex-1 truncate font-bold text-ink">{profile.fullName}</span>
                <span className="text-faint">{profile.role === "parent" ? "Family" : "Staff"}</span>
                <span className={profile.emailPresent ? "text-success" : "text-danger"}>
                  {profile.emailPresent ? "Email on file" : "No fallback"}
                </span>
              </div>
            ))}
            {pushReachability.gaps.length > 8 && (
              <p className="col-span-2 mt-1 text-[10.5px] text-faint">
                + {pushReachability.gaps.length - 8} more accounts without a registered device
              </p>
            )}
          </div>
        )}
      </section>

      {error && <Notice tone="error">{error}</Notice>}
      {providerSetupNeeded && (
        <Notice tone="info">
          <b>Email setup required.</b> Connect the center&apos;s email delivery provider before retrying these messages. Push and in-app delivery continue independently.
        </Notice>
      )}

      <div className="overflow-hidden rounded-[14px] border-[1.5px] border-[#D6E1F0]">
        {health.deliveries.length === 0 ? (
          <p className="px-4 py-10 text-center text-[12.5px] text-muted">
            No external deliveries in this period.
          </p>
        ) : (
          health.deliveries.map((delivery) => {
            const state = STATUS[delivery.status];
            const Icon = delivery.channel === "email" ? Mail : Smartphone;
            const canRetry = delivery.canRetry
              && delivery.issue !== "Email provider is not configured.";
            return (
              <div
                key={delivery.id}
                className="flex items-center gap-3 border-b border-[#EDF3FB] px-4 py-3 last:border-b-0"
              >
                <span className="grid size-9 flex-none place-items-center rounded-[10px] bg-canvas text-body">
                  <Icon size={16} strokeWidth={1.6} aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-bold text-ink">
                    {delivery.title}
                  </span>
                  <span className="block text-[10.5px] text-faint">
                    {delivery.channel === "email" ? "Email" : "Push"} · {new Date(delivery.createdAt).toLocaleString("en-CA", {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                    {delivery.attempts > 0 ? ` · ${delivery.attempts} attempt${delivery.attempts === 1 ? "" : "s"}` : ""}
                  </span>
                  {delivery.issue && (
                    <span className="mt-0.5 block text-[10.5px] text-muted">{delivery.issue}</span>
                  )}
                </span>
                <span className={`rounded-full px-2.5 py-1 text-[9.5px] font-bold ${state.className}`}>
                  {state.label}
                </span>
                {canRetry && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => retry(delivery.id)}
                    className="flex items-center gap-1 rounded-btn border-[1.5px] border-[#D6E1F0] px-2.5 py-1.5 text-[10.5px] font-bold text-primary disabled:opacity-50"
                  >
                    <RotateCcw size={12} strokeWidth={1.8} aria-hidden />
                    {retryingId === delivery.id ? "Queuing…" : "Retry"}
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>

      <p className="text-[10.5px] leading-normal text-faint">
        Skipped push means the recipient has no registered device. Retrying does not create a duplicate in-app notification.
      </p>
      <Button type="button" variant="secondary" onClick={onClose} className="self-end px-7">
        Close
      </Button>
    </Modal>
  );
}

function Metric({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number;
  tone?: "neutral" | "success" | "warning" | "danger";
}) {
  const color = tone === "success"
    ? "text-success"
    : tone === "warning"
      ? "text-warning-text"
      : tone === "danger"
        ? "text-danger"
        : "text-ink";
  return (
    <div className="rounded-[12px] bg-canvas px-3 py-2.5">
      <span className="block text-[9px] font-bold uppercase tracking-[.06em] text-faint">{label}</span>
      <span className={`text-[18px] font-extrabold ${color}`}>{value}</span>
    </div>
  );
}
