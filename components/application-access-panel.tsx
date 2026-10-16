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
import { coversUnit, unitMarketsLabel, type BusinessUnit } from "@/lib/business-unit-rules";
import type { AccessRole, ApplicationMemberView, OrgRoleMapping } from "@/lib/types";
import { FilterSelect, type FilterOption } from "@/components/filter-select";
import { CollapsibleSection } from "@/components/collapsible-section";
import { Badge, Button, Card, Field, inputClass } from "@/components/ui";
import { IconButton, KeyIcon, TrashIcon } from "@/components/icon-button";

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

function BusinessUnitSelect({
  value,
  units,
  onChange,
  label,
  ariaLabel,
  fullWidth = false,
  disabled = false,
}: {
  value: string;
  units: BusinessUnit[];
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
      placeholder="Choose a business unit"
      options={units.map((unit) => ({
        value: unit.id,
        label: `${unit.name} (${unitMarketsLabel(unit)})`,
      }))}
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

function PersonCell({ person, owner = false }: { person: ApplicationMemberView; owner?: boolean }) {
  return (
    <td>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-slate-900">{person.displayName}</span>
        {owner ? <Badge tone="info">Owner</Badge> : null}
        {person.signedIn ? null : <Badge tone="warn">Not signed in yet</Badge>}
      </div>
      {person.detail ? (
        <div className="text-xs text-[var(--hub-muted)]">{person.detail}</div>
      ) : null}
    </td>
  );
}

function MemberRow({
  applicationId,
  member,
  orgRoles,
  accessRoles,
  grantable,
  businessUnits,
  grantableUnits,
  showJobTitle,
  columns,
}: {
  applicationId: string;
  member: ApplicationMemberView;
  orgRoles: OrgRoleMapping[];
  accessRoles: AccessRole[] | null;
  /** Roles the signed-in person may give. */
  grantable: AccessRole[];
  /** Null where business units do not apply. */
  businessUnits: BusinessUnit[] | null;
  /** Units the signed-in person may give. */
  grantableUnits: BusinessUnit[];
  showJobTitle: boolean;
  /** Table width, for the password row. */
  columns: number;
}) {
  const current = accessRoles?.find((role) => role.id === member.accessRoleId);
  const memberUnitIds = member.businessUnitIds ?? [];
  const memberUnits = (businessUnits ?? []).filter((unit) => memberUnitIds.includes(unit.id));
  // Someone whose role or business unit reaches beyond yours is shown but not changed.
  const locked =
    (!!current && !grantable.some((role) => role.id === current.id)) ||
    memberUnits.some((unit) => !grantableUnits.some((item) => item.id === unit.id));
  const choices = locked && current ? [current] : grantable;
  const unitChoices = locked ? memberUnits : grantableUnits;
  // The UI gives one unit; someone put in several elsewhere keeps them until changed here.
  const firstUnitId = memberUnitIds[0] ?? "";
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [ldapRole, setLdapRole] = useState(member.ldapRole ?? "");
  const [accessRoleId, setAccessRoleId] = useState(member.accessRoleId ?? "");
  const [unitId, setUnitId] = useState(firstUnitId);
  const [editingPassword, setEditingPassword] = useState(false);
  const [password, setPassword] = useState("");
  const unitChanged = !!businessUnits && unitId !== firstUnitId;
  const changed =
    ldapRole !== (member.ldapRole ?? "") ||
    accessRoleId !== (member.accessRoleId ?? "") ||
    unitChanged;
  const incomplete = (!!accessRoles && !accessRoleId) || (!!businessUnits && !unitId);

  function reset() {
    setLdapRole(member.ldapRole ?? "");
    setAccessRoleId(member.accessRoleId ?? "");
    setUnitId(firstUnitId);
    setError("");
  }

  function save() {
    setError("");
    setNotice("");
    startTransition(async () => {
      try {
        await updateApplicationMember({
          applicationId,
          membershipId: member.membershipId,
          ldapRole,
          accessRoleId,
          businessUnitIds: unitChanged ? [unitId] : undefined,
        });
        router.refresh();
      } catch (err) {
        setError(errorMessage(err, "Could not save access."));
      }
    });
  }

  function remove() {
    if (!confirm(`Remove ${member.displayName} from this application?`)) return;
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

  const message = error || notice;

  return (
    <>
      <tr>
        <PersonCell person={member} />
        {accessRoles ? (
          <td>
            <AccessRoleSelect
              ariaLabel={`Role for ${member.displayName}`}
              fullWidth
              value={accessRoleId}
              roles={choices}
              onChange={setAccessRoleId}
              disabled={locked || pending}
            />
          </td>
        ) : null}
        {businessUnits ? (
          <td>
            <BusinessUnitSelect
              ariaLabel={`Business unit for ${member.displayName}`}
              fullWidth
              value={unitId}
              units={unitChoices}
              onChange={setUnitId}
              disabled={locked || pending}
            />
            {memberUnitIds.length > 1 ? (
              <div className="mt-1 text-xs text-[var(--hub-muted)]">
                Also in {memberUnitIds.length - 1} more
              </div>
            ) : null}
          </td>
        ) : null}
        {showJobTitle ? (
          <td>
            <JobTitleSelect
              ariaLabel={accessRoles ? `Job title for ${member.displayName}` : `Role for ${member.displayName}`}
              fullWidth
              value={ldapRole}
              roles={orgRoles}
              onChange={setLdapRole}
              grouped={!accessRoles}
            />
          </td>
        ) : null}
        <td className="w-px whitespace-nowrap">
          {changed ? (
            <div className="flex justify-end gap-1">
              <Button type="button" disabled={pending || incomplete} onClick={save}>
                {pending ? "Saving…" : "Save"}
              </Button>
              <Button type="button" variant="ghost" disabled={pending} onClick={reset}>
                Cancel
              </Button>
            </div>
          ) : (
            <div className="flex justify-end gap-0.5">
              <IconButton
                label={`Set a sign-in password for ${member.displayName}`}
                disabled={pending}
                onClick={() => {
                  setNotice("");
                  setEditingPassword((open) => !open);
                }}
              >
                <KeyIcon />
              </IconButton>
              <IconButton
                label={
                  locked
                    ? "Their access reaches beyond yours, so you cannot remove them."
                    : `Remove ${member.displayName}`
                }
                danger
                disabled={pending || locked}
                onClick={remove}
              >
                <TrashIcon />
              </IconButton>
            </div>
          )}
        </td>
      </tr>
      {editingPassword || message ? (
        <tr>
          <td colSpan={columns} className="!pt-0">
            {editingPassword ? (
              <form onSubmit={savePassword} className="flex flex-wrap items-end gap-2 mt-2">
                <Field label={`New sign-in password for ${member.displayName}`}>
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
                <Button
                  type="button"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => {
                    setPassword("");
                    setEditingPassword(false);
                    setError("");
                  }}
                >
                  Cancel
                </Button>
              </form>
            ) : null}
            {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
            {notice ? <p className="text-sm text-emerald-700">{notice}</p> : null}
          </td>
        </tr>
      ) : null}
    </>
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
  businessUnits = null,
  actorMarkets = null,
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
  /** Units of an article app. Null where they do not apply, or before migration 032. */
  businessUnits?: BusinessUnit[] | null;
  /** Countries of the signed-in person. Null means every country. */
  actorMarkets?: string[] | null;
}) {
  const grantable = (accessRoles ?? []).filter((role) =>
    canGrantRole({ permissions: actorPermissions }, role)
  );
  const grantableUnits = (businessUnits ?? []).filter((unit) =>
    coversUnit({ markets: actorMarkets }, unit)
  );
  const defaultUnitId = grantableUnits.length === 1 ? grantableUnits[0].id : "";
  const showJobTitle = SHOW_JOB_TITLES || !accessRoles;
  const columns = 2 + (accessRoles ? 1 : 0) + (businessUnits ? 1 : 0) + (showJobTitle ? 1 : 0);
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [identity, setIdentity] = useState("");
  const [ownerIdentity, setOwnerIdentity] = useState("");
  const [ldapRole, setLdapRole] = useState("");
  const [accessRoleId, setAccessRoleId] = useState(() => defaultRoleId(grantable));
  const [unitId, setUnitId] = useState(defaultUnitId);
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
          businessUnitIds: businessUnits ? [unitId] : undefined,
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
        setUnitId(defaultUnitId);
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
      <Card className="overflow-hidden">
        <div className="px-5 pt-5 pb-3">
          <h2 className="text-base font-semibold">People</h2>
          {orgRoles === null ? (
            <p className="mt-1 text-sm text-amber-800">
              Run migration 012 from Setup before assigning roles.
            </p>
          ) : accessRoles === null ? (
            <p className="mt-1 text-sm text-amber-800">
              Run migrations 025 and 026 from Setup to give people roles such as Translator or
              Reviewer.
            </p>
          ) : (
            <p className="mt-1 text-sm text-[var(--hub-muted)]">
              {businessUnits
                ? "The role sets what someone can do. The business unit sets which countries they work on."
                : "The role sets what someone can do in this application."}
            </p>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="hub-table">
            <thead>
              <tr>
                <th>Person</th>
                {accessRoles ? <th className="w-56">Role</th> : null}
                {businessUnits ? <th className="w-64">Business unit</th> : null}
                {showJobTitle ? <th className="w-56">{accessRoles ? "Job title" : "Role"}</th> : null}
                <th className="w-px">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {owner ? (
                <tr>
                  <PersonCell person={owner} owner />
                  {accessRoles ? (
                    <td className="text-[var(--hub-muted)]">Full access</td>
                  ) : null}
                  {businessUnits ? (
                    <td className="text-[var(--hub-muted)]">All countries</td>
                  ) : null}
                  {showJobTitle ? <td /> : null}
                  <td />
                </tr>
              ) : null}
              {members.map((member) => (
                <MemberRow
                  key={member.membershipId}
                  applicationId={applicationId}
                  member={member}
                  orgRoles={roles}
                  accessRoles={accessRoles}
                  grantable={grantable}
                  businessUnits={businessUnits}
                  grantableUnits={grantableUnits}
                  showJobTitle={showJobTitle}
                  columns={columns}
                />
              ))}
              {!owner && members.length === 0 ? (
                <tr>
                  <td colSpan={columns} className="text-[var(--hub-muted)]">
                    No one is added yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="mt-3 space-y-3">
        <CollapsibleSection id="add-person" title="Add person">
          <form onSubmit={invite} className="max-w-3xl space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
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
              <Field label="Name (optional)">
                <input
                  className={inputClass}
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  maxLength={120}
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
              {businessUnits ? (
                <BusinessUnitSelect
                  label="Business unit"
                  fullWidth
                  value={unitId}
                  units={grantableUnits}
                  onChange={setUnitId}
                />
              ) : null}
              {/* Job title is hidden for now. Set SHOW_JOB_TITLES to true to bring it back. */}
              {showJobTitle ? (
                <JobTitleSelect
                  label={accessRoles ? "Job title" : "Role"}
                  fullWidth
                  value={ldapRole}
                  roles={roles}
                  onChange={setLdapRole}
                  grouped={!accessRoles}
                />
              ) : null}
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
                (!!accessRoles && !accessRoleId) ||
                (!!businessUnits && !unitId)
              }
            >
              {pending ? "Saving…" : "Add person"}
            </Button>
          </form>
        </CollapsibleSection>

        {isSuperadmin ? (
          <CollapsibleSection id="change-owner" title="Change owner">
            <form onSubmit={assignOwner} className="flex flex-wrap items-end gap-2">
              <Field label="New owner's email">
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
          </CollapsibleSection>
        ) : null}
      </div>
      {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}
    </>
  );
}
