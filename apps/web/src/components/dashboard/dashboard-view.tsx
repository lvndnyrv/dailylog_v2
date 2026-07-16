"use client";

import type {
  AttendanceDayRow,
  BillingSummary,
  IncidentRow,
  RoomLiveStatus,
} from "@dailylog/db/queries";
import { initials, isOverRatio } from "@dailylog/shared";
import Link from "next/link";
import { useState } from "react";
import { SignOffModal } from "@/components/incidents/sign-off-modal";

const card = "rounded-2xl border border-[rgba(23,51,91,.1)] bg-card p-[18px]";
const tileLabel = "font-mono text-[10.5px] font-semibold tracking-[.08em] text-faint";

export function DashboardView({
  rooms,
  incidents,
  attendance,
  billing,
}: {
  rooms: RoomLiveStatus[];
  incidents: IncidentRow[];
  attendance: AttendanceDayRow[];
  billing: BillingSummary | null;
}) {
  const [signing, setSigning] = useState<IncidentRow | null>(null);

  const enrolled = attendance.length;
  const inToday = attendance.filter((row) => row.attendance[0]?.checked_in_at).length;
  const expectedLater = attendance.filter((row) => {
    const att = row.attendance[0];
    return !att?.checked_in_at && att?.status !== "absent" && att?.status !== "excused";
  }).length;

  const overRooms = rooms.filter(
    (room) =>
      room.ratio_children_per_educator !== null &&
      isOverRatio(
        Number(room.present_count),
        room.educators.length,
        room.ratio_children_per_educator,
      ),
  );
  const educatorIds = new Set(rooms.flatMap((room) => room.educators.map((e) => e.id)));
  const attention = overRooms.length + incidents.length;

  return (
    <div className="flex flex-1 flex-col gap-4 p-7">
      {/* Stat tiles */}
      <div className="grid grid-cols-4 gap-3">
        <Link href="/attendance" className={`${card} hover:bg-[#F8FBFE]`}>
          <span className={tileLabel}>CHILDREN IN TODAY</span>
          <span className="mt-1 block text-[26px] font-extrabold text-ink">
            {inToday} <span className="text-[15px] font-bold text-faint">/ {enrolled}</span>
          </span>
          <span className="text-[11.5px] text-muted">
            {expectedLater > 0 ? `${expectedLater} expected later` : "everyone accounted for"}
          </span>
        </Link>
        <Link href="/staff" className={`${card} hover:bg-[#F8FBFE]`}>
          <span className={tileLabel}>EDUCATORS ASSIGNED</span>
          <span className="mt-1 block text-[26px] font-extrabold text-ink">
            {educatorIds.size}
          </span>
          <span className="text-[11.5px] text-muted">
            clock-ins arrive with timesheets
          </span>
        </Link>
        <Link href="/rooms" className={`${card} hover:bg-[#F8FBFE]`}>
          <span className={tileLabel}>ROOMS IN RATIO</span>
          <span
            className={`mt-1 block text-[26px] font-extrabold ${
              overRooms.length ? "text-danger" : "text-ink"
            }`}
          >
            {rooms.length - overRooms.length}{" "}
            <span className="text-[15px] font-bold text-faint">/ {rooms.length}</span>
          </span>
          <span className="text-[11.5px] text-muted">
            {overRooms.length
              ? `${overRooms[0].name} needs a floater`
              : "all rooms compliant"}
          </span>
        </Link>
        <Link href="/billing" className={`${card} hover:bg-[#F8FBFE]`}>
          <span className={tileLabel}>OUTSTANDING BALANCES</span>
          <span
            className={`mt-1 block text-[26px] font-extrabold ${
              Number(billing?.overdue_count ?? 0) > 0 ? "text-danger" : "text-ink"
            }`}
          >
            {((Number(billing?.outstanding_cents ?? 0)) / 100).toLocaleString("en-CA", {
              style: "currency",
              currency: "CAD",
            })}
          </span>
          <span className="text-[11.5px] text-muted">
            {Number(billing?.overdue_count ?? 0)} invoice
            {Number(billing?.overdue_count ?? 0) === 1 ? "" : "s"} overdue
          </span>
        </Link>
      </div>

      <div className="grid grid-cols-[1.5fr_1fr] items-start gap-4">
        {/* Needs your attention */}
        <section className={card} aria-labelledby="attention-h">
          <div className="mb-3 flex items-center gap-2">
            <h2 id="attention-h" className="text-[14px] font-extrabold text-ink">
              Needs your attention
            </h2>
            {attention > 0 && (
              <span className="grid size-5 place-items-center rounded-full bg-danger-bg text-[11px] font-bold text-danger">
                {attention}
              </span>
            )}
          </div>

          {attention === 0 && (
            <p className="text-[12.5px] text-faint">
              Nothing waiting on you — rooms are in ratio and every report is signed.
            </p>
          )}

          <div className="flex flex-col gap-3">
            {overRooms.map((room) => (
              <div key={room.id} className="flex items-center gap-3 rounded-xl border border-[#EFC9C9] bg-danger-bg/40 px-3.5 py-3">
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-bold text-ink">
                    {room.name} is over ratio
                  </span>
                  <span className="block text-[11.5px] text-muted">
                    {room.present_count} children with {room.educators.length} educator
                    {room.educators.length === 1 ? "" : "s"} — licensing requires 1:
                    {room.ratio_children_per_educator}
                  </span>
                </span>
                <Link
                  href="/rooms"
                  className="whitespace-nowrap rounded-btn bg-primary px-3.5 py-2 text-xs font-bold text-white hover:bg-primary-hover"
                >
                  Assign floater
                </Link>
              </div>
            ))}

            {incidents.map((incident) => (
              <div key={incident.id} className="flex items-center gap-3 rounded-xl border border-[#F0E2C4] bg-warning-bg/50 px-3.5 py-3">
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-bold text-ink">
                    Incident report awaiting your sign-off
                  </span>
                  <span className="block text-[11.5px] text-muted">
                    {incident.child?.first_name} {incident.child?.last_name} ·{" "}
                    {incident.classroom?.name} · {incident.injury_type} ·{" "}
                    {new Date(incident.occurred_at).toLocaleTimeString("en-CA", {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => setSigning(incident)}
                  className="whitespace-nowrap rounded-btn bg-primary px-3.5 py-2 text-xs font-bold text-white hover:bg-primary-hover"
                >
                  Review
                </button>
              </div>
            ))}
          </div>
        </section>

        {/* Rooms strip */}
        <section className={card} aria-labelledby="rooms-h">
          <div className="mb-3 flex items-center gap-2">
            <h2 id="rooms-h" className="text-[14px] font-extrabold text-ink">
              Rooms right now
            </h2>
            <Link href="/rooms" className="ml-auto text-[12px] font-bold text-primary hover:text-primary-hover">
              All rooms →
            </Link>
          </div>
          <div className="flex flex-col gap-2.5">
            {rooms.map((room) => {
              const over =
                room.ratio_children_per_educator !== null &&
                isOverRatio(
                  Number(room.present_count),
                  room.educators.length,
                  room.ratio_children_per_educator,
                );
              return (
                <Link
                  key={room.id}
                  href={`/rooms/${room.id}`}
                  className="flex items-center gap-3 rounded-xl border border-[#EDF3FB] px-3.5 py-3 hover:bg-[#F8FBFE]"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-bold text-ink">{room.name}</span>
                    <span className="block text-[11.5px] text-muted">
                      {room.present_count} children · {room.educators.length} educator
                      {room.educators.length === 1 ? "" : "s"}
                    </span>
                  </span>
                  <span className="flex -space-x-1.5">
                    {room.educators.slice(0, 3).map((educator) => (
                      <span
                        key={educator.id}
                        title={educator.full_name}
                        className="grid size-6 place-items-center rounded-full border-2 border-white bg-tint text-[9px] font-bold text-primary"
                      >
                        {initials(educator.full_name)}
                      </span>
                    ))}
                  </span>
                  <span
                    className={`rounded-full px-2 py-[3px] text-[10.5px] font-bold ${
                      over ? "bg-danger-bg text-danger" : "bg-[#E4F3EC] text-success"
                    }`}
                  >
                    {over ? "Over" : "In ratio"}
                  </span>
                </Link>
              );
            })}
          </div>
        </section>
      </div>

      {signing && <SignOffModal incident={signing} onClose={() => setSigning(null)} />}
    </div>
  );
}
