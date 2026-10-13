"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import {
  deleteAccessRole,
  saveRolePermissions,
  updateAccessRoleDetails,
} from "@/lib/actions/access-roles";
import {
  PERMISSION_GROUPS,
  PERMISSION_KEYS,
  canGrantRole,
  PERMISSIONS,
  type PermissionKey,
} from "@/lib/auth/permissions";
import type { AccessRole } from "@/lib/types";
import { FilterSelect } from "@/components/filter-select";
import { Button, Card, Field, inputClass } from "@/components/ui";

type PermissionMap = Record<string, PermissionKey[]>;

function mapFromRoles(roles: AccessRole[]): PermissionMap {
  return Object.fromEntries(roles.map((role) => [role.id, [...role.permissions]]));
}

function sameMap(a: PermissionMap, b: PermissionMap): boolean {
  return Object.keys(a).every(
    (id) =>
      (a[id]?.length ?? 0) === (b[id]?.length ?? 0) &&
      (a[id] ?? []).every((key) => (b[id] ?? []).includes(key))
  );
}

function countLabel(count: number) {
  return count === 1 ? "1 person" : `${count} people`;
}

function PermissionMatrix({
  roles,
  memberCounts,
  pending,
  run,
  applicationId,
  actorPermissions,
}: {
  roles: AccessRole[];
  memberCounts: Record<string, number>;
  pending: boolean;
  run: (task: () => Promise<void>) => void;
  applicationId: string | null;
  actorPermissions: readonly PermissionKey[];
}) {
  const saved = useMemo(() => mapFromRoles(roles), [roles]);
  const [draft, setDraft] = useState<PermissionMap>(saved);
  const [savedAt, setSavedAt] = useState(saved);
  if (savedAt !== saved) {
    // Roles changed on the server (added, removed, or saved): start again from them.
    setSavedAt(saved);
    setDraft(saved);
  }
  const dirty = !sameMap(draft, saved);
  const actor = { permissions: actorPermissions };

  function toggle(roleId: string, key: PermissionKey, checked: boolean) {
    setDraft((current) => {
      const held = current[roleId] ?? [];
      return {
        ...current,
        [roleId]: checked ? [...held, key] : held.filter((item) => item !== key),
      };
    });
  }

  return (
    <Card className="p-5">
      <h2 className="text-base font-semibold">Permissions</h2>
      <p className="mt-1 text-sm text-[var(--hub-muted)]">
        {applicationId
          ? "Tick what each role can do. Changes apply to everyone holding the role once you save."
          : "Tick what each role starts with in a new application."}
      </p>
      {roles.length === 0 ? (
        <p className="mt-4 text-sm text-[var(--hub-muted)]">Add a role below to map its permissions.</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[36rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--hub-border)]">
                <th className="sticky left-0 bg-[var(--hub-panel)] py-2 pr-4 text-left font-semibold">
                  Permission
                </th>
                {roles.map((role) => (
                  <th key={role.id} className="px-3 py-2 text-center align-bottom font-semibold">
                    <div className="text-slate-900">{role.name}</div>
                    {applicationId ? (
                      <div className="text-xs font-normal text-[var(--hub-muted)]">
                        {countLabel(memberCounts[role.id] ?? 0)}
                      </div>
                    ) : null}
                  </th>
                ))}
              </tr>
            </thead>
            {PERMISSION_GROUPS.map((group) => (
              <tbody key={group}>
                <tr>
                  <th
                    colSpan={roles.length + 1}
                    className="sticky left-0 bg-[var(--hub-panel)] pt-4 pb-1 text-left text-xs font-semibold tracking-wide text-[var(--hub-muted-strong)] uppercase"
                  >
                    {group}
                  </th>
                </tr>
                {PERMISSIONS.filter((item) => item.group === group).map((permission) => (
                  <tr key={permission.key} className="border-b border-[var(--hub-border)]">
                    <td className="sticky left-0 max-w-[22rem] bg-[var(--hub-panel)] py-2 pr-4">
                      <div className="font-medium text-slate-900">{permission.label}</div>
                      <div className="text-xs text-[var(--hub-muted)]">{permission.hint}</div>
                    </td>
                    {roles.map((role) => (
                      <td key={role.id} className="px-3 py-2 text-center">
                        <input
                          type="checkbox"
                          aria-label={`${role.name}: ${permission.label}`}
                          checked={(draft[role.id] ?? []).includes(permission.key)}
                          disabled={
                            pending ||
                            !actorPermissions.includes(permission.key) ||
                            !canGrantRole(actor, role)
                          }
                          onChange={(event) =>
                            toggle(role.id, permission.key, event.target.checked)
                          }
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      )}
      <div className="mt-4 flex gap-2">
        <Button
          type="button"
          disabled={pending || !dirty}
          onClick={() => run(() => saveRolePermissions({ applicationId, map: draft }))}
        >
          {pending ? "Saving…" : "Save permissions"}
        </Button>
        {dirty ? (
          <Button type="button" variant="ghost" disabled={pending} onClick={() => setDraft(saved)}>
            Cancel
          </Button>
        ) : null}
      </div>
    </Card>
  );
}

/** A new role, optionally copied from an existing one as a draft, then adjusted before saving. */
function NewRoleForm({
  roles,
  pending,
  run,
  applicationId,
  actorPermissions,
}: {
  /** Roles the signed-in person may copy from. */
  roles: AccessRole[];
  pending: boolean;
  run: (task: () => Promise<void>, after?: () => void) => void;
  applicationId: string | null;
  actorPermissions: readonly PermissionKey[];
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [copyFromId, setCopyFromId] = useState("");
  const [permissions, setPermissions] = useState<PermissionKey[]>([]);

  function copyFrom(id: string) {
    setCopyFromId(id);
    const source = roles.find((role) => role.id === id);
    setPermissions(source ? [...source.permissions] : []);
    if (source && !name.trim()) setName(`Copy of ${source.name}`.slice(0, 60));
    if (source && !description.trim()) setDescription(source.description);
  }

  function clear() {
    setName("");
    setDescription("");
    setCopyFromId("");
    setPermissions([]);
  }

  function toggle(key: PermissionKey, checked: boolean) {
    setPermissions((current) =>
      checked ? [...current, key] : current.filter((item) => item !== key)
    );
  }

  return (
    <form
      className="mt-4 space-y-4 border-t border-[var(--hub-border)] pt-4"
      onSubmit={(event) => {
        event.preventDefault();
        run(
          () =>
            saveRolePermissions({
              applicationId,
              map: {},
              created: [{ name, description, permissions }],
            }),
          clear
        );
      }}
    >
      <h3 className="text-sm font-semibold">New role</h3>
      <div className="grid gap-3 sm:grid-cols-[16rem_1fr_16rem] sm:items-end">
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
        <FilterSelect
          label="Copy from"
          fullWidth
          value={copyFromId}
          placeholder="Blank role"
          options={roles.map((role) => ({ value: role.id, label: role.name }))}
          onChange={copyFrom}
        />
      </div>
      <fieldset className="space-y-3">
        <legend className="text-xs font-semibold tracking-wide text-[var(--hub-muted-strong)]">
          Permissions{copyFromId ? " (copied, change as needed)" : ""}
        </legend>
        <div className="grid gap-4 lg:grid-cols-3">
          {PERMISSION_GROUPS.map((group) => (
            <div
              key={group}
              className="rounded-lg border border-[var(--hub-border)] p-3"
            >
              <div className="mb-2 text-xs font-semibold tracking-wide text-[var(--hub-muted-strong)] uppercase">
                {group}
              </div>
              <div className="space-y-2">
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
          {pending ? "Saving…" : "Add role"}
        </Button>
        <Button type="button" variant="ghost" disabled={pending} onClick={clear}>
          Clear
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
  changeable,
}: {
  role: AccessRole;
  count: number;
  pending: boolean;
  run: (task: () => Promise<void>, after?: () => void) => void;
  applicationId: string | null;
  /** False when the role holds permissions the signed-in person does not. */
  changeable: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(role.name);
  const [description, setDescription] = useState(role.description);

  if (editing) {
    return (
      <li className="py-3">
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            run(
              () => updateAccessRoleDetails({ applicationId, id: role.id, name, description }),
              () => setEditing(false)
            );
          }}
        >
          <Field label="Role name" required>
            <input
              className={inputClass}
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={60}
              required
            />
          </Field>
          <div className="min-w-[14rem] flex-1">
            <Field label="Description">
              <input
                className={inputClass}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                maxLength={200}
              />
            </Field>
          </div>
          <Button type="submit" disabled={pending}>
            Save
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={pending}
            onClick={() => {
              setName(role.name);
              setDescription(role.description);
              setEditing(false);
            }}
          >
            Cancel
          </Button>
        </form>
      </li>
    );
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div>
        <div className="font-medium text-slate-900">{role.name}</div>
        <div className="text-sm text-[var(--hub-muted)]">
          {role.description || "No description"} ·{" "}
          {applicationId ? `${countLabel(count)} · ` : null}
          {role.permissions.length} of {PERMISSIONS.length} permissions
        </div>
      </div>
      <span className="flex gap-2">
        <Button
          type="button"
          variant="secondary"
          disabled={pending || !changeable}
          onClick={() => setEditing(true)}
        >
          Rename
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
    <div className="space-y-6">
      <PermissionMatrix
        roles={roles}
        memberCounts={memberCounts}
        pending={pending}
        run={run}
        applicationId={applicationId}
        actorPermissions={actorPermissions}
      />

      <Card className="p-5">
        <h2 className="text-base font-semibold">Roles</h2>
        <p className="mt-1 text-sm text-[var(--hub-muted)]">
          {applicationId
            ? "Each person on this application holds one of these roles. Rename them or change their description here, or add a new one below."
            : "Every new application starts with a copy of these roles."}
        </p>
        <ul className="mt-2 divide-y divide-[var(--hub-border)]">
          {roles.map((role) => (
            <RoleRow
              key={`${role.id}:${role.name}:${role.description}`}
              role={role}
              count={memberCounts[role.id] ?? 0}
              pending={pending}
              run={run}
              applicationId={applicationId}
              changeable={changeableRoles.some((item) => item.id === role.id)}
            />
          ))}
        </ul>
        <NewRoleForm
          roles={changeableRoles}
          pending={pending}
          run={run}
          applicationId={applicationId}
          actorPermissions={actorPermissions}
        />
      </Card>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
    </div>
  );
}
