"use client";

import {
  PERMISSION_AREAS,
  emptyPermission,
  type AreaPermission,
  type RolePermissions,
} from "@dailylog/shared";
import { useActionState, useEffect, useMemo, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Modal } from "@/components/ui/modal";
import {
  saveStaffPermissionOverrideAction,
  type PermissionOverrideActionState,
} from "@/lib/roles/actions";

const COLUMNS: { key: keyof AreaPermission; label: string }[] = [
  { key: "view", label: "VIEW" },
  { key: "edit", label: "EDIT" },
  { key: "approve", label: "APPROVE" },
];

export interface StaffPermissionMatrixData {
  profile_id: string;
  profile_name: string;
  profile_role: string;
  role_id: string | null;
  role_name: string;
  role_permissions: unknown;
  rooms: { id: string; name: string }[];
  overrides: {
    classroom_id: string | null;
    permissions: unknown;
    updated_at: string;
  }[];
}

export function StaffPermissionsModal({
  matrix,
  staffId,
  viewerProfileId,
  onClose,
}: {
  matrix: StaffPermissionMatrixData;
  staffId: string;
  viewerProfileId: string | null;
  onClose: () => void;
}) {
  const [scope, setScope] = useState("all");
  const role = useMemo(() => normalize(matrix.role_permissions), [matrix.role_permissions]);
  const globalOverride = useMemo(
    () => normalizeSparse(matrix.overrides.find((item) => item.classroom_id === null)?.permissions),
    [matrix.overrides],
  );
  const scopedOverride = useMemo(
    () =>
      scope === "all"
        ? globalOverride
        : normalizeSparse(matrix.overrides.find((item) => item.classroom_id === scope)?.permissions),
    [globalOverride, matrix.overrides, scope],
  );
  const inherited = useMemo(
    () => (scope === "all" ? role : merge(role, globalOverride)),
    [globalOverride, role, scope],
  );
  const effective = useMemo(() => merge(inherited, scopedOverride), [inherited, scopedOverride]);
  const effectiveKey = JSON.stringify(effective);
  const [draft, setDraft] = useState<RolePermissions>(effective);
  const [draftKey, setDraftKey] = useState(`${scope}:${effectiveKey}`);
  const [resetting, setResetting] = useState(false);
  const currentKey = `${scope}:${effectiveKey}`;
  if (draftKey !== currentKey) {
    setDraftKey(currentKey);
    setDraft(effective);
    setResetting(false);
  }

  const [state, save, saving] = useActionState<PermissionOverrideActionState, FormData>(
    saveStaffPermissionOverrideAction,
    {},
  );
  useEffect(() => {
    if (state.ok) onClose();
  }, [onClose, state.ok]);

  const locked = matrix.profile_role === "owner_admin" || matrix.profile_id === viewerProfileId;
  const dirty = JSON.stringify(draft) !== effectiveKey;
  const sparse = diff(inherited, draft);
  const scopeName =
    scope === "all" ? "All assigned rooms" : matrix.rooms.find((room) => room.id === scope)?.name;

  const toggle = (area: string, action: keyof AreaPermission) => {
    if (locked) return;
    setResetting(false);
    setDraft((current) => ({
      ...current,
      [area]: {
        ...(current[area] ?? emptyPermission()),
        [action]: !(current[area] ?? emptyPermission())[action],
      },
    }));
  };

  return (
    <Modal width={920} onClose={onClose}>
      <div className="flex items-start gap-3">
        <Avatar name={matrix.profile_name} size={44} />
        <div className="min-w-0 flex-1">
          <h2 className="text-[20px] font-extrabold text-ink">
            Permissions for {matrix.profile_name}
          </h2>
          <p className="text-[12.5px] text-muted">
            Starts with the <b className="text-ink">{matrix.role_name}</b> role. Personal changes
            below affect only this educator.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close permissions"
          className="grid size-9 place-items-center rounded-full border border-[#D6E1F0] text-lg text-muted hover:bg-canvas"
        >
          ×
        </button>
      </div>

      <div className="rounded-2xl bg-canvas p-3">
        <p className="mb-2 px-1 font-mono text-[10px] font-bold uppercase tracking-[.08em] text-faint">
          Apply to
        </p>
        <div className="flex flex-wrap gap-2">
          <ScopeButton active={scope === "all"} onClick={() => setScope("all")}>
            All assigned rooms
          </ScopeButton>
          {matrix.rooms.map((room) => (
            <ScopeButton key={room.id} active={scope === room.id} onClick={() => setScope(room.id)}>
              {room.name}
            </ScopeButton>
          ))}
          {matrix.rooms.length === 0 && (
            <span className="self-center text-[11.5px] text-faint">
              This floater has no permanent room; center-wide defaults apply during approved coverage.
            </span>
          )}
        </div>
      </div>

      <form action={save} className="min-h-0 overflow-hidden rounded-2xl border border-[rgba(23,51,91,.1)]">
        <input type="hidden" name="profile_id" value={matrix.profile_id} />
        <input type="hidden" name="staff_id" value={staffId} />
        <input type="hidden" name="classroom_id" value={scope === "all" ? "" : scope} />
        <input type="hidden" name="permissions" value={JSON.stringify(sparse)} />
        <input type="hidden" name="intent" value={resetting ? "reset" : "save"} />

        <div className="max-h-[54vh] overflow-y-auto px-5 py-2">
          <div className="sticky top-0 z-10 grid grid-cols-[minmax(0,1fr)_82px_82px_90px] items-center gap-2 border-b border-[#EDF3FB] bg-card py-2.5">
            <span className="font-mono text-[10px] font-bold tracking-[.08em] text-faint">AREA</span>
            {COLUMNS.map((column) => (
              <span key={column.key} className="text-center font-mono text-[10px] font-bold tracking-[.08em] text-faint">
                {column.label}
              </span>
            ))}
          </div>
          {PERMISSION_AREAS.map((group) => (
            <div key={group.group}>
              <div className="pb-1 pt-3 font-mono text-[10px] font-bold uppercase tracking-[.08em] text-warning-text">
                {group.group}
              </div>
              {group.items.map((item) => {
                const permission = draft[item.key] ?? emptyPermission();
                const base = inherited[item.key] ?? emptyPermission();
                return (
                  <div key={item.key} className="grid grid-cols-[minmax(0,1fr)_82px_82px_90px] items-center gap-2 border-b border-[#EDF3FB] py-2.5 last:border-b-0">
                    <span className="text-[13px] font-semibold text-ink">{item.label}</span>
                    {COLUMNS.map((column) => (
                      <span key={column.key} className="flex justify-center">
                        <PermissionCell
                          on={permission[column.key]}
                          changed={permission[column.key] !== base[column.key]}
                          locked={locked}
                          onClick={() => toggle(item.key, column.key)}
                        />
                      </span>
                    ))}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        <div className="flex items-center gap-3 border-t border-[#EDF3FB] bg-card px-5 py-3.5">
          <p className="min-w-0 flex-1 text-[11.5px] text-faint">
            {matrix.profile_id === viewerProfileId ? (
              "Another administrator must update your permissions, so no one can elevate their own access."
            ) : matrix.profile_role === "owner_admin" ? (
              "The owner role always has full center access and cannot be overridden."
            ) : (
              <>
                Purple corners mark personal changes for <b className="text-ink">{scopeName}</b>.
                Every update is recorded in the audit trail and appears in the educator&apos;s notifications.
              </>
            )}
          </p>
          {state.error && <span className="text-[11.5px] font-bold text-danger">{state.error}</span>}
          {!locked && (
            <>
              <button
                type="button"
                onClick={() => {
                  setDraft(inherited);
                  setResetting(true);
                }}
                disabled={Object.keys(scopedOverride).length === 0 && !dirty}
                className="rounded-btn border-[1.5px] border-[#D6E1F0] px-4 py-2 text-[12.5px] font-bold text-ink hover:bg-canvas disabled:opacity-45"
              >
                Reset scope
              </button>
              <button
                type="submit"
                disabled={saving || (!dirty && !resetting)}
                className="rounded-btn bg-primary px-5 py-2 text-[12.5px] font-bold text-white hover:bg-primary-hover disabled:opacity-45"
              >
                {saving ? "Saving…" : "Save override"}
              </button>
            </>
          )}
        </div>
      </form>
    </Modal>
  );
}

function ScopeButton({
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
      className={`rounded-full border px-3.5 py-1.5 text-[12px] font-bold ${
        active ? "border-primary bg-primary text-white" : "border-[#D6E1F0] bg-card text-ink hover:bg-tint"
      }`}
    >
      {children}
    </button>
  );
}

function PermissionCell({
  on,
  changed,
  locked,
  onClick,
}: {
  on: boolean;
  changed: boolean;
  locked: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={locked}
      onClick={onClick}
      aria-pressed={on}
      className={`relative grid size-7 place-items-center rounded-[8px] border-[1.5px] text-[12px] font-black ${
        on ? "border-success bg-success text-white" : "border-[#D6E1F0] bg-white text-faint"
      } disabled:opacity-80`}
    >
      {on ? "✓" : ""}
      {changed && <span className="absolute -right-1 -top-1 size-2.5 rounded-full border-2 border-white bg-[#7C5AC7]" />}
    </button>
  );
}

function normalize(value: unknown): RolePermissions {
  const source = (value ?? {}) as Record<string, Partial<AreaPermission>>;
  const result: RolePermissions = {};
  for (const group of PERMISSION_AREAS) {
    for (const item of group.items) {
      const cell = source[item.key] ?? {};
      result[item.key] = {
        view: Boolean(cell.view),
        edit: Boolean(cell.edit),
        approve: Boolean(cell.approve),
      };
    }
  }
  return result;
}

function normalizeSparse(value: unknown): Partial<RolePermissions> {
  const source = (value ?? {}) as Record<string, Partial<AreaPermission>>;
  const result: Partial<RolePermissions> = {};
  for (const group of PERMISSION_AREAS) {
    for (const item of group.items) {
      const cell = source[item.key];
      if (!cell) continue;
      const clean: Partial<AreaPermission> = {};
      for (const column of COLUMNS) {
        if (typeof cell[column.key] === "boolean") clean[column.key] = cell[column.key];
      }
      if (Object.keys(clean).length > 0) result[item.key] = clean as AreaPermission;
    }
  }
  return result;
}

function merge(base: RolePermissions, override: Partial<RolePermissions>): RolePermissions {
  const result: RolePermissions = {};
  for (const group of PERMISSION_AREAS) {
    for (const item of group.items) {
      result[item.key] = {
        ...(base[item.key] ?? emptyPermission()),
        ...(override[item.key] ?? {}),
      };
    }
  }
  return result;
}

function diff(base: RolePermissions, value: RolePermissions): Partial<RolePermissions> {
  const result: Partial<RolePermissions> = {};
  for (const group of PERMISSION_AREAS) {
    for (const item of group.items) {
      const changed: Partial<AreaPermission> = {};
      for (const column of COLUMNS) {
        if (base[item.key]?.[column.key] !== value[item.key]?.[column.key]) {
          changed[column.key] = value[item.key]?.[column.key] ?? false;
        }
      }
      if (Object.keys(changed).length > 0) result[item.key] = changed as AreaPermission;
    }
  }
  return result;
}
