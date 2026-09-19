"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { CalendarClock, ChevronRight, Download, Pause, Play, Trash2 } from "lucide-react";
import type { ReportAdmin, ReportExport, ReportSchedule } from "@dailylog/db/queries";
import { SectionHeader } from "@/components/shell/header";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import {
  deleteReportSchedule,
  saveReportSchedule,
  setReportScheduleActive,
} from "@/lib/reports/actions";
import {
  REPORT_CATALOG,
  REPORT_KINDS,
  isReportKind,
  type ReportKind,
} from "@/lib/reports/catalog";

const card = "rounded-2xl border-[1.5px] border-[#D6E1F0] bg-card p-4";
const input =
  "mt-1.5 w-full min-w-0 rounded-xl border-[1.5px] border-[#D6E1F0] bg-white px-3.5 py-3 text-[13px] text-ink outline-none focus:border-primary";
const label = "text-[12.5px] font-bold text-ink";

function shortDate(value: string) {
  return new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric" }).format(
    new Date(value),
  );
}

function scheduleDescription(schedule: ReportSchedule, admins: ReportAdmin[]) {
  const recipients = schedule.recipient_ids
    .map((id) => admins.find((admin) => admin.id === id)?.full_name.split(" ")[0])
    .filter(Boolean)
    .join(" + ");
  const cadence = schedule.cadence[0].toUpperCase() + schedule.cadence.slice(1);
  const formats = schedule.formats.map((format) => format.toUpperCase()).join(" + ");
  return `${cadence} · ${recipients || "Administrators"} · ${formats}`;
}

export function ReportsView({
  schedules,
  exports: recentExports,
  admins,
  canEdit,
  profileId,
}: {
  schedules: ReportSchedule[];
  exports: ReportExport[];
  admins: ReportAdmin[];
  canEdit: boolean;
  profileId: string;
}) {
  const [scheduleKind, setScheduleKind] = useState<ReportKind | null>(null);
  const [editing, setEditing] = useState<ReportSchedule | null>(null);
  const [manage, setManage] = useState(false);
  const schedulesByKind = useMemo(
    () => new Map(schedules.filter((row) => row.active).map((row) => [row.report_kind, row])),
    [schedules],
  );
  const exportsByKind = useMemo(() => {
    const map = new Map<string, ReportExport>();
    for (const item of recentExports) if (!map.has(item.report_kind)) map.set(item.report_kind, item);
    return map;
  }, [recentExports]);
  return (
    <>
      <SectionHeader
        title="Reports"
        subtitle="Run once or schedule · export as PDF or spreadsheet"
        showSearch={false}
        actions={
          <button
            type="button"
            onClick={() => setManage(true)}
            className="rounded-btn border-[1.5px] border-[#D6E1F0] bg-white px-[18px] py-2.5 text-[13px] font-bold text-ink hover:bg-canvas"
          >
            Manage schedules
          </button>
        }
      />
      <main className="grid flex-1 items-start gap-5 p-5 lg:p-7 xl:grid-cols-[minmax(0,1fr)_300px]">
        <section className="grid min-w-0 gap-3 md:grid-cols-2">
          {REPORT_KINDS.map((kind) => {
            const report = REPORT_CATALOG[kind];
            const schedule = schedulesByKind.get(kind);
            const lastExport = exportsByKind.get(kind);
            return (
              <article key={kind} className={`${card} flex min-h-[148px] flex-col`}>
                <h2 className="text-[14.5px] font-extrabold text-ink">{report.title}</h2>
                <p className="mt-1 flex-1 text-[12px] leading-relaxed text-muted">
                  {report.description}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-3 text-[12px]">
                  <Link href={`/reports/${kind}`} className="font-bold text-primary hover:underline">
                    Run
                  </Link>
                  <button
                    type="button"
                    disabled={!canEdit}
                    onClick={() => {
                      setEditing(schedule ?? null);
                      setScheduleKind(kind);
                    }}
                    className="font-bold text-faint hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {schedule ? "Edit schedule" : "Schedule"}
                  </button>
                  <span className="ml-auto text-[10.5px] text-faint">
                    {schedule
                      ? `next ${schedule.next_run_at ? shortDate(schedule.next_run_at) : "send pending"}`
                      : lastExport
                        ? `last run ${shortDate(lastExport.generated_at)}`
                        : "never run"}
                  </span>
                </div>
              </article>
            );
          })}
        </section>

        <aside className="flex min-w-0 flex-col gap-4">
          <section className={`${card} flex flex-col gap-3`}>
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-[14px] font-extrabold text-ink">Scheduled</h2>
              <CalendarClock size={18} className="text-primary" />
            </div>
            {schedules.filter((row) => row.active).length ? (
              schedules
                .filter((row) => row.active)
                .slice(0, 3)
                .map((schedule) => (
                  <button
                    type="button"
                    key={schedule.id}
                    onClick={() => {
                      setEditing(schedule);
                      setScheduleKind(schedule.report_kind as ReportKind);
                    }}
                    className="flex items-center gap-2 border-t border-[#EDF3FB] pt-3 text-left first:border-0 first:pt-0"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] font-bold text-ink">
                        {REPORT_CATALOG[schedule.report_kind as ReportKind]?.title ?? "Report"}
                      </span>
                      <span className="block truncate text-[11px] text-muted">
                        {scheduleDescription(schedule, admins)}
                      </span>
                    </span>
                    <ChevronRight size={15} className="text-faint" />
                  </button>
                ))
            ) : (
              <p className="text-[12px] leading-relaxed text-muted">
                No automatic reports yet. Schedule any report from the library.
              </p>
            )}
            <button
              type="button"
              onClick={() => setManage(true)}
              className="self-start text-[12px] font-bold text-primary"
            >
              Manage schedules →
            </button>
          </section>

          <section className={`${card} flex flex-col gap-3`}>
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-[14px] font-extrabold text-ink">Recent exports</h2>
              <Download size={18} className="text-primary" />
            </div>
            {recentExports.length ? (
              recentExports.slice(0, 5).map((item) => (
                <Link
                  href={`/reports/${item.report_kind}?from=${item.starts_on ?? ""}&to=${item.ends_on ?? ""}`}
                  key={item.id}
                  className="flex items-center justify-between gap-3 border-t border-[#EDF3FB] pt-3 first:border-0 first:pt-0"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[12px] font-semibold text-ink">{item.title}</span>
                    <span className="block text-[10.5px] text-faint">
                      {shortDate(item.generated_at)} · {item.row_count ?? 0} rows
                    </span>
                  </span>
                  <span className="text-[11px] font-bold text-primary">{item.format.toUpperCase()}</span>
                </Link>
              ))
            ) : (
              <p className="text-[12px] leading-relaxed text-muted">
                Downloads and printed PDFs will be recorded here for seven years.
              </p>
            )}
          </section>
        </aside>
      </main>

      {scheduleKind && (
        <ScheduleModal
          kind={scheduleKind}
          schedule={editing}
          admins={admins}
          profileId={profileId}
          onClose={() => {
            setScheduleKind(null);
            setEditing(null);
          }}
        />
      )}
      {manage && (
        <ManageSchedulesModal
          schedules={schedules}
          admins={admins}
          canEdit={canEdit}
          onClose={() => setManage(false)}
          onEdit={(schedule) => {
            setManage(false);
            setEditing(schedule);
            setScheduleKind(schedule.report_kind as ReportKind);
          }}
        />
      )}
    </>
  );
}

function ScheduleModal({
  kind,
  schedule,
  admins,
  profileId,
  onClose,
}: {
  kind: ReportKind;
  schedule: ReportSchedule | null;
  admins: ReportAdmin[];
  profileId: string;
  onClose: () => void;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const [cadence, setCadence] = useState(schedule?.cadence ?? "weekly");
  return (
    <Modal onClose={() => !pending && onClose()} width={500}>
      <div>
        <h2 className="text-[18px] font-extrabold text-ink">
          Schedule: {REPORT_CATALOG[kind].title}
        </h2>
        <p className="mt-1 text-[12.5px] text-muted">
          It will run automatically for the selected administrators.
        </p>
      </div>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          start(async () => {
            setError("");
            const result = await saveReportSchedule(form);
            if (result.error) setError(result.error);
            else onClose();
          });
        }}
      >
        <input type="hidden" name="id" value={schedule?.id ?? ""} />
        <input type="hidden" name="report_kind" value={kind} />
        <fieldset disabled={pending} className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-wrap gap-2">
            {["weekly", "monthly", "quarterly"].map((value) => (
              <label key={value}>
                <input
                  type="radio"
                  name="cadence"
                  value={value}
                  checked={cadence === value}
                  onChange={() => setCadence(value)}
                  className="peer sr-only"
                />
                <span className="block cursor-pointer rounded-full border-[1.5px] border-[#D6E1F0] px-3 py-1.5 text-[12px] font-bold capitalize text-body peer-checked:border-primary peer-checked:bg-primary peer-checked:text-white">
                  {value}
                </span>
              </label>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className={label}>
              {cadence === "weekly" ? "Weekday" : "Day of month"}
              {cadence === "weekly" ? (
                <select
                  name="delivery_day"
                  className={input}
                  defaultValue={schedule?.delivery_day ?? 1}
                >
                  {["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map(
                    (day, index) => (
                      <option key={day} value={index}>
                        {day}
                      </option>
                    ),
                  )}
                </select>
              ) : (
                <input
                  name="delivery_day"
                  type="number"
                  min={1}
                  max={31}
                  required
                  className={input}
                  defaultValue={schedule?.delivery_day && schedule.delivery_day > 0 ? schedule.delivery_day : 1}
                />
              )}
            </label>
            <label className={label}>
              Send at
              <input
                type="time"
                name="delivery_time"
                required
                className={input}
                defaultValue={schedule?.delivery_time?.slice(0, 5) ?? "07:00"}
              />
            </label>
          </div>
          <div>
            <p className={label}>Send to (required)</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {admins.map((admin) => (
                <label key={admin.id} className="flex items-center gap-2 rounded-xl bg-canvas p-3 text-[12px] text-ink">
                  <input
                    type="checkbox"
                    name="recipient_ids"
                    value={admin.id}
                    defaultChecked={schedule ? schedule.recipient_ids.includes(admin.id) : admin.id === profileId}
                    className="size-4 accent-primary"
                  />
                  <span className="min-w-0 truncate">{admin.full_name}</span>
                </label>
              ))}
            </div>
          </div>
          <div>
            <p className={label}>Format (required)</p>
            <div className="mt-2 flex gap-3">
              {["pdf", "csv"].map((format) => (
                <label key={format} className="flex flex-1 items-center gap-2 rounded-xl border border-[#D6E1F0] p-3 text-[12px] font-bold uppercase text-ink">
                  <input
                    type="checkbox"
                    name="formats"
                    value={format}
                    defaultChecked={schedule ? schedule.formats.includes(format) : format === "pdf"}
                    className="size-4 accent-primary"
                  />
                  {format}
                </label>
              ))}
            </div>
          </div>
          <label className="flex items-center justify-between gap-4 text-[12.5px] text-ink">
            <span>
              <strong className="block">Skip empty periods</strong>
              <span className="text-[11px] text-muted">Do not send a report with no records.</span>
            </span>
            <input
              type="checkbox"
              name="skip_empty"
              defaultChecked={schedule?.skip_empty ?? kind === "ratio"}
              className="size-5 accent-primary"
            />
          </label>
        </fieldset>
        {error && <p role="alert" className="rounded-xl bg-danger-bg p-3 text-[12px] text-danger">{error}</p>}
        <div className="grid grid-cols-2 gap-3">
          <Button type="button" variant="secondary" disabled={pending} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save schedule"}
          </Button>
        </div>
        <p className="text-center text-[11px] leading-relaxed text-faint">
          Schedule changes are recorded in the audit trail. Only active administrators can receive reports.
        </p>
      </form>
    </Modal>
  );
}

function ManageSchedulesModal({
  schedules,
  admins,
  canEdit,
  onClose,
  onEdit,
}: {
  schedules: ReportSchedule[];
  admins: ReportAdmin[];
  canEdit: boolean;
  onClose: () => void;
  onEdit: (schedule: ReportSchedule) => void;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  return (
    <Modal onClose={() => !pending && onClose()} width={640}>
      <div>
        <h2 className="text-[18px] font-extrabold text-ink">Scheduled reports</h2>
        <p className="mt-1 text-[12.5px] text-muted">
          {schedules.length} {schedules.length === 1 ? "schedule" : "schedules"} · pause, resume, edit or remove
        </p>
      </div>
      <div className="flex flex-col">
        {schedules.length ? (
          schedules.map((schedule) => {
            const kind = isReportKind(schedule.report_kind) ? schedule.report_kind : "attendance";
            return (
              <div key={schedule.id} className="flex flex-wrap items-center gap-3 border-t border-[#EDF3FB] py-4 first:border-0 first:pt-0">
                <span className="min-w-[220px] flex-1">
                  <span className={`block text-[13.5px] font-bold ${schedule.active ? "text-ink" : "text-faint"}`}>
                    {REPORT_CATALOG[kind].title}
                  </span>
                  <span className="block text-[11.5px] text-muted">
                    {scheduleDescription(schedule, admins)}
                    {schedule.next_run_at ? ` · next ${shortDate(schedule.next_run_at)}` : " · paused"}
                  </span>
                </span>
                {!schedule.active && (
                  <span className="rounded-full bg-[#EDF2F9] px-2.5 py-1 text-[10.5px] font-bold text-muted">Paused</span>
                )}
                <button type="button" disabled={!canEdit || pending} onClick={() => onEdit(schedule)} className="text-[12px] font-bold text-primary disabled:opacity-50">
                  Edit
                </button>
                <button
                  type="button"
                  disabled={!canEdit || pending}
                  aria-label={schedule.active ? "Pause schedule" : "Resume schedule"}
                  onClick={() =>
                    start(async () => {
                      setError("");
                      const result = await setReportScheduleActive(schedule.id, !schedule.active);
                      if (result.error) setError(result.error);
                    })
                  }
                  className="text-faint disabled:opacity-50"
                >
                  {schedule.active ? <Pause size={16} /> : <Play size={16} />}
                </button>
                <button
                  type="button"
                  disabled={!canEdit || pending}
                  aria-label="Delete schedule"
                  onClick={() =>
                    start(async () => {
                      setError("");
                      const result = await deleteReportSchedule(schedule.id);
                      if (result.error) setError(result.error);
                    })
                  }
                  className="text-danger disabled:opacity-50"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            );
          })
        ) : (
          <p className="rounded-xl bg-canvas p-4 text-[13px] text-muted">
            No report schedules have been created yet.
          </p>
        )}
      </div>
      {error && <p role="alert" className="rounded-xl bg-danger-bg p-3 text-[12px] text-danger">{error}</p>}
      <Button type="button" variant="secondary" disabled={pending} onClick={onClose}>
        Close
      </Button>
    </Modal>
  );
}
