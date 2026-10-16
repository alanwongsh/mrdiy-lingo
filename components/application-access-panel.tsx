"use client";

import { errorMessage } from "@/lib/errors";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  inviteApplicationMember,
  removeApplicationMember,
  setApplicationMemberPassword,
  setApplicationOwner,
  updateApplicationMember,
} from "@/lib/actions/applications";
import type { OrgRoleBand } from "@/lib/auth/roles";
import { canGrantRole, type PermissionKey } from "@/lib/auth/permissions";
import type { AccessRole, ApplicationMemberView, OrgRoleMapping } from "@/lib/types";
import { FilterSelect, type FilterOption } from "@/components/filter-select";
import { CollapsibleSection } from "@/components/collapsible-section";
import { Badge, Button, Card, Field, inputClass } from "@/components/ui";

/**
 * Job titles are hidden on the People page for now; the code stays so they can come back.
 * Before the role migrations the job title is still the role picker, so it always shows then.
 */
const SHOW_JOB_TITLES = false;

/** Job titles. Grouped by approval only before roles are set up. */
function JobTitleSelect({
  value,
  roles,
  onChange,
  label,
  ariaLabel,
  fullWidth = false,
  grouped,
}: {
  value: string;
  roles: OrgRoleMapping[];
  onChange: (value: string) => void;
  label?: string;
  ariaLabel?: string;
  fullWidth?: boolean;
  grouped: boolean;
}) {
  const groups: OrgRoleBand[] = ["HOD", "EDITOR"];
  const known = roles.some(
    (role) => role.ldap_role.toLowerCase() === value.trim().toLowerCase()
  );
  const listed: FilterOption[] = grouped
    ? groups.flatMap((band) =>
        roles
          .filter((role) => role.band === band)
          .map((role) => ({
            value: role.ldap_role,
            label: role.ldap_role,
            group: band === "HOD" ? "Can approve" : "Edit and draft",
          }))
      )
    : roles.map((role) => ({ value: role.ldap_role, label: role.ldap_role }));
  const options: FilterOption[] = [
    ...(value && !known ? [{ value, label: value }] : []),
    ...listed,
  ];
  return (
    <FilterSelect
      label={label}
      ariaLabel={ariaLabel}
      fullWidth={fullWidth}
      value={value}
      placeholder={grouped ? "No role" : "No job title"}
      options={options}
      onChange={onChange}
    />
  );
}

function AccessRoleSelect({
  value,
  roles,
  onChange,
  label,
  ariaLabel,
  fullWidth = false,
  disabled = false,
}: {
  value: string;
  roles: AccessRole[];
  onChange: (value: string) => void;
  label?: string;
  ariaLabel?: string;
  fullWidth?: boolean;
  disabled?: boolean;
}) {
  return (
    <FilterSelect
      label={label}
      ariaLabel={ariaLabel}
      fullWidth={fullWidth}
      disabled={disabled}
      value={value}
      placeholder="Choose a role"
      hideEmptyOption
      options={roles.map((role) => ({ value: role.id, label: role.name }))}
      onChange={onChange}
    />
  );
}

/** Role for someone new: the first one that cannot approve, so access starts small. */
function defaultRoleId(roles: AccessRole[]): string {
  return (
    roles.find(
      (role) =>
        role.permissions.includes("content.edit") && !role.permissions.includes("content.approve")
    ) ?? roles[0]
  )?.id ?? "";
}

function MemberRow({
  applicationId,
  member,
  orgRoles,
  accessRoles,
  grantable,
}: {
  applicationId: string;
  member: ApplicationMemberView;
  orgRoles: OrgRoleMapping[];
  accessRoles: AccessRole[] | null;
  /** Roles the signed-in person may give. */
  grantable: AccessRole[];
}) {
  const current = accessRoles?.find((role) => role.id === member.accessRoleId);
  // Someone whose role holds more than yours is shown but not changed.
  const locked = !!current && !grantable.some((role) => role.id === current.id);
  const choices = locked && current ? [current] : grantable;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [ldapRole, setLdapRole] = useState(member.ldapRole ?? "");
  const [accessRoleId, setAccessRoleId] = useState(member.accessRoleId ?? "");
  const changed =
    ldapRole !== (member.ldapRole ?? "") || accessRoleId !== (member.accessRoleId ?? "");
  const [editingPassword, setEditingPassword] = useState(false);
  const [password, setPassword] = useState("");
  const [notice, setNotice] = useState("");

  function savePassword(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setNotice("");
    startTransition(async () => {
      try {
        const result = await setApplicationMemberPassword({
          applicationId,
          membershipId: member.membershipId,
          password,
        });
        if (result.error) {
          setError(result.error);
          return;
        }
        setPassword("");
        setEditingPassword(false);
        setNotice("Password saved.");
      } catch (err) {
        setError(errorMessage(err, "Could not set the password."));
      }
    });
  }

  function cancelPassword() {
    setPassword("");
    setEditingPassword(false);
    setError("");
  }

  function save() {
    setError("");
    startTransition(async () => {
      try {
        await updateApplicationMember({
          applicationId,
          membershipId: member.membershipId,
          ldapRole,
          accessRoleId,
        });
        router.refresh();
      } catch (err) {
        setError(errorMessage(err, "Could not save access."));
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
        setError(errorMessage(err, "Could not remove this person."));
      }
    });
  }

  return (
    <div className="border-b border-[var(--hub-border)] py-3 last:border-b-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-slate-900">{member.displayName}</span>
            {member.signedIn ? null : <Badge tone="warn">Invited, not signed in yet</Badge>}
          </div>
          {member.detail ? (
            <div className="text-sm text-[var(--hub-muted)]">{member.detail}</div>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          {accessRoles ? (
            <div className="flex items-center gap-2">
              <span className="text-[var(--hub-muted)]" aria-hidden>
                Role
              </span>
              <AccessRoleSelect
                ariaLabel="Role"
                value={accessRoleId}
                roles={choices}
                onChange={setAccessRoleId}
                disabled={locked}
              />
            </div>
          ) : null}
          {/* Job title is hidden for now. Set SHOW_JOB_TITLES to true to bring it back. */}
          {SHOW_JOB_TITLES || !accessRoles ? (
            <div className="flex items-center gap-2">
              <span className="text-[var(--hub-muted)]" aria-hidden>
                {accessRoles ? "Job title" : "Role"}
              </span>
              <JobTitleSelect
                ariaLabel={accessRoles ? "Job title" : "Role"}
                value={ldapRole}
                roles={orgRoles}
                onChange={setLdapRole}
                grouped={!accessRoles}
              />
            </div>
          ) : null}
          <Button
            type="button"
            variant="secondary"
            disabled={pending || locked || !changed || (!!accessRoles && !accessRoleId)}
            onClick={save}
          >
            Save
          </Button>
          {changed ? (
            <Button
              type="button"
              variant="ghost"
              disabled={pending}
              onClick={() => {
                setLdapRole(member.ldapRole ?? "");
                setAccessRoleId(member.accessRoleId ?? "");
                setError("");
              }}
            >
              Cancel
            </Button>
          ) : null}
          {editingPassword ? null : (
            <Button
              type="button"
              variant="ghost"
              disabled={pending}
              onClick={() => {
                setNotice("");
                setEditingPassword(true);
              }}
            >
              Set password
            </Button>
          )}
          <Button type="button" variant="ghost" disabled={pending || locked} onClick={remove}>
            Remove
          </Button>
        </div>
      </div>
      {editingPassword ? (
        <form onSubmit={savePassword} className="mt-3 flex flex-wrap items-end gap-2">
          <Field label="New sign-in password">
            <input
              type="password"
              className={inputClass}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              minLength={8}
              maxLength={200}
              required
            />
          </Field>
          <Button type="submit" variant="secondary" disabled={pending}>
            Save password
          </Button>
          <Button type="button" variant="ghost" disabled={pending} onClick={cancelPassword}>
            Cancel
          </Button>
        </form>
      ) : null}
      {notice ? <p className="mt-2 text-sm text-emerald-700">{notice}</p> : null}
      {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
    </div>
  );
}

export function ApplicationAccessPanel({
  applicationId,
  owner,
  members,
  orgRoles,
  accessRoles,
  actorPermissions,
  isSuperadmin,
}: {
  applicationId: string;
  owner: ApplicationMemberView | null;
  members: ApplicationMemberView[];
  orgRoles: OrgRoleMapping[] | null;
  /** Null until migrations 025 and 026 are run; the job title group decides until then. */
  accessRoles: AccessRole[] | null;
  /** Permissions of the signed-in person here. They can only give roles within these. */
  actorPermissions: PermissionKey[];
  isSuperadmin: boolean;
}) {
  const grantable = (accessRoles ?? []).filter((role) =>
    canGrantRole({ permissions: actorPermissions }, role)
  );
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [identity, setIdentity] = useState("");
  const [ownerIdentity, setOwnerIdentity] = useState("");
  const [ldapRole, setLdapRole] = useState("");
  const [accessRoleId, setAccessRoleId] = useState(() => defaultRoleId(grantable));
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
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
          accessRoleId,
          displayName,
          password,
        });
        if (result.error) {
          setError(result.error);
          return;
        }
        setIdentity("");
        setLdapRole("");
        setAccessRoleId(defaultRoleId(grantable));
        setDisplayName("");
        setPassword("");
        router.refresh();
      } catch (err) {
        setError(errorMessage(err, "Could not invite this person."));
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
        setError(errorMessage(err, "Could not set the owner."));
      }
    });
  }

  return (
    <>
    <Card className="mt-8 p-5">
      <h2 className="text-base font-semibold">People</h2>
      {orgRoles === null ? (
        <p className="mt-3 text-sm text-amber-800">
          Run migration 012 from Setup before assigning roles.
        </p>
      ) : accessRoles === null ? (
        <p className="mt-3 text-sm text-amber-800">
          Run migrations 025 and 026 from Setup to give people roles such as Translator or Reviewer.
        </p>
      ) : (
        <p className="mt-1 text-sm text-[var(--hub-muted)]">
          The role decides what someone can do in this application.
          {/* {" "}The job title is shown only. */}
        </p>
      )}

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
                placeholder="Company email"
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
              accessRoles={accessRoles}
              grantable={grantable}
            />
          ))
        )}
      </div>

    </Card>

      <div className="mt-3">
      <CollapsibleSection id="add-person" title="Add person">
      <form onSubmit={invite} className="space-y-3">
        <div
          className={`grid gap-3 sm:items-end ${
            accessRoles && SHOW_JOB_TITLES
              ? "sm:grid-cols-[1fr_14rem_14rem]"
              : "sm:grid-cols-[1fr_16rem]"
          }`}
        >
          <Field label="Email" required>
            <input
              type="email"
              className={inputClass}
              value={identity}
              onChange={(event) => setIdentity(event.target.value)}
              autoComplete="off"
              required
            />
          </Field>
          {accessRoles ? (
            <AccessRoleSelect
              label="Role"
              fullWidth
              value={accessRoleId}
              roles={grantable}
              onChange={setAccessRoleId}
            />
          ) : null}
          {/* Job title is hidden for now. Set SHOW_JOB_TITLES to true to bring it back. */}
          {SHOW_JOB_TITLES || !accessRoles ? (
            <JobTitleSelect
              label={accessRoles ? "Job title" : "Role"}
              fullWidth
              value={ldapRole}
              roles={roles}
              onChange={setLdapRole}
              grouped={!accessRoles}
            />
          ) : null}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name (optional)">
            <input
              className={inputClass}
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              maxLength={120}
            />
          </Field>
          <Field label="Sign-in password (optional)">
            <input
              type="password"
              className={inputClass}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              minLength={8}
              maxLength={200}
            />
          </Field>
        </div>
        <Button
          type="submit"
          disabled={
            pending ||
            (roles.length === 0 && ldapRole.trim().length > 0) ||
            (!!accessRoles && !accessRoleId)
          }
        >
          {pending ? "Saving…" : "Add person"}
        </Button>
      </form>
      </CollapsibleSection>
      </div>
      {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}
    </>
  );
}
