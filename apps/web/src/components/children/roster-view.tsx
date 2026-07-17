"use client";

import type { MedicalRegisterRow, RosterChild } from "@dailylog/db/queries";
import { childSetupChecklist, formatAge } from "@dailylog/shared";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { CreateChildModal } from "./create-child-modal";
import { RowMenu } from "./row-menu";

type Tab = "all" | "byroom" | "medical" | "consents";

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
  openCreate,
  initialTab,
}: {
  childrenRows: RosterChild[];
  classrooms: Classroom[];
  medical: MedicalRegisterRow[];
  openCreate: boolean;
  initialTab: Tab;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [roomFilter, setRoomFilter] = useState<string | null>(null);
  const [creating, setCreating] = useState(openCreate);
  const router = useRouter();

  const filtered = roomFilter
    ? childrenRows.filter((c) => c.classroom?.id === roomFilter)
    : childrenRows;

  const needSetup = childrenRows.filter(
    (c) => setupFor(c).incomplete > 0,
  ).length;

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex items-center gap-[22px] border-b-[1.5px] border-hairline bg-card px-7">
        <button type="button" className={tabClass(tab === "all")} onClick={() => setTab("all")}>
          All children
        </button>
        <button type="button" className={tabClass(tab === "byroom")} onClick={() => setTab("byroom")}>
          By room
        </button>
        <button type="button" className={tabClass(tab === "medical")} onClick={() => setTab("medical")}>
          Medical &amp; allergies
        </button>
        <button type="button" className={tabClass(tab === "consents")} onClick={() => setTab("consents")}>
          Consents
        </button>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="my-2 rounded-btn bg-primary px-[18px] py-2 text-[13px] font-bold text-white hover:bg-primary-hover"
        >
          + Add child
        </button>
      </div>

      <div className="flex flex-col gap-3.5 px-7 pb-6 pt-[18px]">
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

        {tab === "consents" && (
          <div className="flex flex-col items-center gap-2 rounded-2xl border-[1.5px] border-[#D6E1F0] bg-card px-6 py-12 text-center">
            <span className="text-[13px] font-extrabold text-ink">No consent records yet</span>
            <span className="max-w-sm text-[12.5px] leading-relaxed text-muted">
              Parents grant per-child consents (photos, sunscreen, outings) from
              their app — statuses roll up here as they come in.
            </span>
          </div>
        )}
      </div>

      {creating && (
        <CreateChildModal classrooms={classrooms} onClose={() => setCreating(false)} />
      )}
    </div>
  );
}

function setupFor(child: RosterChild) {
  return childSetupChecklist({
    ...child,
    guardianCount: child.guardians.filter((g) => g.parent).length,
    pendingInviteCount: 0,
  });
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

  if (flagged.length === 0) {
    return (
      <div className="rounded-2xl border-[1.5px] border-[#D6E1F0] bg-card px-6 py-10 text-center text-[12.5px] text-muted">
        No allergies, medical notes or medications on file.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border-[1.5px] border-[#D6E1F0] bg-card">
      <div className={`grid grid-cols-[1.6fr_1fr_1.6fr_1.4fr_90px] gap-2.5 border-b-[1.5px] border-[#EDF3FB] bg-[#F8FBFE] px-[18px] py-3 ${HEAD}`}>
        <span>CHILD</span>
        <span>ROOM</span>
        <span>ALLERGIES</span>
        <span>MEDICATIONS</span>
        <span>ACTION</span>
      </div>
      {flagged.map((row) => (
        <div
          key={row.id}
          className="grid grid-cols-[1.6fr_1fr_1.6fr_1.4fr_90px] items-center gap-2.5 border-b border-[#EDF3FB] px-[18px] py-3 last:border-b-0"
        >
          <span className="flex items-center gap-2.5">
            <Avatar name={`${row.first_name} ${row.last_name}`} size={28} />
            <span className="text-[13px] font-bold text-ink">
              {row.first_name} {row.last_name}
            </span>
          </span>
          <span className="text-[12.5px] text-muted">{row.classroom?.name ?? "—"}</span>
          <span className="flex flex-wrap gap-1">
            {(row.allergies ?? []).map((a) => (
              <span
                key={a}
                className="rounded-full bg-danger-bg px-2 py-[2px] text-[11px] font-bold text-danger"
              >
                {a}
              </span>
            ))}
            {(row.allergies?.length ?? 0) === 0 && (
              <span className="text-[12.5px] text-faint">—</span>
            )}
          </span>
          <span className="text-[12.5px] text-muted">
            {row.medications.filter((m) => m.active).map((m) => m.name).join(", ") || "—"}
          </span>
          <a
            href={`/children/${row.id}`}
            className="text-[12.5px] font-bold text-primary hover:text-primary-hover"
          >
            Open
          </a>
        </div>
      ))}
    </div>
  );
}
