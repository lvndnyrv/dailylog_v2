"use client";

import type { StaffRow } from "@dailylog/db/queries";
import { Check, Download, Mail, MapPin, X } from "lucide-react";
import { useActionState, useEffect, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Notice } from "@/components/ui/notice";
import {
  bulkAssignStaffRoomAction,
  bulkMessageStaffAction,
  type StaffBulkActionState,
} from "@/lib/staff/actions";

export function StaffBulkActions({
  selected,
  classrooms,
  onClear,
}: {
  selected: StaffRow[];
  classrooms: { id: string; name: string }[];
  onClear: () => void;
}) {
  const [dialog, setDialog] = useState<"message" | "room" | null>(null);
  if (selected.length === 0) return null;

  const exportCsv = () => {
    const rows = [
      ["Name", "Email", "Role", "Job title", "Room", "Employment", "Start date", "Status"],
      ...selected.map((member) => [
        member.profile?.full_name ?? "",
        member.profile?.email ?? "",
        member.profile?.role ?? "",
        member.job_title ?? "",
        member.profile?.classroom?.name ?? "Floater",
        member.employment_type ?? "",
        member.started_on ?? "",
        member.status,
      ]),
    ];
    const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `dailylog-staff-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 rounded-[14px] bg-ink px-3.5 py-3 shadow-[0_6px_20px_rgba(23,51,91,.22)]">
        <span className="grid size-6 place-items-center rounded-md bg-primary text-white"><Check size={14} strokeWidth={2.5} /></span>
        <span className="text-[13px] font-bold text-white">{selected.length} selected</span>
        <span className="flex-1" />
        <ToolbarButton icon={Mail} label="Message" onClick={() => setDialog("message")} />
        <ToolbarButton icon={MapPin} label="Assign room" onClick={() => setDialog("room")} />
        <ToolbarButton icon={Download} label="Export" onClick={exportCsv} />
        <button type="button" onClick={onClear} className="flex items-center gap-1 px-1.5 py-1.5 text-[12px] font-bold text-[#B7C4D6] hover:text-white"><X size={14} /> Clear</button>
      </div>
      {dialog === "message" && <BulkMessageModal selected={selected} onClose={() => setDialog(null)} onComplete={onClear} />}
      {dialog === "room" && <BulkRoomModal selected={selected} classrooms={classrooms} onClose={() => setDialog(null)} onComplete={onClear} />}
    </>
  );
}

function ToolbarButton({ icon: Icon, label, onClick }: { icon: typeof Mail; label: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-[12px] font-bold text-white hover:bg-white/20"><Icon size={14} />{label}</button>;
}

function BulkMessageModal({ selected, onClose, onComplete }: { selected: StaffRow[]; onClose: () => void; onComplete: () => void }) {
  const [state, action, pending] = useActionState<StaffBulkActionState, FormData>(bulkMessageStaffAction, {});
  useEffect(() => {
    if (state.ok) {
      onComplete();
      onClose();
    }
  }, [onClose, onComplete, state.ok]);
  return (
    <Modal onClose={onClose} width={470}>
      <div><h2 className="text-[19px] font-extrabold text-ink">Message {selected.length} staff member{selected.length === 1 ? "" : "s"}</h2><p className="mt-1 text-[12.5px] text-muted">A private copy is sent to each person. Recipients never see who else was selected.</p></div>
      <form action={action} className="flex flex-col gap-4">
        {selected.map((member) => <input key={member.profile!.id} type="hidden" name="profile_ids" value={member.profile!.id} />)}
        <div className="flex flex-wrap gap-1.5">{selected.map((member) => <span key={member.id} className="rounded-full bg-tint px-2.5 py-1 text-[11px] font-bold text-primary">{member.profile!.full_name}</span>)}</div>
        <label className="flex flex-col gap-1.5 text-[13px] font-bold text-ink">Message<textarea name="body" required maxLength={4000} rows={5} placeholder="Schedule update, room coverage, or staff follow-up…" className="resize-none rounded-[13px] border-[1.5px] border-[#D6E1F0] px-3.5 py-3 text-[13px] font-normal leading-relaxed outline-none focus:border-primary" /></label>
        {state.error && <Notice tone="error">{state.error}</Notice>}
        <div className="flex justify-end gap-2.5"><button type="button" onClick={onClose} className="rounded-btn border-[1.5px] border-[#D6E1F0] px-5 py-2.5 text-[13px] font-bold text-ink">Cancel</button><button type="submit" disabled={pending} className="rounded-btn bg-primary px-5 py-2.5 text-[13px] font-bold text-white disabled:opacity-60">{pending ? "Sending…" : "Send privately"}</button></div>
      </form>
    </Modal>
  );
}

function BulkRoomModal({ selected, classrooms, onClose, onComplete }: { selected: StaffRow[]; classrooms: { id: string; name: string }[]; onClose: () => void; onComplete: () => void }) {
  const educators = selected.filter((member) => member.profile?.role === "educator");
  const nonEducators = selected.length - educators.length;
  const [state, action, pending] = useActionState<StaffBulkActionState, FormData>(bulkAssignStaffRoomAction, {});
  useEffect(() => {
    if (state.ok) {
      onComplete();
      onClose();
    }
  }, [onClose, onComplete, state.ok]);
  return (
    <Modal onClose={onClose} width={450}>
      <div><h2 className="text-[19px] font-extrabold text-ink">Assign a primary room</h2><p className="mt-1 text-[12.5px] text-muted">This replaces each selected educator&apos;s permanent room access. Choose Floater to remove a permanent assignment.</p></div>
      {nonEducators > 0 && <Notice tone="info">{nonEducators} administrator{nonEducators === 1 ? " is" : "s are"} excluded because room assignment applies only to educators.</Notice>}
      <form action={action} className="flex flex-col gap-4">
        {educators.map((member) => <input key={member.id} type="hidden" name="staff_ids" value={member.id} />)}
        <label className="flex flex-col gap-1.5 text-[13px] font-bold text-ink">Room<select name="classroom_id" className="rounded-[13px] border-[1.5px] border-[#D6E1F0] bg-white px-3.5 py-3 text-[13px] font-normal outline-none focus:border-primary"><option value="">Floater · no permanent room</option>{classrooms.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}</select></label>
        <p className="text-[11.5px] text-faint">Updating {educators.length} educator{educators.length === 1 ? "" : "s"}. Changes apply immediately to roster and child access.</p>
        {state.error && <Notice tone="error">{state.error}</Notice>}
        <div className="flex justify-end gap-2.5"><button type="button" onClick={onClose} className="rounded-btn border-[1.5px] border-[#D6E1F0] px-5 py-2.5 text-[13px] font-bold text-ink">Cancel</button><button type="submit" disabled={pending || educators.length === 0} className="rounded-btn bg-primary px-5 py-2.5 text-[13px] font-bold text-white disabled:opacity-60">{pending ? "Assigning…" : "Assign room"}</button></div>
      </form>
    </Modal>
  );
}

function csvCell(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}
