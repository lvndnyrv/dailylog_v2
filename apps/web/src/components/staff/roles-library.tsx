"use client";

import type { CenterRole } from "@dailylog/db/queries";
import {
  PERMISSION_AREAS,
  PERMISSION_ITEMS,
  emptyPermission,
  type AreaPermission,
  type RolePermissions,
} from "@dailylog/shared";
import { useActionState, useEffect, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Modal } from "@/components/ui/modal";
import { Field } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import {
  createRoleAction,
  deleteRoleAction,
  duplicateRoleAction,
  saveRoleAction,
  type RoleActionState,
} from "@/lib/roles/actions";

const COLUMNS: { key: keyof AreaPermission; label: string }[] = [
  { key: "view", label: "VIEW" },
  { key: "edit", label: "EDIT" },
  { key: "approve", label: "APPROVE" },
];

export function RolesLibrary({ roles }: { roles: CenterRole[] }) {
  const [selectedId, setSelectedId] = useState(roles[0]?.id ?? "");
  const [dialog, setDialog] = useState<"none" | "create" | "rename" | "duplicate">("none");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const selected = roles.find((r) => r.id === selectedId) ?? roles[0] ?? null;

  // Local editable copy of the matrix. Reset during render (not via an effect)
  // when the selected role changes — the pattern React recommends for this.
  const [draft, setDraft] = useState<RolePermissions>(() => normalize(selected?.permissions));
  const [draftRoleId, setDraftRoleId] = useState(selected?.id ?? "");
  if (selected && selected.id !== draftRoleId) {
    setDraftRoleId(selected.id);
    setDraft(normalize(selected.permissions));
  }

  const [state, save, saving] = useActionState<RoleActionState, FormData>(saveRoleAction, {});

  if (!selected) {
    return <p className="p-4 text-[12.5px] text-faint">No roles configured.</p>;
  }

  const locked = selected.is_locked;
  const dirty = selected && JSON.stringify(draft) !== JSON.stringify(normalize(selected.permissions));

  const toggle = (area: string, col: keyof AreaPermission) => {
    if (locked) return;
    setDraft((d) => ({
      ...d,
      [area]: { ...(d[area] ?? emptyPermission()), [col]: !(d[area] ?? emptyPermission())[col] },
    }));
  };

  return (
    <div className="grid grid-cols-[280px_minmax(0,1fr)] gap-4">
      {/* Left: role list */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 px-1">
          <span className="text-[13px] font-extrabold text-ink">Roles</span>
          <span className="text-[11.5px] text-faint">{roles.length}</span>
        </div>
        <button
          type="button"
          onClick={() => setDialog("create")}
          className="rounded-[14px] bg-tint px-3 py-3 text-[12.5px] font-bold text-primary hover:brightness-95"
        >
          + Create custom role
        </button>
        {roles.map((role) => {
          const active = role.id === selected.id;
          return (
            <button
              key={role.id}
              type="button"
              onClick={() => setSelectedId(role.id)}
              className={`flex items-center gap-2.5 rounded-[14px] border-[1.5px] px-3 py-2.5 text-left ${
                active ? "border-[var(--primary)] bg-[#F4F8FD]" : "border-[#EDF3FB] bg-card hover:bg-canvas"
              }`}
            >
              {role.is_locked ? (
                <span className="grid size-8 flex-none place-items-center rounded-[10px] bg-ink text-white">
                  🛡
                </span>
              ) : (
                <Avatar name={role.name} size={32} />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-bold text-ink">{role.name}</span>
                <span className="block text-[11px] text-faint">
                  {role.member_count} {role.member_count === 1 ? "person" : "people"}
                  {role.is_locked ? " · locked" : ""}
                </span>
              </span>
              {active && <span className="text-faint">›</span>}
            </button>
          );
        })}
      </div>

      {/* Right: matrix */}
      <form action={save} className="flex flex-col rounded-2xl border border-[rgba(23,51,91,.1)] bg-card">
        <input type="hidden" name="role_id" value={selected.id} />
        <input type="hidden" name="name" value={selected.name} />
        <input type="hidden" name="description" value={selected.description ?? ""} />
        {PERMISSION_ITEMS.map((item) => {
          const p = draft[item.key] ?? emptyPermission();
          return (
            <span key={item.key}>
              <input type="hidden" name={`perm_${item.key}_view`} value={p.view ? "1" : "0"} />
              <input type="hidden" name={`perm_${item.key}_edit`} value={p.edit ? "1" : "0"} />
              <input type="hidden" name={`perm_${item.key}_approve`} value={p.approve ? "1" : "0"} />
            </span>
          );
        })}

        {/* Header */}
        <div className="flex items-center gap-3 border-b border-[#EDF3FB] px-5 py-4">
          {selected.is_locked ? (
            <span className="grid size-9 flex-none place-items-center rounded-[10px] bg-ink text-white">🛡</span>
          ) : (
            <Avatar name={selected.name} size={36} />
          )}
          <span className="min-w-0 flex-1">
            <span className="block text-[16px] font-extrabold text-ink">{selected.name}</span>
            <span className="block text-[12px] text-muted">
              {selected.description ?? "Custom role"} · {selected.member_count}{" "}
              {selected.member_count === 1 ? "person" : "people"}
            </span>
          </span>
          {!locked && (
            <>
              <button
                type="button"
                onClick={() => setDialog("duplicate")}
                className="rounded-btn border-[1.5px] border-[#D6E1F0] bg-card px-3.5 py-1.5 text-[12px] font-bold text-ink hover:bg-canvas"
              >
                Duplicate
              </button>
              <button
                type="button"
                onClick={() => setDialog("rename")}
                className="rounded-btn border-[1.5px] border-[#D6E1F0] bg-card px-3.5 py-1.5 text-[12px] font-bold text-ink hover:bg-canvas"
              >
                Rename
              </button>
              {/* Only custom (non-system) roles can be removed. */}
              {!selected.is_system && (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="rounded-btn border-[1.5px] border-[#EFC9C9] bg-card px-3.5 py-1.5 text-[12px] font-bold text-danger hover:bg-danger-bg"
                >
                  Delete
                </button>
              )}
            </>
          )}
        </div>

        {/* Intro */}
        <div className="flex items-start gap-3 px-5 py-3">
          <p className="flex-1 text-[12px] leading-relaxed text-muted">
            {locked ? (
              <>The owner role has every permission and can&apos;t be edited.</>
            ) : (
              <>
                These are the <b className="text-ink">defaults</b> for everyone with this role.
                Individuals can be fine-tuned in their profile — those become{" "}
                <b className="text-ink">overrides</b>.{" "}
                {/* Per-person override screen (4e) is not built yet — kept as a hint. */}
                <span className="whitespace-nowrap font-semibold text-faint">
                  See a person&apos;s matrix →
                </span>
              </>
            )}
          </p>
        </div>

        {/* Matrix */}
        <div className="max-h-[calc(100vh-360px)] overflow-y-auto px-5">
          <div className="grid grid-cols-[minmax(0,1fr)_64px_64px_72px] items-center gap-2 border-b border-[#EDF3FB] py-2">
            <span className="font-mono text-[10px] font-bold tracking-[.08em] text-faint">AREA</span>
            {COLUMNS.map((c) => (
              <span key={c.key} className="text-center font-mono text-[10px] font-bold tracking-[.08em] text-faint">
                {c.label}
              </span>
            ))}
          </div>
          {PERMISSION_AREAS.map((group) => (
            <div key={group.group}>
              <div className="pb-1 pt-3 font-mono text-[10px] font-bold uppercase tracking-[.08em] text-warning-text">
                {group.group}
              </div>
              {group.items.map((item) => {
                const p = draft[item.key] ?? emptyPermission();
                return (
                  <div
                    key={item.key}
                    className="grid grid-cols-[minmax(0,1fr)_64px_64px_72px] items-center gap-2 border-b border-[#EDF3FB] py-2.5 last:border-b-0"
                  >
                    <span className="text-[13px] font-semibold text-ink">{item.label}</span>
                    {COLUMNS.map((c) => (
                      <span key={c.key} className="flex justify-center">
                        <PermCell
                          on={p[c.key]}
                          locked={locked}
                          onClick={() => toggle(item.key, c.key)}
                        />
                      </span>
                    ))}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="mt-auto flex items-center gap-3 border-t border-[#EDF3FB] px-5 py-3.5">
          <p className="flex-1 text-[11.5px] text-faint">
            {state.ok && !dirty ? (
              <span className="font-bold text-success">Saved.</span>
            ) : state.error ? (
              <span className="font-bold text-danger">{state.error}</span>
            ) : locked ? (
              "This role is locked."
            ) : (
              <>
                Changing a role&apos;s defaults updates the{" "}
                <b className="text-ink">
                  {selected.member_count} {selected.member_count === 1 ? "person" : "people"}
                </b>{" "}
                who hold it, except where they have a personal override.
              </>
            )}
          </p>
          {!locked && (
            <>
              <button
                type="button"
                onClick={() => setDraft(normalize(selected.permissions))}
                disabled={!dirty}
                className="rounded-btn border-[1.5px] border-[#D6E1F0] bg-card px-4 py-2 text-[13px] font-bold text-ink hover:bg-canvas disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving || !dirty}
                className="rounded-btn bg-primary px-4 py-2 text-[13px] font-bold text-white hover:bg-primary-hover disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save role"}
              </button>
            </>
          )}
        </div>
      </form>

      {dialog !== "none" && (
        <RoleDialog
          kind={dialog}
          role={selected}
          onClose={() => setDialog("none")}
          onCreated={(id) => {
            setDialog("none");
            if (id) setSelectedId(id);
          }}
        />
      )}

      {confirmDelete && (
        <Modal onClose={() => setConfirmDelete(false)} width={420}>
          <div>
            <h2 className="text-[19px] font-extrabold text-ink">Delete “{selected.name}”?</h2>
            <p className="mt-0.5 text-[12.5px] leading-normal text-muted">
              {selected.member_count > 0 ? (
                <>
                  This role is held by{" "}
                  <b className="text-ink">
                    {selected.member_count}{" "}
                    {selected.member_count === 1 ? "person" : "people"}
                  </b>{" "}
                  — reassign them first, then delete.
                </>
              ) : (
                <>This can&apos;t be undone. The role is removed for this center.</>
              )}
            </p>
          </div>
          <form
            action={deleteRoleAction}
            onSubmit={() => {
              setSelectedId(roles[0]?.id ?? "");
              setConfirmDelete(false);
            }}
            className="flex gap-2.5"
          >
            <input type="hidden" name="role_id" value={selected.id} />
            <Button
              type="button"
              variant="secondary"
              className="flex-1 py-3 text-sm"
              onClick={() => setConfirmDelete(false)}
            >
              Cancel
            </Button>
            <button
              type="submit"
              disabled={selected.member_count > 0}
              className="rounded-btn flex-1 bg-danger py-3 text-sm font-bold text-white hover:brightness-95 disabled:opacity-50"
            >
              Delete role
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}

function PermCell({
  on,
  locked,
  onClick,
}: {
  on: boolean;
  locked: boolean;
  onClick: () => void;
}) {
  if (on) {
    return (
      <button
        type="button"
        disabled={locked}
        onClick={onClick}
        aria-pressed
        className="grid size-6 place-items-center rounded-[7px] bg-success text-white disabled:opacity-90"
      >
        ✓
      </button>
    );
  }
  return (
    <button
      type="button"
      disabled={locked}
      onClick={onClick}
      aria-pressed={false}
      className="grid size-6 place-items-center rounded-[7px] border-[1.5px] border-[#E4ECF6] text-faint hover:border-[#D6E1F0] disabled:border-transparent"
    >
      {locked ? "—" : ""}
    </button>
  );
}

function RoleDialog({
  kind,
  role,
  onClose,
  onCreated,
}: {
  kind: "create" | "rename" | "duplicate";
  role: CenterRole;
  onClose: () => void;
  onCreated: (id?: string) => void;
}) {
  const action =
    kind === "create" ? createRoleAction : kind === "duplicate" ? duplicateRoleAction : saveRoleAction;
  const [state, run, pending] = useActionState<RoleActionState, FormData>(action, {});
  // Rename/duplicate carry the role's *saved* matrix, never unsaved edits.
  const saved = normalize(role.permissions);

  useEffect(() => {
    if (state.ok) onCreated(state.newRoleId);
  }, [state, onCreated]);

  const title =
    kind === "create" ? "Create a custom role" : kind === "duplicate" ? "Duplicate role" : "Rename role";
  const defaultName =
    kind === "duplicate" ? `${role.name} copy` : kind === "rename" ? role.name : "";

  return (
    <Modal onClose={onClose} width={430}>
      <div>
        <h2 className="text-[19px] font-extrabold text-ink">{title}</h2>
        <p className="mt-0.5 text-[12.5px] leading-normal text-muted">
          {kind === "duplicate"
            ? `Copies ${role.name}'s permission matrix into a new role.`
            : kind === "rename"
              ? "Everyone with this role keeps their permissions."
              : "Starts blank — set its permissions in the matrix."}
        </p>
      </div>
      <form action={run} className="flex flex-col gap-4">
        {kind === "rename" && (
          <>
            <input type="hidden" name="role_id" value={role.id} />
            <input type="hidden" name="description" value={role.description ?? ""} />
          </>
        )}
        {kind === "duplicate" && (
          <>
            <input type="hidden" name="permissions" value={JSON.stringify(saved)} />
            <input type="hidden" name="base_role" value={role.base_role} />
          </>
        )}
        {kind === "rename" &&
          PERMISSION_ITEMS.map((item) => {
            const p = saved[item.key] ?? emptyPermission();
            return (
              <span key={item.key}>
                <input type="hidden" name={`perm_${item.key}_view`} value={p.view ? "1" : "0"} />
                <input type="hidden" name={`perm_${item.key}_edit`} value={p.edit ? "1" : "0"} />
                <input type="hidden" name={`perm_${item.key}_approve`} value={p.approve ? "1" : "0"} />
              </span>
            );
          })}
        <Field label="Role name" name="name" defaultValue={defaultName} required autoFocus />
        {kind !== "rename" && (
          <Field
            label="Short description"
            name="description"
            defaultValue={kind === "duplicate" ? (role.description ?? "") : ""}
            placeholder="What this role does day to day"
          />
        )}
        {state.error && <Notice tone="error">{state.error}</Notice>}
        <div className="flex gap-2.5">
          <Button type="button" variant="secondary" className="flex-1 py-3 text-sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" className="flex-1 py-3 text-sm" disabled={pending}>
            {pending ? "Saving…" : kind === "rename" ? "Rename" : "Create"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// Coerce a stored permissions jsonb into a full matrix, defaulting missing areas.
function normalize(permissions: unknown): RolePermissions {
  const src = (permissions ?? {}) as Record<string, Partial<AreaPermission>>;
  const out: RolePermissions = {};
  for (const group of PERMISSION_AREAS) {
    for (const item of group.items) {
      const p = src[item.key] ?? {};
      out[item.key] = {
        view: Boolean(p.view),
        edit: Boolean(p.edit),
        approve: Boolean(p.approve),
      };
    }
  }
  return out;
}
