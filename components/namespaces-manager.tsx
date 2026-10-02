"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  createNamespace,
  updateNamespace,
} from "@/lib/actions/product";
import type { EntityStatus, Namespace } from "@/lib/types";
import {
  Badge,
  Button,
  Card,
  Field,
  inputClass,
  statusTone,
  textareaClass,
} from "@/components/ui";

export function NamespacesManager({
  applicationId,
  initialNamespaces,
}: {
  applicationId: string;
  initialNamespaces: Namespace[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<Namespace | null>(null);
  const [error, setError] = useState("");

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <Card className="overflow-hidden">
        <table className="hub-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Description</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {initialNamespaces.map((ns) => (
              <tr key={ns.id} className="border-b border-[var(--hub-border)]">
                <td className="px-4 py-3 font-medium">{ns.name}</td>
                <td className="px-4 py-3 text-[var(--hub-muted)]">
                  {ns.description || "—"}
                </td>
                <td className="px-4 py-3">
                  <Badge tone={statusTone(ns.status)}>{ns.status}</Badge>
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    className="text-[var(--hub-accent)]"
                    onClick={() => setEditing(ns)}
                  >
                    Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card className="h-fit p-4">
        <h2 className="mb-3 text-sm font-semibold">
          {editing ? "Edit namespace" : "Create namespace"}
        </h2>
        <form
          key={editing?.id ?? "new"}
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            setError("");
            startTransition(async () => {
              try {
                if (editing) {
                  await updateNamespace(editing.id, applicationId, {
                    name: String(fd.get("name") ?? ""),
                    description: String(fd.get("description") ?? ""),
                    status: String(fd.get("status") ?? "ACTIVE") as EntityStatus,
                  });
                  setEditing(null);
                } else {
                  await createNamespace({
                    application_id: applicationId,
                    name: String(fd.get("name") ?? ""),
                    description: String(fd.get("description") ?? ""),
                  });
                  e.currentTarget.reset();
                }
                router.refresh();
              } catch (err) {
                setError(err instanceof Error ? err.message : "Failed");
              }
            });
          }}
        >
          <Field label="Name">
            <input
              name="name"
              className={inputClass}
              defaultValue={editing?.name ?? ""}
              required
            />
          </Field>
          <Field label="Description">
            <textarea
              name="description"
              className={textareaClass}
              rows={2}
              defaultValue={editing?.description ?? ""}
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
              {editing ? "Save" : "Create"}
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
