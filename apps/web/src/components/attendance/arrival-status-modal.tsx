"use client";

import type { AttendanceDayRow } from "@dailylog/db/queries";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Notice } from "@/components/ui/notice";
import { setArrivalStatusAction } from "@/lib/attendance/actions";

const choices = [
  {
    value: "late",
    label: "Coming later",
    detail: "Shows the blue Coming badge and keeps the child in the arrival list.",
  },
  {
    value: "sick",
    label: "Sick today",
    detail: "Records an absence and shows the Sick badge.",
  },
  {
    value: "excused",
    label: "Excused or vacation",
    detail: "Records an excused absence for today.",
  },
  {
    value: "no_response",
    label: "No response yet",
    detail: "Clears the response and returns the child to follow-up status.",
  },
] as const;

export function ArrivalStatusModal({
  child,
  date,
  onClose,
}: {
  child: AttendanceDayRow;
  date: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const attendance = child.attendance[0];
  const initial =
    attendance?.status === "late"
      ? "late"
      : attendance?.status === "excused"
        ? "excused"
        : attendance?.status === "absent" &&
            attendance.absence_reason?.toLowerCase().includes("sick")
          ? "sick"
          : "no_response";
  const [response, setResponse] = useState<(typeof choices)[number]["value"]>(initial);
  const [note, setNote] = useState(attendance?.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const save = () => {
    setError(null);
    const formData = new FormData();
    formData.set("child_id", child.id);
    formData.set("date", date);
    formData.set("response", response);
    formData.set("note", note);

    startTransition(async () => {
      const result = await setArrivalStatusAction(formData);
      if (result.error) {
        setError(result.error);
        return;
      }
      onClose();
      router.refresh();
    });
  };

  return (
    <Modal onClose={onClose} width={440}>
      <div>
        <h2 className="text-[19px] font-extrabold text-ink">Record family response</h2>
        <p className="mt-0.5 text-[12.5px] leading-normal text-muted">
          Update {child.first_name}&apos;s arrival status for today. Parent reporting
          will feed these same states when that flow is added.
        </p>
      </div>

      <div className="flex flex-col gap-2" role="radiogroup" aria-label="Arrival status">
        {choices.map((choice) => (
          <label
            key={choice.value}
            className={`flex cursor-pointer gap-3 rounded-[13px] border-[1.5px] px-3.5 py-3 transition-colors ${
              response === choice.value
                ? "border-primary bg-tint"
                : "border-[#D6E1F0] bg-card hover:bg-canvas"
            }`}
          >
            <input
              type="radio"
              name="arrival-response"
              value={choice.value}
              checked={response === choice.value}
              onChange={() => setResponse(choice.value)}
              className="mt-0.5 accent-primary"
            />
            <span>
              <span className="block text-[13px] font-bold text-ink">{choice.label}</span>
              <span className="mt-0.5 block text-[11.5px] leading-normal text-muted">
                {choice.detail}
              </span>
            </span>
          </label>
        ))}
      </div>

      {(response === "late" || response === "excused") && (
        <label className="flex flex-col gap-[7px]">
          <span className="text-[13px] font-bold text-ink">
            {response === "late" ? "Family message or ETA" : "Reason"} <i className="font-normal text-faint">optional</i>
          </span>
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={2}
            placeholder={response === "late" ? "Running late — there by 10" : "Vacation this week"}
            className="resize-none rounded-[13px] border-[1.5px] border-[#D6E1F0] bg-card px-4 py-3 text-[13px] text-ink outline-none placeholder:text-faint focus:border-primary"
          />
        </label>
      )}

      {error && <Notice tone="error">{error}</Notice>}

      <div className="flex gap-2.5">
        <Button type="button" variant="secondary" className="flex-1 py-3 text-sm" onClick={onClose}>
          Cancel
        </Button>
        <Button type="button" className="flex-1 py-3 text-sm" disabled={pending} onClick={save}>
          {pending ? "Saving…" : "Save response"}
        </Button>
      </div>
    </Modal>
  );
}
