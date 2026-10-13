"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { addOrgRoleMapping, removeOrgRoleMapping } from "@/lib/actions/org-roles";
import type { OrgRoleMapping } from "@/lib/types";
import { Button, Card, Field, inputClass } from "@/components/ui";

export function JobTitleList({ titles }: { titles: OrgRoleMapping[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");

  function run(task: () => Promise<void>) {
    setError("");
    startTransition(async () => {
      try {
        await task();
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not update job titles.");
      }
    });
  }

  return (
    <Card className="p-5">
      <h2 className="text-base font-semibold">Job titles</h2>
      <p className="mt-1 text-sm text-[var(--hub-muted)]">
        Titles you can put on an account, such as Executive. They are shown next to
        the person and do not change what they can do. Joget adds new titles when people sign in.
      </p>
      <ul className="mt-4 divide-y divide-[var(--hub-border)]">
        {titles.length === 0 ? (
          <li className="py-3 text-sm text-[var(--hub-muted)]">No job titles yet.</li>
        ) : (
          titles.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-3 py-2">
              <span className="text-sm font-medium text-slate-900">{item.ldap_role}</span>
              <Button
                type="button"
                variant="ghost"
                disabled={pending}
                onClick={() => {
                  if (!confirm(`Remove the “${item.ldap_role}” job title?`)) return;
                  run(() => removeOrgRoleMapping({ id: item.id }));
                }}
              >
                Remove
              </Button>
            </li>
          ))
        )}
      </ul>
      <form
        className="mt-4 flex flex-wrap items-end gap-3 border-t border-[var(--hub-border)] pt-4"
        onSubmit={(event) => {
          event.preventDefault();
          const value = title;
          run(async () => {
            await addOrgRoleMapping({ ldapRole: value });
            setTitle("");
          });
        }}
      >
        <Field label="Job title">
          <input
            className={inputClass}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Senior Executive"
            maxLength={80}
            required
          />
        </Field>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Add job title"}
        </Button>
      </form>
      {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}
    </Card>
  );
}
