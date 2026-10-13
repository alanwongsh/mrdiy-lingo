"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  deleteAccessRole,
  saveRolePermissions,
  updateAccessRole,
} from "@/lib/actions/access-roles";
import {
  PERMISSION_GROUPS,
  PERMISSION_KEYS,
  canGrantRole,
  PERMISSIONS,
  type PermissionKey,
} from "@/lib/auth/permissions";
import type { AccessRole } from "@/lib/types";
import { CollapsibleSection } from "@/components/collapsible-section";
import { FilterSelect } from "@/components/filter-select";
import { Button, Field, inputClass } from "@/components/ui";

type Run = (task: () => Promise<void>, after?: () => void) => void;

function countLabel(count: number) {
  return count === 1 ? "1 person" : `${count} people`;
}

function groupKeys(group: string): PermissionKey[] {
  return PERMISSIONS.filter((item) => item.group === group).map((item) => item.key);
}

/**
 * Select all for one group. Only touches the permissions the signed-in person holds;
 * the others keep their current tick.
 */
function setGroup(
  held: readonly PermissionKey[],
  group: string,
  on: boolean,
  actorPermissions: readonly PermissionKey[]
): PermissionKey[] {
  const keys = groupKeys(group).filter((key) => actorPermissions.includes(key));
  const rest = held.filter((key) => !keys.includes(key));
  return on ? [...rest, ...keys] : rest;
}

function GroupCheckbox({
  held,
  group,
  disabled,
  onChange,
  actorPermissions,
}: {
  held: readonly PermissionKey[];
  group: string;
  disabled: boolean;
  actorPermissions: readonly PermissionKey[];
  onChange: (on: boolean) => void;
}) {
  const keys = groupKeys(group);
  const count = keys.filter((key) => held.includes(key)).length;
  const all = count === keys.length;
  const mine = keys.filter((key) => actorPermissions.includes(key));
  return (
    <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium normal-case tracking-normal text-[var(--hub-muted)]">
      <input
        type="checkbox"
        checked={all}
        ref={(element) => {
          if (element) element.indeterminate = count > 0 && !all;
        }}
        disabled={disabled || mine.length === 0}
        // Flip on what this person can change, so a group with a permission they lack still clears.
        onChange={() => onChange(!mine.every((key) => held.includes(key)))}
      />
      Select all
    </label>
  );
}

/**
 * Name, description, and grouped permission ticks. Adds a role, or edits one when
 * `role` is given. A new role can start from a copy of another role's permissions.
 */
function RoleForm({
  role,
  copyable,
  pending,
  run,
  applicationId,
  actorPermissions,
  onDone,
}: {
  role?: AccessRole;
  /** Roles the signed-in person may copy from. Only used when adding. */
  copyable: AccessRole[];
  pending: boolean;
  run: Run;
  applicationId: string | null;
  actorPermissions: readonly PermissionKey[];
  /** Called after a save, and on Cancel when editing. */
  onDone?: () => void;
}) {
  const [name, setName] = useState(role?.name ?? "");
  const [description, setDescription] = useState(role?.description ?? "");
  const [copyFromId, setCopyFromId] = useState("");
  const [permissions, setPermissions] = useState<PermissionKey[]>(() => [
    ...(role?.permissions ?? []),
  ]);

  function copyFrom(id: string) {
    setCopyFromId(id);
    const source = copyable.find((item) => item.id === id);
    setPermissions(source ? [...source.permissions] : []);
    if (source && !name.trim()) setName(`Copy of ${source.name}`.slice(0, 60));
    if (source && !description.trim()) setDescription(source.description);
  }

  function reset() {
    setName(role?.name ?? "");
    setDescription(role?.description ?? "");
    setCopyFromId("");
    setPermissions([...(role?.permissions ?? [])]);
  }

  function toggle(key: PermissionKey, checked: boolean) {
    setPermissions((current) =>
      checked ? [...current, key] : current.filter((item) => item !== key)
    );
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    run(
      () =>
        role
          ? updateAccessRole({ applicationId, id: role.id, name, description, permissions })
          : saveRolePermissions({
              applicationId,
              map: {},
              created: [{ name, description, permissions }],
            }),
      () => {
        if (!role) reset();
        onDone?.();
      }
    );
  }

  return (
    <form className="space-y-4" onSubmit={submit}>
      <div
        className={`grid gap-3 sm:items-end ${
          role ? "sm:grid-cols-[16rem_1fr]" : "sm:grid-cols-[16rem_1fr_16rem]"
        }`}
      >
        <Field label="Role name" required>
          <input
            className={inputClass}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Translator"
            maxLength={60}
            required
          />
        </Field>
        <Field label="Description">
          <input
            className={inputClass}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="What this role is for"
            maxLength={200}
          />
        </Field>
        {role ? null : (
          <FilterSelect
            label="Copy from"
            fullWidth
            value={copyFromId}
            placeholder="Blank role"
            options={copyable.map((item) => ({ value: item.id, label: item.name }))}
            onChange={copyFrom}
          />
        )}
      </div>
      <fieldset className="space-y-3">
        <legend className="text-xs font-semibold tracking-wide text-[var(--hub-muted-strong)]">
          Permissions{copyFromId ? " (copied, change as needed)" : ""}
        </legend>
        <div className="grid gap-4 lg:grid-cols-3">
          {PERMISSION_GROUPS.map((group) => (
            <div
              key={group}
              className="overflow-hidden rounded-lg border border-[var(--hub-border-strong)] bg-white shadow-sm"
            >
              <div className="flex items-center justify-between gap-2 border-b border-[var(--hub-border)] bg-slate-50 px-3 py-2 text-xs font-semibold tracking-wide text-[var(--hub-muted-strong)] uppercase">
                {group}
                <GroupCheckbox
                  held={permissions}
                  group={group}
                  actorPermissions={actorPermissions}
                  disabled={pending}
                  onChange={(on) =>
                    setPermissions((current) => setGroup(current, group, on, actorPermissions))
                  }
                />
              </div>
              <div className="space-y-2 p-3">
                {PERMISSIONS.filter((item) => item.group === group).map((permission) => (
                  <label key={permission.key} className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={permissions.includes(permission.key)}
                      disabled={pending || !actorPermissions.includes(permission.key)}
                      onChange={(event) => toggle(permission.key, event.target.checked)}
                    />
                    <span>
                      <span className="font-medium text-slate-900">{permission.label}</span>
                      <span className="block text-xs text-[var(--hub-muted)]">{permission.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      </fieldset>
      <div className="flex gap-2">
        <Button type="submit" disabled={pending || !name.trim()}>
          {pending ? "Saving…" : role ? "Save role" : "Add role"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={pending}
          onClick={() => {
            reset();
            if (role) onDone?.();
          }}
        >
          {role ? "Cancel" : "Clear"}
        </Button>
      </div>
    </form>
  );
}

function RoleRow({
  role,
  count,
  pending,
  run,
  applicationId,
  actorPermissions,
  changeable,
}: {
  role: AccessRole;
  count: number;
  pending: boolean;
  run: Run;
  applicationId: string | null;
  actorPermissions: readonly PermissionKey[];
  /** False when the role holds permissions the signed-in person does not. */
  changeable: boolean;
}) {
  const [editing, setEditing] = useState(false);

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-medium text-slate-900">{role.name}</div>
          <div className="text-sm text-[var(--hub-muted)]">
            {role.description || "No description"} ·{" "}
            {applicationId ? `${countLabel(count)} · ` : null}
            {role.permissions.length} of {PERMISSIONS.length} permissions
          </div>
        </div>
        {editing ? null : (
          <span className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={pending || !changeable}
              title={changeable ? undefined : "This role has permissions you do not hold."}
              onClick={() => setEditing(true)}
            >
              Edit
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={pending || !changeable || count > 0}
              title={count > 0 ? "Give these people another role first." : undefined}
              onClick={() => {
                if (!confirm(`Delete the “${role.name}” role?`)) return;
                run(() => deleteAccessRole({ applicationId, id: role.id }));
              }}
            >
              Delete
            </Button>
          </span>
        )}
      </div>
      {editing ? (
        <div className="mt-3 rounded-lg border border-[var(--hub-border)] bg-slate-50 p-4">
          <RoleForm
            role={role}
            copyable={[]}
            pending={pending}
            run={run}
            applicationId={applicationId}
            actorPermissions={actorPermissions}
            onDone={() => setEditing(false)}
          />
        </div>
      ) : null}
    </li>
  );
}

export function AccessRolesManager({
  roles,
  memberCounts,
  applicationId,
  actorPermissions = PERMISSION_KEYS,
}: {
  roles: AccessRole[];
  memberCounts: Record<string, number>;
  /** The application whose roles these are, or null for the default roles. */
  applicationId: string | null;
  /** What the signed-in person holds here. They can only tick these. */
  actorPermissions?: readonly PermissionKey[];
}) {
  const changeableRoles = roles.filter((role) =>
    canGrantRole({ permissions: actorPermissions }, role)
  );
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  function run(task: () => Promise<void>, after?: () => void) {
    setError("");
    startTransition(async () => {
      try {
        await task();
        after?.();
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not save.");
      }
    });
  }

  return (
    <div className="space-y-3">
      <CollapsibleSection
        id="roles"
        title="Roles"
        summary={`${roles.length} ${roles.length === 1 ? "role" : "roles"}`}
        defaultOpen
      >
        {roles.length === 0 ? (
          <p className="text-sm text-[var(--hub-muted)]">No roles yet. Add one under New role.</p>
        ) : (
          <ul className="divide-y divide-[var(--hub-border)]">
            {roles.map((role) => (
              <RoleRow
                key={`${role.id}:${role.name}:${role.description}:${role.permissions.join(",")}`}
                role={role}
                count={memberCounts[role.id] ?? 0}
                pending={pending}
                run={run}
                applicationId={applicationId}
                actorPermissions={actorPermissions}
                changeable={changeableRoles.some((item) => item.id === role.id)}
              />
            ))}
          </ul>
        )}
      </CollapsibleSection>

      <CollapsibleSection id="new-role" title="New role" summary="Start blank or copy an existing role">
        <RoleForm
          copyable={changeableRoles}
          pending={pending}
          run={run}
          applicationId={applicationId}
          actorPermissions={actorPermissions}
        />
      </CollapsibleSection>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
    </div>
  );
}
