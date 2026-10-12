"use client";

import { useState, useTransition } from "react";
import { sendCredentialReminderAction } from "@/lib/dashboard/actions";

export function CredentialReminderButton({
  credentialId,
  staffName,
}: {
  credentialId: string;
  staffName: string;
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<"sent" | "duplicate" | "error" | null>(null);
  return (
    <button
      type="button"
      disabled={pending || result === "sent"}
      title={
        result === "sent"
          ? `Reminder sent to ${staffName}; follow-up scheduled in five days.`
          : result === "duplicate"
            ? "A reminder was already sent today."
            : result === "error"
              ? "The reminder could not be sent."
              : `Send renewal reminder to ${staffName}`
      }
      onClick={() =>
        startTransition(async () => {
          const response = await sendCredentialReminderAction(credentialId, true);
          setResult(response.ok ? "sent" : response.error?.includes("already sent") ? "duplicate" : "error");
        })
      }
      className={`whitespace-nowrap text-[11.5px] font-bold ${
        result === "sent"
          ? "text-success"
          : result === "duplicate"
            ? "text-warning-text"
            : result === "error"
              ? "text-danger"
              : "text-primary hover:text-primary-hover"
      } disabled:opacity-70`}
    >
      {pending ? "Sending…" : result === "sent" ? "Sent ✓" : result === "duplicate" ? "Sent today" : result === "error" ? "Try again" : "Send reminder"}
    </button>
  );
}
