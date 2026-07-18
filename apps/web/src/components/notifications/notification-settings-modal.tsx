"use client";

import { Check, Clock3, LockKeyhole } from "lucide-react";
import { useState, useTransition } from "react";
import { saveNotificationPreferencesAction } from "@/lib/notifications/actions";
import type {
  NotificationPreferenceInput,
  NotificationPreferenceKind,
} from "@/lib/notifications/config";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Notice } from "@/components/ui/notice";

const LABELS: Record<NotificationPreferenceKind, { title: string; detail?: string }> = {
  ratio_alert: { title: "Ratio alerts", detail: "Required by the center" },
  incident_report: { title: "Incident reports" },
  cert_expiry: { title: "Cert & license expiry" },
  overdue_billing: { title: "Overdue billing" },
  new_device_sign_in: { title: "New device sign-in", detail: "Security" },
  waitlist_enrollment: { title: "Waitlist & enrollment" },
};

export function NotificationSettingsModal({
  preferences,
  quietHoursEnabled,
  onSaved,
  onClose,
}: {
  preferences: NotificationPreferenceInput[];
  quietHoursEnabled: boolean;
  onSaved: (preferences: NotificationPreferenceInput[], quietHoursEnabled: boolean) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(preferences);
  const [quietHours, setQuietHours] = useState(quietHoursEnabled);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const setChannel = (
    kind: NotificationPreferenceKind,
    channel: "inApp" | "push" | "email",
    checked: boolean,
  ) => {
    setDraft((current) =>
      current.map((preference) =>
        preference.kind === kind ? { ...preference, [channel]: checked } : preference,
      ),
    );
  };

  const save = () => {
    setError(null);
    startTransition(async () => {
      const result = await saveNotificationPreferencesAction({
        preferences: draft,
        quietHoursEnabled: quietHours,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      onSaved(draft, quietHours);
      onClose();
    });
  };

  return (
    <Modal onClose={onClose} width={468}>
      <div>
        <h2 className="text-[19px] font-extrabold text-ink">Notification settings</h2>
        <p className="mt-0.5 text-[12.5px] leading-normal text-muted">
          Your account only. Center defaults for new admins live in Settings.
        </p>
      </div>

      <div className="flex items-center gap-2.5 px-0.5">
        <span className="flex-1" />
        {[
          ["inApp", "IN-APP"],
          ["push", "PUSH"],
          ["email", "EMAIL"],
        ].map(([key, label]) => (
          <span
            key={key}
            className="w-[52px] text-center font-mono text-[9.5px] font-bold tracking-[.03em] text-faint"
          >
            {label}
          </span>
        ))}
      </div>

      <div className="flex flex-col">
        {draft.map((preference) => {
          const label = LABELS[preference.kind];
          return (
            <div
              key={preference.kind}
              className="flex items-center gap-2.5 border-t border-[#EDF3FB] px-0.5 py-2.5 last:border-b"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-bold text-ink">{label.title}</span>
                {label.detail && (
                  <span className="block text-[11px] text-faint">{label.detail}</span>
                )}
              </span>
              <ChannelToggle
                label={`${label.title} in-app`}
                checked={preference.inApp}
                disabled={preference.kind === "ratio_alert"}
                onChange={(checked) => setChannel(preference.kind, "inApp", checked)}
              />
              <ChannelToggle
                label={`${label.title} push`}
                checked={preference.push}
                locked={preference.kind === "ratio_alert"}
                disabled={preference.kind === "ratio_alert"}
                onChange={(checked) => setChannel(preference.kind, "push", checked)}
              />
              <ChannelToggle
                label={`${label.title} email`}
                checked={preference.email}
                onChange={(checked) => setChannel(preference.kind, "email", checked)}
              />
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-3 rounded-[14px] border-[1.5px] border-[#D6E1F0] bg-canvas px-3.5 py-3">
        <Clock3 size={16} strokeWidth={1.6} className="text-muted" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block text-[12.5px] font-bold text-ink">Quiet hours · 10 PM – 6 AM</span>
          <span className="block text-[11px] text-muted">
            Pauses push. Ratio &amp; incident alerts still ring.
          </span>
        </span>
        <label>
          <span className="sr-only">Enable quiet hours</span>
          <input
            type="checkbox"
            checked={quietHours}
            onChange={(event) => setQuietHours(event.target.checked)}
            className="peer sr-only"
          />
          <span className="relative block h-[22px] w-[38px] rounded-full bg-[#D6E1F0] transition-colors peer-checked:bg-primary after:absolute after:left-0.5 after:top-0.5 after:size-[18px] after:rounded-full after:bg-white after:transition-transform peer-checked:after:translate-x-4" />
        </label>
      </div>

      {error && <Notice tone="error">{error}</Notice>}

      <div className="flex gap-2.5">
        <Button type="button" variant="secondary" onClick={onClose} className="flex-1 py-3 text-sm">
          Cancel
        </Button>
        <Button type="button" onClick={save} disabled={pending} className="flex-1 py-3 text-sm">
          {pending ? "Saving…" : "Save preferences"}
        </Button>
      </div>
    </Modal>
  );
}
function ChannelToggle({
  label,
  checked,
  disabled = false,
  locked = false,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  locked?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="grid w-[52px] place-items-center">
      <span className="sr-only">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="peer sr-only"
      />
      <span
        className={`grid size-6 place-items-center rounded-[7px] border-[1.5px] transition-colors ${
          locked
            ? "border-[#EFD9B5] bg-warning-bg text-warning-text"
            : checked
              ? "border-primary bg-primary text-white"
              : "border-[#D6E1F0] bg-card text-transparent"
        } ${disabled ? "cursor-not-allowed" : "cursor-pointer"}`}
      >
        {locked ? (
          <LockKeyhole size={11} strokeWidth={1.8} aria-hidden />
        ) : (
          <Check size={13} strokeWidth={2.2} aria-hidden />
        )}
      </span>
    </label>
  );
}
