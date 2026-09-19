"use client";

import type {
  ConsentRegisterRow,
  MedicalRegisterRow,
  RosterChild,
} from "@dailylog/db/queries";
import { childSetupChecklist, formatAge } from "@dailylog/shared";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { SectionHeader } from "@/components/shell/header";
import { Avatar } from "@/components/ui/avatar";
import { medicationLifecycleStatus } from "@/lib/children/medication-status";
import { CreateChildModal } from "./create-child-modal";
import { RowMenu } from "./row-menu";

export type ChildrenTab = "all" | "byroom" | "medical" | "consents";

interface Classroom {
  id: string;
  name: string;
}

const tabClass = (active: boolean) =>
  `border-b-[2.5px] py-[11px] text-[13px] ${
    active
      ? "border-[var(--primary)] font-bold text-primary"
      : "border-transparent font-semibold text-faint hover:text-muted"
  }`;

export function RosterView({
  childrenRows,
  classrooms,
  medical,
  consentRows,
  startingSoon,
  openCreate,
  initialTab,
}: {
  childrenRows: RosterChild[];
  classrooms: Classroom[];
  medical: MedicalRegisterRow[];
  consentRows: ConsentRegisterRow[];
  startingSoon: number;
  openCreate: boolean;
  initialTab: ChildrenTab;
}) {
  const [tab, setTab] = useState<ChildrenTab>(initialTab);
  const [roomFilter, setRoomFilter] = useState<string | null>(null);
  const [creating, setCreating] = useState(openCreate);
  const [query, setQuery] = useState("");
  const router = useRouter();

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filtered = childrenRows.filter(
    (child) =>
      (!roomFilter || child.classroom?.id === roomFilter) &&
      matchesChildSearch(child, normalizedQuery),
  );

  const needSetup = childrenRows.filter(
    (c) => setupFor(c).incomplete > 0,
  ).length;
  const enrolledNow = Math.max(0, childrenRows.length - startingSoon);

  const selectTab = (nextTab: ChildrenTab) => {
    setTab(nextTab);
    setRoomFilter(null);
    setQuery("");
    const url = nextTab === "all" ? "/children" : `/children?tab=${nextTab}`;
    router.replace(url, { scroll: false });
  };

  return (
    <>
      <SectionHeader
        title="Children"
        subtitle={
          tab === "medical"
            ? "Medical & allergies register · reviewed weekly"
            : `${enrolledNow} enrolled · ${startingSoon} starting soon · ${needSetup} profiles incomplete`
        }
        showSearch={tab === "all" || tab === "byroom"}
        searchPlaceholder="Search children…"
        searchValue={query}
        onSearchChange={setQuery}
        actions={
          tab === "medical" ? (
            <>
              <form action="/reports-export/children-medical" method="get">
                <button
                  type="submit"
                  className="rounded-btn border-[1.5px] border-[#D6E1F0] bg-card px-4 py-2.5 text-[13px] font-bold text-ink hover:bg-canvas"
                >
                  Export register
                </button>
              </form>
              <button
                type="button"
                onClick={() => window.print()}
                className="rounded-btn bg-primary px-[18px] py-2.5 text-[13px] font-bold text-white hover:bg-primary-hover"
              >
                Print for rooms
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="rounded-btn bg-primary px-[18px] py-2.5 text-[13px] font-bold text-white hover:bg-primary-hover"
            >
              + Add child
            </button>
          )
        }
      />

      <div className="flex flex-1 flex-col">
      <div className="flex items-center gap-[22px] border-b-[1.5px] border-hairline bg-card px-7 print:hidden" role="tablist" aria-label="Children views">
        <button type="button" role="tab" aria-selected={tab === "all"} className={tabClass(tab === "all")} onClick={() => selectTab("all")}>
          All children
        </button>
        <button type="button" role="tab" aria-selected={tab === "byroom"} className={tabClass(tab === "byroom")} onClick={() => selectTab("byroom")}>
          By room
        </button>
        <button type="button" role="tab" aria-selected={tab === "medical"} className={tabClass(tab === "medical")} onClick={() => selectTab("medical")}>
          Medical &amp; allergies
        </button>
        <button type="button" role="tab" aria-selected={tab === "consents"} className={tabClass(tab === "consents")} onClick={() => selectTab("consents")}>
          Consents
        </button>
      </div>

      <div className="flex flex-col gap-3.5 px-7 pb-6 pt-[18px] print:p-0">
        {(tab === "all" || tab === "byroom") && (
          <>
            <div className="flex items-center gap-2">
              <FilterChip active={roomFilter === null} onClick={() => setRoomFilter(null)}>
                All rooms
              </FilterChip>
              {classrooms.map((room) => (
                <FilterChip
                  key={room.id}
                  active={roomFilter === room.id}
                  onClick={() => setRoomFilter(room.id)}
                >
                  {room.name}
                </FilterChip>
              ))}
              <span className="flex-1" />
              {needSetup > 0 && (
                <span className="rounded-full border border-[#F0E2C4] bg-warning-bg px-3 py-1.5 text-[11.5px] font-semibold text-warning-text">
                  ⚑ {needSetup} need setup
                </span>
              )}
            </div>

            {tab === "all" ? (
              <>
                <RosterTable rows={filtered} onOpen={(id) => router.push(`/children/${id}`)} />
                <p className="text-center text-[11.5px] text-faint">
                  Showing {filtered.length} of {childrenRows.length}
                  {classrooms
                    .map((room) => {
                      const count = childrenRows.filter((c) => c.classroom?.id === room.id).length;
                      return count > 0 ? ` · ${room.name} ${count}` : "";
                    })
                    .join("")}
                </p>
              </>
            ) : (
              classrooms.map((room) => {
                const rows = filtered.filter((c) => c.classroom?.id === room.id);
                if (rows.length === 0) return null;
                return (
                  <div key={room.id} className="flex flex-col gap-2">
                    <h3 className="text-[13px] font-extrabold text-ink">
                      {room.name}
                      <span className="ml-2 font-semibold text-faint">{rows.length}</span>
                    </h3>
                    <RosterTable rows={rows} onOpen={(id) => router.push(`/children/${id}`)} />
                  </div>
                );
              })
            )}
          </>
        )}

        {tab === "medical" && <MedicalRegister rows={medical} />}

        {tab === "consents" && <ConsentRegister rows={consentRows} />}
      </div>

      {creating && (
        <CreateChildModal classrooms={classrooms} onClose={() => setCreating(false)} />
      )}
      </div>
    </>
  );
}

function setupFor(child: RosterChild) {
  return childSetupChecklist({
    ...child,
    guardianCount: child.guardians.filter((g) => g.parent).length,
    pendingInviteCount: 0,
  });
}

function matchesChildSearch(child: RosterChild, query: string): boolean {
  if (!query) return true;
  const primary =
    child.guardians.find((guardian) => guardian.is_primary)?.parent ??
    child.guardians[0]?.parent;
  return [
    child.first_name,
    child.last_name,
    child.classroom?.name,
    primary?.full_name,
    ...(child.allergies ?? []),
  ].some((value) => value?.toLocaleLowerCase().includes(query));
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full px-[13px] py-1.5 text-xs ${
        active
          ? "bg-primary font-bold text-white"
          : "border-[1.5px] border-[#D6E1F0] bg-card font-semibold text-body hover:bg-canvas"
      }`}
    >
      {children}
    </button>
  );
}

const HEAD =
  "font-bold text-[10.5px] tracking-[.07em] text-faint";

function RosterTable({
  rows,
  onOpen,
}: {
  rows: RosterChild[];
  onOpen: (id: string) => void;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border-[1.5px] border-[#D6E1F0] bg-card px-6 py-10 text-center text-[12.5px] text-muted">
        No children here yet — add one with “+ Add child”.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border-[1.5px] border-[#D6E1F0] bg-card">
      <div className={`grid grid-cols-[1.9fr_1fr_.8fr_1.2fr_1fr_34px] gap-2.5 border-b-[1.5px] border-[#EDF3FB] bg-[#F8FBFE] px-[18px] py-3 ${HEAD}`}>
        <span>CHILD</span>
        <span>ROOM</span>
        <span>AGE</span>
        <span>PRIMARY CONTACT</span>
        <span>STATUS</span>
        <span />
      </div>
      {rows.map((child) => {
        const setup = setupFor(child);
        const primary =
          child.guardians.find((g) => g.is_primary)?.parent ??
          child.guardians[0]?.parent;
        const severe = (child.allergies?.length ?? 0) > 0;
        const starts =
          child.enrolled_on && new Date(child.enrolled_on) > new Date()
            ? new Date(child.enrolled_on)
            : null;

        return (
          <div
            key={child.id}
            role="button"
            tabIndex={0}
            onClick={() => onOpen(child.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") onOpen(child.id);
            }}
            className="grid cursor-pointer grid-cols-[1.9fr_1fr_.8fr_1.2fr_1fr_34px] items-center gap-2.5 border-b border-[#EDF3FB] px-[18px] py-3 last:border-b-0 hover:bg-[#F8FBFE] focus-visible:bg-[#F8FBFE] focus-visible:outline-none"
          >
            <span className="flex items-center gap-2.5">
              <Avatar name={`${child.first_name} ${child.last_name}`} size={32} />
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 text-[13px] font-bold text-ink">
                  {child.first_name} {child.last_name}
                  {severe && (
                    <span
                      title={`Allergies: ${child.allergies!.join(", ")}`}
                      className="size-[7px] flex-none rounded-full bg-danger"
                    />
                  )}
                </span>
                {severe && (
                  <span className="block truncate text-[11px] text-faint">
                    {child.allergies!.join(" · ")}
                  </span>
                )}
              </span>
            </span>
            <span className="text-[12.5px] text-muted">{child.classroom?.name ?? "—"}</span>
            <span className="text-[12.5px] text-muted">
              {child.date_of_birth ? formatAge(child.date_of_birth) : "—"}
            </span>
            <span className="truncate text-[12.5px] text-ink">
              {primary?.full_name ?? "—"}
            </span>
            <span>
              {starts ? (
                <span className="whitespace-nowrap rounded-full bg-[#E7F0FB] px-2.5 py-[3px] text-[11px] font-bold text-primary">
                  Starts {starts.toLocaleDateString("en-CA", { month: "short", day: "numeric" })}
                </span>
              ) : setup.incomplete > 0 ? (
                <span className="whitespace-nowrap rounded-full bg-warning-bg px-2.5 py-[3px] text-[11px] font-bold text-warning-text">
                  Setup {setup.percent}%
                </span>
              ) : (
                <span className="whitespace-nowrap rounded-full bg-[#E4F3EC] px-2.5 py-[3px] text-[11px] font-bold text-success">
                  Enrolled
                </span>
              )}
            </span>
            <RowMenu childId={child.id} childName={`${child.first_name} ${child.last_name}`} />
          </div>
        );
      })}
    </div>
  );
}

function MedicalRegister({ rows }: { rows: MedicalRegisterRow[] }) {
  const flagged = rows.filter(
    (r) => (r.allergies?.length ?? 0) > 0 || r.medical_notes || r.medications.length > 0,
  );
  const severeAllergies = rows.filter(
    (row) => (row.allergies?.length ?? 0) > 0 && isSevereMedicalRow(row),
  ).length;
  const pendingAuthorizations = rows.reduce(
    (total, row) => total + row.medications.filter(
      (medication) => medicationLifecycleStatus(medication) === "consent_needed",
    ).length,
    0,
  );
  const activeMedications = rows.reduce(
    (total, row) => total + row.medications.filter(
      (medication) => medicationLifecycleStatus(medication) === "active",
    ).length,
    0,
  );
  const emergencyContacts = rows.reduce(
    (total, row) =>
      total + (Array.isArray(row.emergency_contacts) ? row.emergency_contacts.length : 0),
    0,
  );

  return (
    <div data-children-medical-register className="flex flex-col gap-3.5">
      <div className="grid grid-cols-4 gap-3">
        <MedicalSummaryCard
          value={severeAllergies}
          label="Severe allergies"
          className="border-[#F0D2D2] bg-[#FDF3F3] text-danger"
        />
        <MedicalSummaryCard
          value={pendingAuthorizations}
          label="Authorizations pending"
          className="border-[#F0E2C4] bg-[#FFFBF2] text-warning-text"
        />
        <MedicalSummaryCard
          value={activeMedications}
          label="Active medications"
          className="border-[#D6E1F0] bg-card text-ink"
        />
        <MedicalSummaryCard
          value={emergencyContacts}
          label="Emergency contacts on file"
          className="border-[#D6E1F0] bg-card text-success"
        />
      </div>

      <div className="overflow-hidden rounded-2xl border-[1.5px] border-[#D6E1F0] bg-card">
        <div className={`grid grid-cols-[1.6fr_.9fr_1.4fr_1.4fr_1fr] gap-2.5 border-b-[1.5px] border-[#EDF3FB] bg-[#F8FBFE] px-[18px] py-3 ${HEAD}`}>
          <span>CHILD</span>
          <span>ROOM</span>
          <span>ALLERGIES</span>
          <span>MEDICATIONS</span>
          <span>ACTION</span>
        </div>
        {flagged.map((row) => {
          const consentNeeded = row.medications.some(
            (medication) => medicationLifecycleStatus(medication) === "consent_needed",
          );
          const hasActiveMedication = row.medications.some(
            (medication) => medicationLifecycleStatus(medication) === "active",
          );
          const severe = isSevereMedicalRow(row);
          return (
          <Link
            key={row.id}
            href={`/children/${row.id}`}
            aria-label={`Open medical profile for ${row.first_name} ${row.last_name}`}
            className="grid grid-cols-[1.6fr_.9fr_1.4fr_1.4fr_1fr] items-center gap-2.5 border-b border-[#EDF3FB] px-[18px] py-3 last:border-b-0 hover:bg-[#F8FBFE] focus-visible:bg-[#F8FBFE] focus-visible:outline-none"
          >
            <span className="flex items-center gap-2.5">
              <Avatar name={`${row.first_name} ${row.last_name}`} size={28} />
              <span className="text-[13px] font-bold text-ink">
                {row.first_name} {row.last_name}
              </span>
            </span>
            <span className="text-[12.5px] text-muted">{row.classroom?.name ?? "—"}</span>
            <span>
              {(row.allergies?.length ?? 0) > 0 ? (
                <span className="rounded-full border border-[#F0D2D2] bg-[#FAEBEB] px-2.5 py-[3px] text-[11px] font-bold text-danger">
                  {row.allergies!.join(" · ")}{severe ? " · severe" : ""}
                </span>
              ) : (
                <span className="text-[12px] text-faint">None on file</span>
              )}
            </span>
            <span className={row.medications.length > 0 ? "text-[12px] text-ink" : "text-[12px] text-faint"}>
              {row.medications.map((medication) => medication.name).join(" · ") || "—"}
            </span>
            <span>
              <span
                className={`whitespace-nowrap rounded-full px-2.5 py-[3px] text-[11px] font-bold ${
                  consentNeeded
                    ? "bg-warning-bg text-warning-text"
                    : hasActiveMedication
                      ? "bg-[#E4F3EC] text-success"
                      : "bg-canvas text-faint"
                }`}
              >
                {consentNeeded ? "Consent needed" : hasActiveMedication ? "Complete" : "History only"}
              </span>
            </span>
          </Link>
          );
        })}
        {flagged.length === 0 && (
          <p className="px-6 py-10 text-center text-[12.5px] text-muted">
            No allergies, medical notes or medications on file.
          </p>
        )}
      </div>
      <p className="text-center text-[11.5px] text-faint print:hidden">
        Aggregates every child&apos;s medical record into one reviewable list — the
        safety view Attendance, Rooms and Incidents each only saw a slice of.
      </p>
    </div>
  );
}

const CONSENT_REGISTER_KINDS = [
  { kind: "Photo & media consent", label: "Photos" },
  { kind: "Field-trip permission", label: "Trips" },
  { kind: "Water / splash play", label: "Water" },
  { kind: "Sunscreen application", label: "Sunscreen" },
] as const;

function ConsentRegister({ rows }: { rows: ConsentRegisterRow[] }) {
  const statuses = rows.flatMap((row) => CONSENT_REGISTER_KINDS.map(({ kind }) =>
    row.consents.find((consent) => consent.kind === kind),
  ));
  const allowed = statuses.filter((consent) => consent?.granted).length;
  const declined = statuses.filter((consent) => consent && !consent.granted).length;
  const unanswered = statuses.filter((consent) => !consent).length;

  return (
    <div data-children-consent-register className="flex flex-col gap-3.5">
      <div className="grid grid-cols-3 gap-3">
        <MedicalSummaryCard value={allowed} label="Allowed permissions" className="border-[#CBE8DA] bg-[#F2FAF6] text-success" />
        <MedicalSummaryCard value={declined} label="Declined permissions" className="border-[#F0D2D2] bg-[#FDF3F3] text-danger" />
        <MedicalSummaryCard value={unanswered} label="Awaiting family response" className="border-[#F0E2C4] bg-[#FFFBF2] text-warning-text" />
      </div>

      <div className="overflow-hidden rounded-2xl border-[1.5px] border-[#D6E1F0] bg-card">
        <div className={`grid grid-cols-[1.45fr_.8fr_repeat(4,.7fr)] gap-2.5 border-b-[1.5px] border-[#EDF3FB] bg-[#F8FBFE] px-[18px] py-3 ${HEAD}`}>
          <span>CHILD</span>
          <span>ROOM</span>
          {CONSENT_REGISTER_KINDS.map(({ kind, label }) => <span key={kind}>{label}</span>)}
        </div>
        {rows.map((row) => (
          <Link
            key={row.id}
            href={`/children/${row.id}`}
            aria-label={`Review permissions for ${row.first_name} ${row.last_name}`}
            className="grid grid-cols-[1.45fr_.8fr_repeat(4,.7fr)] items-center gap-2.5 border-b border-[#EDF3FB] px-[18px] py-3 last:border-b-0 hover:bg-[#F8FBFE] focus-visible:bg-[#F8FBFE] focus-visible:outline-none"
          >
            <span className="flex items-center gap-2.5">
              <Avatar name={`${row.first_name} ${row.last_name}`} size={28} />
              <span className="text-[13px] font-bold text-ink">{row.first_name} {row.last_name}</span>
            </span>
            <span className="text-[12px] text-muted">{row.classroom?.name ?? "—"}</span>
            {CONSENT_REGISTER_KINDS.map(({ kind }) => {
              const consent = row.consents.find((candidate) => candidate.kind === kind);
              const label = !consent ? "Not set" : consent.granted ? "Allowed" : "Declined";
              const tone = !consent
                ? "bg-warning-bg text-warning-text"
                : consent.granted
                  ? "bg-[#E4F3EC] text-success"
                  : "bg-[#FAEBEB] text-danger";
              return <span key={kind}><span className={`whitespace-nowrap rounded-full px-2 py-[3px] text-[10.5px] font-bold ${tone}`}>{label}</span></span>;
            })}
          </Link>
        ))}
      </div>
      <p className="text-center text-[11.5px] text-faint">
        Declined and unanswered permissions are treated as restricted in educator workflows.
      </p>
    </div>
  );
}

function MedicalSummaryCard({
  value,
  label,
  className,
}: {
  value: number;
  label: string;
  className: string;
}) {
  return (
    <div className={`rounded-[14px] border-[1.5px] px-4 py-3 ${className}`}>
      <span className="block text-[22px] font-extrabold">{value}</span>
      <span className="mt-0.5 block text-[11.5px] font-semibold text-muted">{label}</span>
    </div>
  );
}

function isSevereMedicalRow(row: MedicalRegisterRow): boolean {
  const medicalText = [...(row.allergies ?? []), row.medical_notes ?? ""]
    .join(" ")
    .toLocaleLowerCase();
  return /severe|anaphyla|epipen/.test(medicalText);
}
