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
import { Avatar } from "@/components/ui/avatar";
import { SignOffModal } from "@/components/incidents/sign-off-modal";

const card = "rounded-2xl border border-[rgba(23,51,91,.1)] bg-card p-[18px]";
const tileLabel = "font-mono text-[10.5px] font-semibold tracking-[.08em] text-faint";

function dollars(cents: number): string {
  return (cents / 100).toLocaleString("en-CA", { style: "currency", currency: "CAD" });
}

function minsAgo(timestamp: string): string {
  const mins = Math.max(0, Math.floor((Date.now() - new Date(timestamp).getTime()) / 60000));
  if (mins < 60) return `${mins} min ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

function daysUntil(date: string): number {
  return Math.round((new Date(`${date}T12:00`).getTime() - Date.now()) / 86400000);
}

interface Enrollment {
  capacity: number;
  filled: number;
  waitlist: number;
  tours: number;
}
interface Offer {
  id: string;
  name: string;
  age: string | null;
  start: string | null;
}
interface CertIssue {
  staffName: string;
  item: string;
  expiresOn: string;
  room: string | null;
}
interface Staffing {
  id: string;
  name: string;
  room: string;
}

export function DashboardView({
  rooms,
  incidents,
  attendance,
  billing,
  enrollment,
  offers,
  certIssues,
  staffing,
}: {
  rooms: RoomLiveStatus[];
  incidents: IncidentRow[];
  attendance: AttendanceDayRow[];
  billing: BillingSummary | null;
  enrollment: Enrollment;
  offers: Offer[];
  certIssues: CertIssue[];
  staffing: Staffing[];
}) {
  const [signing, setSigning] = useState<IncidentRow | null>(null);

  const enrolled = attendance.length;
  const inToday = attendance.filter((row) => row.attendance[0]?.checked_in_at).length;
  const expectedLater = attendance.filter((row) => {
    const att = row.attendance[0];
    return !att?.checked_in_at && att?.status !== "absent" && att?.status !== "excused";
  }).length;

  const roomOver = (room: RoomLiveStatus) =>
    room.ratio_children_per_educator !== null &&
    isOverRatio(Number(room.present_count), room.educators.length, room.ratio_children_per_educator);
  const overRooms = rooms.filter(roomOver);

  const attention = overRooms.length + certIssues.length + incidents.length + offers.length;

  return (
    <div className="flex flex-1 flex-col p-7">
      <div className="grid grid-cols-[minmax(0,1fr)_300px] items-start gap-4">
        {/* ── Left column ─────────────────────────────────────────────── */}
        <div className="flex min-w-0 flex-col gap-4">
          {/* Stat tiles */}
          <div className="grid grid-cols-4 gap-3">
            <Link href="/attendance" className={`${card} hover:bg-[#F8FBFE]`}>
              <span className={tileLabel}>CHILDREN IN TODAY</span>
              <span className="mt-1 block text-[24px] font-extrabold text-ink">
                {inToday} <span className="text-[14px] font-bold text-faint">/ {enrolled}</span>
              </span>
              <span className="text-[11px] text-muted">
                {expectedLater > 0 ? `${expectedLater} expected later` : "everyone accounted for"}
              </span>
            </Link>
            <Link href="/staff" className={`${card} hover:bg-[#F8FBFE]`}>
              <span className={tileLabel}>EDUCATORS ASSIGNED</span>
              <span className="mt-1 block text-[24px] font-extrabold text-ink">
                {staffing.length}
              </span>
              <span className="text-[11px] text-muted">on the floor today</span>
            </Link>
            <Link href="/rooms" className={`${card} hover:bg-[#F8FBFE]`}>
              <span className={tileLabel}>ROOMS IN RATIO</span>
              <span
                className={`mt-1 block text-[24px] font-extrabold ${
                  overRooms.length ? "text-danger" : "text-ink"
                }`}
              >
                {rooms.length - overRooms.length}{" "}
                <span className="text-[14px] font-bold text-faint">/ {rooms.length}</span>
              </span>
              <span className={`text-[11px] ${overRooms.length ? "text-danger" : "text-muted"}`}>
                {overRooms.length ? `${overRooms[0].name} needs a floater` : "all rooms compliant"}
              </span>
            </Link>
            <Link href="/billing" className={`${card} hover:bg-[#F8FBFE]`}>
              <span className={tileLabel}>OUTSTANDING BALANCES</span>
              <span
                className={`mt-1 block text-[24px] font-extrabold ${
                  Number(billing?.overdue_count ?? 0) > 0 ? "text-danger" : "text-ink"
                }`}
              >
                {dollars(Number(billing?.outstanding_cents ?? 0))}
              </span>
              <span className="text-[11px] text-muted">
                {Number(billing?.overdue_count ?? 0)} invoice
                {Number(billing?.overdue_count ?? 0) === 1 ? "" : "s"} overdue
              </span>
            </Link>
          </div>

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

            <div className="flex flex-col divide-y divide-[#EDF3FB]">
              {overRooms.map((room) => (
                <AttentionRow
                  key={room.id}
                  dot="danger"
                  title={`${room.name} is over ratio`}
                  detail={`${room.present_count} children with ${room.educators.length} educator${
                    room.educators.length === 1 ? "" : "s"
                  } — licensing requires 1:${room.ratio_children_per_educator} for this age group`}
                  action={<PrimaryPill href="/rooms">Assign floater</PrimaryPill>}
                />
              ))}

              {certIssues.map((cert, i) => {
                const days = daysUntil(cert.expiresOn);
                return (
                  <AttentionRow
                    key={`cert-${i}`}
                    dot="warning"
                    title={`${cert.staffName.split(" ")[0]}'s ${cert.item} ${days < 0 ? "has expired" : `expires in ${days} days`}`}
                    detail={cert.room ? `Certified staff in ${cert.room}` : "Renewal needed"}
                    action={<GhostPill href="/compliance">Send reminder</GhostPill>}
                  />
                );
              })}

              {incidents.map((incident) => (
                <AttentionRow
                  key={incident.id}
                  dot="warning"
                  title="Incident report awaiting your sign-off"
                  detail={`${incident.child?.first_name} ${incident.child?.last_name} · ${incident.classroom?.name} · ${incident.injury_type} · ${new Date(
                    incident.occurred_at,
                  ).toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit" })}`}
                  action={
                    <button
                      type="button"
                      onClick={() => setSigning(incident)}
                      className="whitespace-nowrap rounded-btn border-[1.5px] border-[#D6E1F0] bg-card px-3.5 py-2 text-xs font-bold text-ink hover:bg-canvas"
                    >
                      Review
                    </button>
                  }
                />
              ))}

              {offers.map((offer) => (
                <AttentionRow
                  key={offer.id}
                  dot="primary"
                  title={`Waitlist offer out to ${offer.name.split(" · ")[0]}`}
                  detail={[offer.age, offer.start ? `wants to start ${new Date(`${offer.start}T12:00`).toLocaleDateString("en-CA", { month: "short", day: "numeric" })}` : null]
                    .filter(Boolean)
                    .join(" · ")}
                  action={<GhostPill href="/enrollment">View offer</GhostPill>}
                />
              ))}
            </div>
          </section>

          {/* Rooms — 2-col grid */}
          <div className="grid grid-cols-2 gap-3">
            {rooms.map((room) => {
              const over = roomOver(room);
              const present = Number(room.present_count);
              const actual =
                room.educators.length > 0 ? (present / room.educators.length).toFixed(1) : "∞";
              return (
                <Link
                  key={room.id}
                  href={`/rooms/${room.id}`}
                  className={`rounded-2xl border bg-card p-3.5 hover:bg-[#F8FBFE] ${
                    over ? "border-[#F0E2C4] bg-warning-bg/30" : "border-[rgba(23,51,91,.1)]"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="flex-1 text-[13px] font-extrabold text-ink">{room.name}</span>
                    <span
                      className={`rounded-full px-2 py-[3px] text-[10.5px] font-bold ${
                        over ? "bg-danger-bg text-danger" : "bg-[#E4F3EC] text-success"
                      }`}
                    >
                      {over
                        ? `Over ratio 1:${actual}`
                        : `In ratio 1:${room.ratio_children_per_educator ?? "—"}`}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <span className="flex -space-x-1.5">
                      {room.educators.slice(0, 3).map((e) => (
                        <span
                          key={e.id}
                          title={e.full_name}
                          className="grid size-6 place-items-center rounded-full border-2 border-white bg-tint text-[9px] font-bold text-primary"
                        >
                          {initials(e.full_name)}
                        </span>
                      ))}
                    </span>
                    <span className="text-[11.5px] text-muted">
                      {present} children · {room.educators.length} educator
                      {room.educators.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  <p className={`mt-2 text-[11px] ${over ? "font-semibold text-warning-text" : "text-faint"}`}>
                    {over
                      ? "Over ratio — assign a floater"
                      : room.last_log_at
                        ? `Last log ${minsAgo(room.last_log_at)}`
                        : "No activity logged yet"}
                  </p>
                </Link>
              );
            })}
          </div>
        </div>

        {/* ── Right rail ──────────────────────────────────────────────── */}
        <div className="flex flex-col gap-4">
          {/* Staffing today */}
          <section className={card} aria-labelledby="staffing-h">
            <h2 id="staffing-h" className="mb-3 text-[14px] font-extrabold text-ink">
              Staffing today
            </h2>
            <div className="flex flex-col gap-2.5">
              {staffing.slice(0, 6).map((s) => (
                <div key={s.id} className="flex items-center gap-2.5">
                  <Avatar name={s.name} size={28} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-bold text-ink">{s.name}</span>
                    <span className="block text-[11px] text-muted">{s.room}</span>
                  </span>
                  <span className="text-[11px] font-bold text-success">On floor</span>
                </div>
              ))}
            </div>
            {overRooms.length > 0 && (
              <div className="mt-3 rounded-xl bg-warning-bg/60 px-3 py-2.5">
                <span className="block text-[11.5px] font-bold text-warning-text">
                  {overRooms[0].name} coverage gap
                </span>
                <Link href="/rooms" className="text-[11.5px] font-bold text-primary hover:text-primary-hover">
                  Assign a floater →
                </Link>
              </div>
            )}
            <p className="mt-2.5 text-[11px] text-faint">
              Shift times &amp; clock-ins arrive with time tracking.
            </p>
          </section>

          {/* Billing snapshot */}
          <section className={card} aria-labelledby="billing-h">
            <h2 id="billing-h" className="mb-3 text-[14px] font-extrabold text-ink">
              Billing snapshot
            </h2>
            <dl className="flex flex-col gap-2">
              <SnapshotRow label="Collected this month">
                {dollars(Number(billing?.collected_month_cents ?? 0))}
              </SnapshotRow>
              <SnapshotRow label="Outstanding" danger>
                {dollars(Number(billing?.outstanding_cents ?? 0))}
              </SnapshotRow>
              <SnapshotRow label="Open invoices">
                {Number(billing?.open_count ?? 0)}
              </SnapshotRow>
            </dl>
            {Number(billing?.overdue_count ?? 0) > 0 && (
              <Link
                href="/billing"
                className="mt-3 block text-[12px] font-bold text-primary hover:text-primary-hover"
              >
                Review {Number(billing?.overdue_count)} overdue →
              </Link>
            )}
          </section>

          {/* Enrollment */}
          <section className={card} aria-labelledby="enroll-h">
            <h2 id="enroll-h" className="mb-3 text-[14px] font-extrabold text-ink">
              Enrollment
            </h2>
            <dl className="flex flex-col gap-2">
              <SnapshotRow label="Capacity filled">
                {enrollment.filled} / {enrollment.capacity}
              </SnapshotRow>
              <SnapshotRow label="Waitlist">
                {enrollment.waitlist} {enrollment.waitlist === 1 ? "family" : "families"}
              </SnapshotRow>
              <SnapshotRow label="Tours booked">{enrollment.tours}</SnapshotRow>
            </dl>
            {enrollment.capacity > 0 && (
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-canvas">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${Math.min(100, (enrollment.filled / enrollment.capacity) * 100)}%` }}
                />
              </div>
            )}
            <Link
              href="/enrollment"
              className="mt-3 block text-[12px] font-bold text-primary hover:text-primary-hover"
            >
              Open waitlist →
            </Link>
          </section>
        </div>
      </div>

      {signing && <SignOffModal incident={signing} onClose={() => setSigning(null)} />}
    </div>
  );
}

function AttentionRow({
  dot,
  title,
  detail,
  action,
}: {
  dot: "danger" | "warning" | "primary";
  title: string;
  detail: string;
  action: React.ReactNode;
}) {
  const dotColor =
    dot === "danger" ? "bg-danger" : dot === "warning" ? "bg-warning" : "bg-primary";
  return (
    <div className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
      <span className={`mt-1.5 size-2 flex-none self-start rounded-full ${dotColor}`} />
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-bold text-ink">{title}</span>
        <span className="block text-[11.5px] text-muted">{detail}</span>
      </span>
      {action}
    </div>
  );
}

function PrimaryPill({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="whitespace-nowrap rounded-btn bg-primary px-3.5 py-2 text-xs font-bold text-white hover:bg-primary-hover"
    >
      {children}
    </Link>
  );
}

function GhostPill({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="whitespace-nowrap rounded-btn border-[1.5px] border-[#D6E1F0] bg-card px-3.5 py-2 text-xs font-bold text-ink hover:bg-canvas"
    >
      {children}
    </Link>
  );
}

function SnapshotRow({
  label,
  danger,
  children,
}: {
  label: string;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-[12.5px] text-muted">{label}</dt>
      <dd className={`text-[13px] font-bold ${danger ? "text-danger" : "text-ink"}`}>{children}</dd>
    </div>
  );
}
