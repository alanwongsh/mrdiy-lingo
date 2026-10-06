"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  inviteApplicationMember,
  removeApplicationMember,
  setApplicationOwner,
  updateApplicationMember,
} from "@/lib/actions/applications";
import type { OrgRoleBand } from "@/lib/auth/roles";
import type { ApplicationMemberView, OrgRoleMapping } from "@/lib/types";
import { Button, Card, Field, inputClass } from "@/components/ui";

function RoleSelect({
  value,
  roles,
  onChange,
}: {
  value: string;
  roles: OrgRoleMapping[];
  onChange: (value: string) => void;
}) {
  const groups: OrgRoleBand[] = ["HOD", "EDITOR"];
  const known = roles.some(
    (role) => role.ldap_role.toLowerCase() === value.trim().toLowerCase()
  );
  return (
    <select
      className={inputClass}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">No role</option>
      {value && !known ? <option value={value}>{value}</option> : null}
      {groups.map((band) => {
        const items = roles.filter((role) => role.band === band);
        if (items.length === 0) return null;
        return (
          <optgroup key={band} label={band === "HOD" ? "HOD" : "Editor"}>
            {items.map((role) => (
              <option key={role.id} value={role.ldap_role}>
                {role.ldap_role}
              </option>
            ))}
          </optgroup>
        );
      })}
    </select>
  );
}

function MemberRow({
  applicationId,
  member,
  orgRoles,
}: {
  applicationId: string;
  member: ApplicationMemberView;
  orgRoles: OrgRoleMapping[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [ldapRole, setLdapRole] = useState(member.ldapRole ?? "");

  function save() {
    setError("");
    startTransition(async () => {
      try {
        await updateApplicationMember({
          applicationId,
          membershipId: member.membershipId,
          ldapRole,
        });
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not save access.");
      }
    });
  }

  function remove() {
    setError("");
    startTransition(async () => {
      try {
        await removeApplicationMember({
          applicationId,
          membershipId: member.membershipId,
        });
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not remove this person.");
      }
    });
  }

  return (
    <div className="border-b border-[var(--hub-border)] py-3 last:border-b-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-medium text-slate-900">{member.displayName}</div>
          {member.detail ? (
            <div className="text-sm text-[var(--hub-muted)]">{member.detail}</div>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-2">
            <span className="text-[var(--hub-muted)]">Role</span>
            <RoleSelect value={ldapRole} roles={orgRoles} onChange={setLdapRole} />
          </label>
          <Button type="button" variant="secondary" disabled={pending} onClick={save}>
            Save
          </Button>
          <Button type="button" variant="ghost" disabled={pending} onClick={remove}>
            Remove
          </Button>
        </div>
      </div>
      {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
    </div>
  );
}

export function ApplicationAccessPanel({
  applicationId,
  owner,
  members,
  orgRoles,
  isSuperadmin,
}: {
  applicationId: string;
  owner: ApplicationMemberView | null;
  members: ApplicationMemberView[];
  orgRoles: OrgRoleMapping[] | null;
  isSuperadmin: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [identity, setIdentity] = useState("");
  const [ownerIdentity, setOwnerIdentity] = useState("");
  const [ldapRole, setLdapRole] = useState("");
  const [error, setError] = useState("");
  const roles = orgRoles ?? [];

  function invite(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    startTransition(async () => {
      try {
        const result = await inviteApplicationMember({
          applicationId,
          identity,
          ldapRole,
        });
        if (result.error) {
          setError(result.error);
          return;
        }
        setIdentity("");
        setLdapRole("");
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not invite this person.");
      }
    });
  }

  function assignOwner(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    startTransition(async () => {
      try {
        const result = await setApplicationOwner({
          applicationId,
          identity: ownerIdentity,
        });
        if (result.error) {
          setError(result.error);
          return;
        }
        setOwnerIdentity("");
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not set the owner.");
      }
    });
  }

  return (
    <Card className="mt-8 p-5">
      <h2 className="text-base font-semibold">People</h2>
      {orgRoles === null ? (
        <p className="mt-3 text-sm text-amber-800">
          Run migration 012 from Setup before assigning roles.
        </p>
      ) : null}

      <div className="mt-4 border-b border-[var(--hub-border)] pb-3">
        <div className="text-xs font-semibold tracking-wide text-[var(--hub-muted-strong)] uppercase">
          Owner
        </div>
        {owner ? (
          <div className="mt-2">
            <div className="font-medium text-slate-900">{owner.displayName}</div>
            {owner.detail ? (
              <div className="text-sm text-[var(--hub-muted)]">{owner.detail}</div>
            ) : null}
          </div>
        ) : (
          <p className="mt-2 text-sm text-[var(--hub-muted)]">No owner yet.</p>
        )}
        {isSuperadmin ? (
          <form onSubmit={assignOwner} className="mt-3 flex flex-wrap items-end gap-2">
            <Field label="Set owner">
              <input
                className={inputClass}
                value={ownerIdentity}
                onChange={(event) => setOwnerIdentity(event.target.value)}
                placeholder="Email or employee ID"
                required
              />
            </Field>
            <Button type="submit" variant="secondary" disabled={pending}>
              Set owner
            </Button>
          </form>
        ) : null}
      </div>

      <div className="mt-4">
        {members.length === 0 ? (
          <p className="text-sm text-[var(--hub-muted)]">No one else is invited.</p>
        ) : (
          members.map((member) => (
            <MemberRow
              key={member.membershipId}
              applicationId={applicationId}
              member={member}
              orgRoles={roles}
            />
          ))
        )}
      </div>

      <form onSubmit={invite} className="mt-4 space-y-3 border-t border-[var(--hub-border)] pt-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_16rem] sm:items-end">
          <Field label="Invite">
            <input
              className={inputClass}
              value={identity}
              onChange={(event) => setIdentity(event.target.value)}
              placeholder="Email or employee ID"
              required
            />
          </Field>
          <Field label="Role">
            <RoleSelect value={ldapRole} roles={roles} onChange={setLdapRole} />
          </Field>
        </div>
        <Button type="submit" disabled={pending || (roles.length === 0 && ldapRole.trim().length > 0)}>
          {pending ? "Saving…" : "Add person"}
        </Button>
      </form>
      {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}
    </Card>
  );
}
