"use client";

import type {
  AttendanceDayRow,
  BillingSummary,
  IncidentRow,
  RoomLiveStatus,
  ComplianceDueItem,
  InvoiceRow,
  RoomActivityNudgeRow,
} from "@dailylog/db/queries";
import { initials, isOverRatio } from "@dailylog/shared";
import { Check, Clock3, Mail, Send } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Modal } from "@/components/ui/modal";
import { SignOffModal } from "@/components/incidents/sign-off-modal";
import { sendInvoiceRemindersAction } from "@/lib/billing/actions";
import {
  sendCredentialReminderAction,
  sendRoomActivityNudgeAction,
} from "@/lib/dashboard/actions";
import { getBrowserSupabase } from "@/lib/supabase/browser";

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
  credentialId: string;
  staffMemberId: string;
  staffName: string;
  jobTitle: string | null;
  email: string;
  item: string;
  issuer: string | null;
  expiresOn: string;
  missing: boolean;
  ratioQualifying: boolean;
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
  overdueInvoices,
  enrollment,
  offers,
  certIssues,
  staffing,
  roomNudges,
  complianceDue = [],
  openIncident = false,
}: {
  rooms: RoomLiveStatus[];
  incidents: IncidentRow[];
  attendance: AttendanceDayRow[];
  billing: BillingSummary | null;
  overdueInvoices: InvoiceRow[];
  enrollment: Enrollment;
  offers: Offer[];
  certIssues: CertIssue[];
  staffing: Staffing[];
  roomNudges: RoomActivityNudgeRow[];
  complianceDue?: ComplianceDueItem[];
  openIncident?: boolean;
}) {
  const router = useRouter();
  const supabaseRef = useRef(getBrowserSupabase());
  const [signing, setSigning] = useState<IncidentRow | null>(
    openIncident ? (incidents[0] ?? null) : null,
  );
  const [paymentRemindersOpen, setPaymentRemindersOpen] = useState(false);
  const [quietRoom, setQuietRoom] = useState<RoomLiveStatus | null>(null);
  const [credentialReminder, setCredentialReminder] = useState<CertIssue | null>(null);

  useEffect(() => {
    const supabase = supabaseRef.current;
    const channel = supabase
      .channel(`dashboard-room-nudges-${Date.now()}-${Math.random()}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "room_activity_nudges" },
        () => router.refresh(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [router]);

  const closeSignOff = () => {
    setSigning(null);
    if (openIncident) router.replace("/dashboard", { scroll: false });
  };

  const enrolled = attendance.length;
  const inToday = attendance.filter((row) => row.attendance[0]?.checked_in_at).length;
  const expectedLater = attendance.filter((row) => {
    const att = row.attendance[0];
    return !att?.checked_in_at && att?.status !== "absent" && att?.status !== "excused";
  }).length;

  const roomOver = (room: RoomLiveStatus) => {
    const ratio = room.operating?.live_ratio ?? room.ratio_children_per_educator;
    return ratio !== null && isOverRatio(Number(room.present_count), room.educators.length, ratio);
  };
  const overRooms = rooms.filter(roomOver);

  const attention = overRooms.length + certIssues.length + incidents.length + offers.length + complianceDue.length;

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
                  } — required ratio is 1:${room.operating?.live_ratio ?? room.ratio_children_per_educator}${room.operating?.combination_id ? " for the combined rooms" : " for this age group"}`}
                  action={<PrimaryPill href="/rooms">Assign floater</PrimaryPill>}
                />
              ))}

              {certIssues.map((cert, i) => {
                const days = daysUntil(cert.expiresOn);
                return (
                  <AttentionRow
                    key={`cert-${i}`}
                    dot="warning"
                    title={cert.missing
                      ? `${cert.staffName.split(" ")[0]}'s ${cert.item} is missing`
                      : `${cert.staffName.split(" ")[0]}'s ${cert.item} ${days < 0 ? "has expired" : `expires in ${days} days`}`}
                    detail={cert.missing
                      ? (cert.room ? `Required for staff assigned to ${cert.room}` : "Required credential")
                      : cert.room ? `Certified staff in ${cert.room}` : "Renewal needed"}
                    action={
                      <button
                        type="button"
                        onClick={() => setCredentialReminder(cert)}
                        className="whitespace-nowrap rounded-btn border-[1.5px] border-[#D6E1F0] bg-card px-3.5 py-2 text-xs font-bold text-ink hover:bg-canvas"
                      >
                        Send reminder
                      </button>
                    }
                  />
                );
              })}

              {complianceDue.map(item => (
                <AttentionRow key={`compliance-${item.id}`} dot="warning"
                  title={`${item.title} ${item.days_left < 0 ? "is overdue" : item.days_left === 0 ? "is due today" : `is due in ${item.days_left} days`}`}
                  detail={item.kind === "drill" ? "Scheduled drill · log the result in Compliance" : "Center document · upload a current replacement"}
                  action={<GhostPill href="/compliance">Review</GhostPill>} />
              ))}

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
                <div
                  key={room.id}
                  className={`rounded-2xl border bg-card p-3.5 hover:bg-[#F8FBFE] ${
                    over ? "border-[#F0E2C4] bg-warning-bg/30" : "border-[rgba(23,51,91,.1)]"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Link href={`/rooms/${room.id}`} className="flex-1 text-[13px] font-extrabold text-ink hover:text-primary">{room.name}</Link>
                    <span
                      className={`rounded-full px-2 py-[3px] text-[10.5px] font-bold ${
                        over ? "bg-danger-bg text-danger" : "bg-[#E4F3EC] text-success"
                      }`}
                    >
                      {over
                        ? `Over ratio 1:${actual}`
                        : room.operating?.combination_id && room.operating.host_room_id !== room.id
                          ? `In ${room.operating.host_room_name}`
                          : `In ratio 1:${room.operating?.live_ratio ?? room.ratio_children_per_educator ?? "—"}`}
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
                  {over ? (
                    <Link href="/rooms" className="mt-2 block text-[11px] font-semibold text-warning-text hover:text-primary">Over ratio — assign a floater →</Link>
                  ) : (() => {
                    const recentNudge = roomNudges.find((nudge) => nudge.classroom_id === room.id);
                    const quiet = !room.last_log_at || Date.now() - new Date(room.last_log_at).getTime() > 45 * 60 * 1000;
                    if (recentNudge?.response) {
                      const reply = recentNudge.response === "all_good" ? "All good — at the park" : recentNudge.response === "will_log" ? "Will log now" : "Send help";
                      return <button type="button" onClick={() => setQuietRoom(room)} className="mt-2 text-left text-[11px] font-bold text-success">Room replied: {reply} →</button>;
                    }
                    if (recentNudge?.snoozed_until && new Date(recentNudge.snoozed_until) > new Date()) {
                      return <button type="button" onClick={() => setQuietRoom(room)} className="mt-2 text-left text-[11px] text-faint">Quiet expected until {new Date(recentNudge.snoozed_until).toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit" })} →</button>;
                    }
                    return quiet ? (
                      <button type="button" onClick={() => setQuietRoom(room)} className="mt-2 text-left text-[11px] font-semibold text-warning-text hover:text-primary">Quiet room · {room.last_log_at ? `last log ${minsAgo(room.last_log_at)}` : "no log today"} →</button>
                    ) : <p className="mt-2 text-[11px] text-faint">Last log {minsAgo(room.last_log_at!)}</p>;
                  })()}
                </div>
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
              <button
                type="button"
                onClick={() => setPaymentRemindersOpen(true)}
                className="mt-3 block text-[12px] font-bold text-primary hover:text-primary-hover"
              >
                Send reminders for {Number(billing?.overdue_count)} overdue →
              </button>
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

      {signing && <SignOffModal incident={signing} onClose={closeSignOff} />}
      {paymentRemindersOpen && (
        <PaymentReminderModal invoices={overdueInvoices} onClose={() => setPaymentRemindersOpen(false)} />
      )}
      {quietRoom && (
        <QuietRoomModal room={quietRoom} onClose={() => setQuietRoom(null)} />
      )}
      {credentialReminder && (
        <CredentialReminderModal credential={credentialReminder} onClose={() => setCredentialReminder(null)} />
      )}
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

function PaymentReminderModal({
  invoices,
  onClose,
}: {
  invoices: InvoiceRow[];
  onClose: () => void;
}) {
  const [today] = useState(() => new Date().toISOString().slice(0, 10));
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(invoices.filter((invoice) => {
      if (!invoice.due_on) return false;
      const days = Math.floor((Date.parse(`${today}T12:00`) - Date.parse(`${invoice.due_on}T12:00`)) / 86400000);
      return days < 21;
    }).map((invoice) => invoice.id)),
  );
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const total = invoices.reduce((sum, invoice) => sum + invoice.total_cents, 0);

  return (
    <Modal onClose={onClose}>
      <div>
        <h2 className="text-[18px] font-extrabold text-ink">Send payment reminders</h2>
        <p className="mt-0.5 text-[12.5px] text-muted">
          {invoices.length} invoice{invoices.length === 1 ? "" : "s"} overdue · {dollars(total)} total
        </p>
      </div>
      <div className="flex flex-col divide-y divide-[#EDF3FB]">
        {invoices.map((invoice) => {
          const name = invoice.family?.display_name ?? invoice.billed_to_profile?.full_name ?? "Family";
          const days = invoice.due_on
            ? Math.floor((Date.parse(`${today}T12:00`) - Date.parse(`${invoice.due_on}T12:00`)) / 86400000)
            : 0;
          return (
            <label key={invoice.id} className="flex cursor-pointer items-center gap-3 py-3 first:pt-0 last:pb-0">
              <Avatar name={name} size={32} />
              <span className="min-w-0 flex-1">
                <b className="block truncate text-[13px] text-ink">{name} · {dollars(invoice.total_cents)}</b>
                <span className="block text-[11.5px] text-muted">
                  {days} day{days === 1 ? "" : "s"} · {days >= 14 ? "follow-up — firmer tone" : "first reminder — friendly tone"}
                </span>
              </span>
              <input
                type="checkbox"
                checked={selected.has(invoice.id)}
                onChange={() => setSelected((current) => {
                  const next = new Set(current);
                  if (next.has(invoice.id)) next.delete(invoice.id); else next.add(invoice.id);
                  return next;
                })}
                className="size-5 accent-primary"
                aria-label={`Send a reminder to ${name}`}
              />
            </label>
          );
        })}
      </div>
      {invoices.length > 0 && (
        <div className="rounded-[13px] bg-canvas px-4 py-3">
          <p className="font-mono text-[10px] font-bold uppercase tracking-[.07em] text-faint">What families get</p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-ink">
            “Hi — a reminder that your DailyLog invoice is past due. Pay securely from the app, or reply if something is up.”
          </p>
        </div>
      )}
      {message && (
        <p className={`rounded-xl px-3 py-2.5 text-[12px] ${message.tone === "success" ? "bg-[#E4F3EC] text-success" : "bg-danger-bg text-danger"}`}>
          {message.text}
        </p>
      )}
      <button
        type="button"
        disabled={pending || selected.size === 0}
        onClick={() => startTransition(async () => {
          const result = await sendInvoiceRemindersAction([...selected]);
          setMessage(result.ok
            ? { tone: "success", text: `${result.queued ?? 0} reminder${result.queued === 1 ? "" : "s"} queued. Each send is recorded in delivery history.` }
            : { tone: "error", text: result.error ?? "Could not send reminders." });
        })}
        className="flex items-center justify-center gap-2 rounded-btn bg-primary px-4 py-3.5 text-[14px] font-bold text-white hover:bg-primary-hover disabled:opacity-50"
      >
        <Mail size={16} aria-hidden />
        {pending ? "Sending…" : `Send ${selected.size} reminder${selected.size === 1 ? "" : "s"}`}
      </button>
      <button type="button" onClick={onClose} className="text-center text-[12px] font-bold text-muted hover:text-ink">Cancel</button>
      <p className="text-center text-[10.5px] leading-relaxed text-faint">Turn off a family when you have already made a payment arrangement. Replies land in Messages.</p>
    </Modal>
  );
}

function QuietRoomModal({ room, onClose }: { room: RoomLiveStatus; onClose: () => void }) {
  const [mode, setMode] = useState<"nudge" | "expected">("nudge");
  const [result, setResult] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <Modal onClose={onClose} width={380}>
      <div>
        <h2 className="text-[18px] font-extrabold text-ink">{room.name} has been quiet</h2>
        <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
          {room.last_log_at ? `No photos, notes or logs since ${new Date(room.last_log_at).toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit" })}` : "No photos, notes or logs today"} — usually means busy, not wrong.
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <ChoiceRow active={mode === "nudge"} title="Nudge the room tablet" detail="A gentle “all good?” only educators see" onClick={() => setMode("nudge")} />
        <ChoiceRow active={mode === "expected"} title="It's expected today" detail="Field trip or long nap — quiets this warning for 3 hours" onClick={() => setMode("expected")} />
      </div>
      {result && <p className={`rounded-xl px-3 py-2.5 text-[12px] ${result.tone === "success" ? "bg-[#E4F3EC] text-success" : "bg-danger-bg text-danger"}`}>{result.text}</p>}
      <button
        type="button"
        disabled={pending}
        onClick={() => startTransition(async () => {
          const response = await sendRoomActivityNudgeAction(room.id, mode);
          setResult(response.ok
            ? { tone: "success", text: mode === "nudge" ? `Nudge sent to ${response.queued ?? 0} room educator${response.queued === 1 ? "" : "s"}. Their one-tap reply will return to the dashboard.` : "Quiet-room warning paused for 3 hours." }
            : { tone: "error", text: response.error ?? "Could not update this room." });
        })}
        className="flex items-center justify-center gap-2 rounded-btn bg-primary px-4 py-3.5 text-[14px] font-bold text-white hover:bg-primary-hover disabled:opacity-50"
      >
        {mode === "nudge" ? <Send size={16} aria-hidden /> : <Clock3 size={16} aria-hidden />}
        {pending ? "Saving…" : mode === "nudge" ? "Send the nudge" : "Quiet this warning"}
      </button>
      <button type="button" onClick={onClose} className="text-center text-[12px] font-bold text-muted hover:text-ink">Close</button>
      <p className="text-center text-[10.5px] leading-relaxed text-faint">Parents never see this — it stays between the office and the room.</p>
    </Modal>
  );
}

function ChoiceRow({ active, title, detail, onClick }: { active: boolean; title: string; detail: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={`flex items-center gap-3 rounded-xl border-[1.5px] p-3 text-left ${active ? "border-primary bg-canvas" : "border-[#D6E1F0] bg-card"}`}>
      <span className={`grid size-[18px] flex-none place-items-center rounded-full ${active ? "bg-primary text-white" : "border-[1.5px] border-[#D6E1F0]"}`}>
        {active && <span className="size-1.5 rounded-full bg-white" />}
      </span>
      <span className="min-w-0 flex-1"><b className="block text-[13px] text-ink">{title}</b><span className="block text-[11.5px] text-muted">{detail}</span></span>
    </button>
  );
}

function CredentialReminderModal({ credential, onClose }: { credential: CertIssue; onClose: () => void }) {
  const [followUp, setFollowUp] = useState(true);
  const [result, setResult] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const days = daysUntil(credential.expiresOn);
  const firstName = credential.staffName.split(" ")[0];
  return (
    <Modal onClose={onClose}>
      <div>
        <h2 className="text-[18px] font-extrabold text-ink">{credential.item} renewal — {firstName}</h2>
        <p className="mt-0.5 text-[12.5px] text-muted">
          {credential.missing ? "Required document is missing" : `${days < 0 ? "Expired" : "Expires"} ${new Date(`${credential.expiresOn}T12:00`).toLocaleDateString("en-CA", { month: "short", day: "numeric" })} · ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} ${days < 0 ? "ago" : "from now"}`}
        </p>
      </div>
      <div className="flex items-center gap-3 rounded-full border-[1.5px] border-[#D6E1F0] bg-canvas p-2 pr-4">
        <Avatar name={credential.staffName} size={34} />
        <span className="min-w-0"><b className="block truncate text-[13px] text-ink">{credential.staffName}</b><span className="block truncate text-[11.5px] text-muted">{credential.jobTitle ?? "Educator"}{credential.room ? ` · ${credential.room}` : ""}{credential.issuer ? ` · ${credential.issuer}` : ""}</span></span>
      </div>
      {credential.ratioQualifying && credential.room && (
        <p className="rounded-[13px] bg-warning-bg px-4 py-3 text-[12px] leading-relaxed text-warning-text">
          This credential contributes to qualified coverage in {credential.room}; a lapse can affect staffing compliance.
        </p>
      )}
      <div className="rounded-[13px] bg-canvas px-4 py-3 text-[12.5px] leading-relaxed text-ink">
        Hi {firstName} — your {credential.item} {credential.missing ? "still needs to be added" : `expires ${new Date(`${credential.expiresOn}T12:00`).toLocaleDateString("en-CA", { month: "short", day: "numeric" })}`}. Upload a photo of the new card in your app when it is ready.
      </div>
      <label className="flex cursor-pointer items-center gap-3 rounded-xl border-[1.5px] border-[#D6E1F0] p-3">
        <input type="checkbox" checked={followUp} onChange={(event) => setFollowUp(event.target.checked)} className="size-5 accent-primary" />
        <span><b className="block text-[12.5px] text-ink">Remind again in 5 days</b><span className="block text-[11px] text-muted">Only if the new card has not been handled yet</span></span>
      </label>
      {result && <p className={`rounded-xl px-3 py-2.5 text-[12px] ${result.tone === "success" ? "bg-[#E4F3EC] text-success" : "bg-danger-bg text-danger"}`}>{result.text}</p>}
      <button
        type="button"
        disabled={pending}
        onClick={() => startTransition(async () => {
          const response = await sendCredentialReminderAction(credential.credentialId, followUp);
          setResult(response.ok
            ? { tone: "success", text: `Reminder sent to ${credential.staffName}${response.followUpScheduled ? "; a follow-up is scheduled in 5 days" : ""}.` }
            : { tone: "error", text: response.error ?? "Could not send the reminder." });
        })}
        className="flex items-center justify-center gap-2 rounded-btn bg-primary px-4 py-3.5 text-[14px] font-bold text-white hover:bg-primary-hover disabled:opacity-50"
      >
        <Check size={16} aria-hidden />{pending ? "Sending…" : "Send reminder"}
      </button>
      <button type="button" onClick={onClose} className="text-center text-[12px] font-bold text-muted hover:text-ink">Cancel</button>
      <p className="text-center text-[10.5px] leading-relaxed text-faint">A verified upload clears the compliance and dashboard flags automatically.</p>
    </Modal>
  );
}
