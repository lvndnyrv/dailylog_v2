"use client";

import type { RoomLiveStatus } from "@dailylog/db/queries";
import { formatAge, isOverRatio } from "@dailylog/shared";
import Link from "next/link";
import { useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { RoomFormModal } from "./room-form-modal";

const card = "rounded-2xl border border-[rgba(23,51,91,.1)] bg-card p-[18px]";
const cardTitle = "text-[14px] font-extrabold text-ink";
const th = "font-bold text-[10.5px] tracking-[.07em] text-faint";

interface RosterChild {
  id: string;
  first_name: string;
  last_name: string;
  date_of_birth: string | null;
  allergies: string[] | null;
  attendance: {
    checked_in_at: string | null;
    checked_out_at: string | null;
    status: string;
    absence_reason: string | null;
  }[];
}

export function RoomDetailView({
  room,
  roster,
}: {
  room: RoomLiveStatus;
  roster: RosterChild[];
}) {
  const [editing, setEditing] = useState(false);

  const present = Number(room.present_count);
  const educatorCount = room.educators.length;
  const over =
    room.ratio_children_per_educator !== null &&
    isOverRatio(present, educatorCount, room.ratio_children_per_educator);

  const inNow = roster.filter(
    (child) => child.attendance[0]?.checked_in_at && !child.attendance[0]?.checked_out_at,
  ).length;

  return (
    <>
      <div className="flex items-center gap-3.5 border-b-[1.5px] border-hairline bg-card px-7 py-5">
        <Link href="/rooms" aria-label="Back to rooms" className="text-faint hover:text-muted">
          ←
        </Link>
        <span className="grid size-[44px] flex-none place-items-center rounded-full bg-tint text-[16px] font-extrabold text-primary">
          {room.name[0]}
        </span>
        <span className="min-w-0">
          <span className="block text-[20px] font-extrabold text-ink">{room.name}</span>
          <span className="block text-[12.5px] text-muted">
            {room.min_age_months !== null && room.max_age_months !== null
              ? `${room.min_age_months}–${room.max_age_months} mo · `
              : ""}
            {room.capacity ? `capacity ${room.capacity} · ` : ""}
            {room.enrolled_count} enrolled · {inNow} in right now
          </span>
        </span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="rounded-btn bg-primary px-[18px] py-2.5 text-[13px] font-bold text-white hover:bg-primary-hover"
        >
          Edit room
        </button>
      </div>

      <main className="grid flex-1 grid-cols-[1.6fr_1fr] items-start gap-4 p-7">
        <div className="flex min-w-0 flex-col gap-4">
          {/* Live ratio */}
          <section
            className={`${card} ${over ? "border-[#EFC9C9] bg-danger-bg/40" : ""}`}
            aria-labelledby="ratio-h"
          >
            <div className="flex items-center gap-3">
              <span className="min-w-0 flex-1">
                <h2 id="ratio-h" className={cardTitle}>
                  Live ratio
                </h2>
                <span className="text-[12.5px] text-muted">
                  {educatorCount} educator{educatorCount === 1 ? "" : "s"} · {present}{" "}
                  children
                  {room.ratio_children_per_educator !== null &&
                    ` · state minimum 1 : ${room.ratio_children_per_educator}`}
                </span>
              </span>
              <span
                className={`rounded-full px-3 py-1 text-[12px] font-bold ${
                  over ? "bg-danger text-white" : "bg-[#E4F3EC] text-success"
                }`}
              >
                {over ? "Over ratio" : "In ratio"}
              </span>
            </div>
            <p className="mt-2 text-[11.5px] text-faint">
              Updates with every check-in. Staff clock-ins join the count with
              timesheets (Phase 5).
            </p>
          </section>

          {/* Today's roster */}
          <section className={card} aria-labelledby="roster-h">
            <div className="mb-3 flex items-center gap-2">
              <h2 id="roster-h" className={cardTitle}>
                Roster
              </h2>
              <span className="text-[11.5px] text-faint">
                {inNow} of {roster.length} in · a child opens their profile
              </span>
            </div>
            <div className={`grid grid-cols-[1.6fr_.7fr_1fr_1.4fr] gap-2 border-b border-[#EDF3FB] pb-2 ${th}`}>
              <span>CHILD</span>
              <span>AGE</span>
              <span>TODAY</span>
              <span>NOTES</span>
            </div>
            {roster.map((child) => {
              const att = child.attendance[0];
              const state = !att
                ? "No record"
                : att.status === "absent" || att.status === "excused"
                  ? "Out today"
                  : att.checked_out_at
                    ? `Out ${timeOf(att.checked_out_at)}`
                    : att.checked_in_at
                      ? `In since ${timeOf(att.checked_in_at)}`
                      : "Expected";
              return (
                <Link
                  key={child.id}
                  href={`/children/${child.id}`}
                  className="grid grid-cols-[1.6fr_.7fr_1fr_1.4fr] items-center gap-2 border-b border-[#EDF3FB] py-2.5 last:border-b-0 hover:bg-[#F8FBFE]"
                >
                  <span className="flex items-center gap-2.5">
                    <Avatar name={`${child.first_name} ${child.last_name}`} size={28} />
                    <span className="text-[13px] font-bold text-ink">
                      {child.first_name} {child.last_name}
                    </span>
                  </span>
                  <span className="text-[12.5px] text-muted">
                    {child.date_of_birth ? formatAge(child.date_of_birth) : "—"}
                  </span>
                  <span
                    className={`text-[12.5px] ${
                      state.startsWith("In") ? "font-semibold text-success" : "text-muted"
                    }`}
                  >
                    {state}
                  </span>
                  <span className="truncate text-[12.5px] text-muted">
                    {(child.allergies?.length ?? 0) > 0 ? (
                      <span className="font-semibold text-danger">
                        {child.allergies!.join(", ")}
                      </span>
                    ) : (
                      att?.absence_reason ?? "—"
                    )}
                  </span>
                </Link>
              );
            })}
            {roster.length === 0 && (
              <p className="pt-3 text-[12.5px] text-faint">No children in this room yet.</p>
            )}
          </section>
        </div>

        {/* Right rail */}
        <div className="flex min-w-0 flex-col gap-4">
          <section className={card} aria-labelledby="educators-h">
            <h2 id="educators-h" className={`${cardTitle} mb-3`}>
              Educators
            </h2>
            {room.educators.length === 0 ? (
              <p className="text-[12.5px] text-faint">
                No one assigned — send a floater from the rooms page.
              </p>
            ) : (
              <div className="flex flex-col gap-2.5">
                {room.educators.map((educator) => (
                  <div key={educator.id} className="flex items-center gap-2.5">
                    <Avatar name={educator.full_name} size={30} />
                    <span className="flex-1 truncate text-[13px] font-bold text-ink">
                      {educator.full_name}
                    </span>
                    <span className="rounded-full bg-[#E4F3EC] px-2.5 py-[3px] text-[11px] font-bold text-success">
                      Assigned
                    </span>
                  </div>
                ))}
              </div>
            )}
            <p className="mt-2.5 text-[11.5px] text-faint">
              Shift times arrive with scheduling (Phase 5).
            </p>
          </section>

          <section className={card}>
            <h2 className={`${cardTitle} mb-2`}>Room settings</h2>
            <dl className="flex flex-col gap-2">
              <SettingRow label="Age band">
                {room.min_age_months !== null && room.max_age_months !== null
                  ? `${room.min_age_months}–${room.max_age_months} months`
                  : "—"}
              </SettingRow>
              <SettingRow label="Capacity">{room.capacity ?? "—"}</SettingRow>
              <SettingRow label="Ratio">
                {room.ratio_children_per_educator
                  ? `1 : ${room.ratio_children_per_educator}`
                  : "—"}
              </SettingRow>
            </dl>
          </section>
        </div>
      </main>

      {editing && <RoomFormModal room={room} onClose={() => setEditing(false)} />}
    </>
  );
}

function SettingRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-[12.5px] text-muted">{label}</dt>
      <dd className="text-[12.5px] font-semibold text-ink">{children}</dd>
    </div>
  );
}

function timeOf(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString("en-CA", {
    hour: "numeric",
    minute: "2-digit",
  });
}
