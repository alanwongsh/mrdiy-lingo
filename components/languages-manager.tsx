"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  createLanguage,
  setLanguageStatus,
  updateLanguage,
} from "@/lib/actions/languages";
import type { EntityStatus, Language } from "@/lib/types";
import {
  Badge,
  Button,
  Card,
  Field,
  inputClass,
  statusTone,
} from "@/components/ui";

export function LanguagesManager({
  initialLanguages,
}: {
  initialLanguages: Language[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<Language | null>(null);

  function refresh() {
    router.refresh();
  }

  function onCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError("");
    startTransition(async () => {
      try {
        await createLanguage({
          code: String(fd.get("code") ?? ""),
          name: String(fd.get("name") ?? ""),
        });
        e.currentTarget.reset();
        refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Create failed");
      }
    });
  }

  function onUpdate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editing) return;
    const fd = new FormData(e.currentTarget);
    setError("");
    startTransition(async () => {
      try {
        await updateLanguage(editing.id, {
          code: String(fd.get("code") ?? ""),
          name: String(fd.get("name") ?? ""),
          status: String(fd.get("status") ?? "ACTIVE") as EntityStatus,
        });
        setEditing(null);
        refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Update failed");
      }
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <Card className="overflow-x-auto">
        <table className="hub-table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Name</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {initialLanguages.map((lang) => (
              <tr
                key={lang.id}
                className="border-b border-[var(--hub-border)] last:border-0"
              >
                <td className="px-4 py-3 font-mono text-xs">{lang.code}</td>
                <td className="px-4 py-3">{lang.name}</td>
                <td className="px-4 py-3">
                  <Badge tone={statusTone(lang.status)}>{lang.status}</Badge>
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    className="mr-3 text-[var(--hub-accent)]"
                    onClick={() => setEditing(lang)}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="text-[var(--hub-muted)]"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        await setLanguageStatus(
                          lang.id,
                          lang.status === "ACTIVE" ? "INACTIVE" : "ACTIVE"
                        );
                        refresh();
                      })
                    }
                  >
                    {lang.status === "ACTIVE" ? "Deactivate" : "Activate"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card className="h-fit p-4">
        <h2 className="mb-3 text-sm font-semibold">
          {editing ? "Edit language" : "Add language"}
        </h2>
        <form
          key={editing?.id ?? "new"}
          onSubmit={editing ? onUpdate : onCreate}
          className="space-y-3"
        >
          <Field label="Code">
            <input
              name="code"
              className={inputClass}
              defaultValue={editing?.code ?? ""}
              placeholder="ms"
              required
            />
          </Field>
          <Field label="Name">
            <input
              name="name"
              className={inputClass}
              defaultValue={editing?.name ?? ""}
              placeholder="Bahasa Malaysia"
              required
            />
          </Field>
          {editing ? (
            <Field label="Status">
              <select
                name="status"
                className={inputClass}
                defaultValue={editing.status}
              >
                <option value="ACTIVE">ACTIVE</option>
                <option value="INACTIVE">INACTIVE</option>
              </select>
            </Field>
          ) : null}
          {error ? <p className="text-sm text-red-700">{error}</p> : null}
          <div className="flex gap-2">
            <Button type="submit" disabled={pending}>
              {editing ? "Save" : "Add"}
            </Button>
            {editing ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => setEditing(null)}
              >
                Cancel
              </Button>
            ) : null}
          </div>
        </form>
      </Card>
    </div>
  );
}
