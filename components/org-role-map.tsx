"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  addOrgRoleMapping,
  removeOrgRoleMapping,
  setOrgRoleBand,
} from "@/lib/actions/org-roles";
import { ORG_BAND_LABEL, ORG_BANDS, type OrgRoleBand } from "@/lib/auth/roles";
import type { OrgRoleMapping } from "@/lib/types";
import { Button, Card, Field, inputClass } from "@/components/ui";

function RoleGroup({
  band,
  roles,
  pending,
  onMove,
  onRemove,
}: {
  band: OrgRoleBand;
  roles: OrgRoleMapping[];
  pending: boolean;
  onMove: (id: string, band: OrgRoleBand) => void;
  onRemove: (id: string, ldapRole: string) => void;
}) {
  const other: OrgRoleBand = band === "HOD" ? "EDITOR" : "HOD";
  return (
    <Card className="p-5">
      <h2 className="text-base font-semibold">{ORG_BAND_LABEL[band]}</h2>
      <p className="mt-1 text-sm text-[var(--hub-muted)]">
        {band === "HOD"
          ? "Accounts with these roles can approve. Articles they create are approved immediately."
          : "Accounts with these roles can edit and save drafts."}
      </p>
      <ul className="mt-4 divide-y divide-[var(--hub-border)]">
        {roles.length === 0 ? (
          <li className="py-3 text-sm text-[var(--hub-muted)]">No titles in this group.</li>
        ) : (
          roles.map((role) => (
            <li
              key={role.id}
              className="flex flex-wrap items-center justify-between gap-3 py-3"
            >
              <span className="font-medium text-slate-900">{role.ldap_role}</span>
              <span className="flex gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={pending}
                  onClick={() => onMove(role.id, other)}
                >
                  Move to {ORG_BAND_LABEL[other]}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => onRemove(role.id, role.ldap_role)}
                >
                  Remove
                </Button>
              </span>
            </li>
          ))
        )}
      </ul>
    </Card>
  );
}

export function OrgRoleMap({ roles }: { roles: OrgRoleMapping[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [ldapRole, setLdapRole] = useState("");
  const [band, setBand] = useState<OrgRoleBand>("EDITOR");
  const [error, setError] = useState("");

  function run(task: () => Promise<void>) {
    setError("");
    startTransition(async () => {
      try {
        await task();
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not update the map.");
      }
    });
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-2">
        {(["HOD", "EDITOR"] as const).map((item) => (
          <RoleGroup
            key={item}
            band={item}
            roles={roles.filter((role) => role.band === item)}
            pending={pending}
            onMove={(id, next) => run(() => setOrgRoleBand({ id, band: next }))}
            onRemove={(id, name) => {
              if (!confirm(`Remove “${name}” from the map?`)) return;
              run(() => removeOrgRoleMapping({ id }));
            }}
          />
        ))}
      </div>

      <Card className="p-5">
            <h2 className="text-base font-semibold">Add a role</h2>
        <p className="mt-1 text-sm text-[var(--hub-muted)]">
          Use the role stored on the account, such as Executive or Senior
          Executive. Move it between the groups whenever the approval line
          changes. LDAP can fill the same field later.
        </p>
        <form
          className="mt-4 flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            const title = ldapRole;
            run(async () => {
              await addOrgRoleMapping({ ldapRole: title, band });
              setLdapRole("");
            });
          }}
        >
          <Field label="Role">
            <input
              className={inputClass}
              value={ldapRole}
              onChange={(event) => setLdapRole(event.target.value)}
              placeholder="Senior Executive"
              required
            />
          </Field>
          <Field label="Group">
            <select
              className={inputClass}
              value={band}
              onChange={(event) => setBand(event.target.value as OrgRoleBand)}
            >
              {ORG_BANDS.map((item) => (
                <option key={item} value={item}>
                  {ORG_BAND_LABEL[item]}
                </option>
              ))}
            </select>
          </Field>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Add role"}
          </Button>
        </form>
        {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}
      </Card>
    </div>
  );
}
