"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import {
  getApplication,
  updateApplication,
} from "@/lib/actions/applications";
import type {
  Application,
  ApplicationModelType,
  EntityStatus,
} from "@/lib/types";
import {
  Button,
  Card,
  Field,
  PageHeader,
  inputClass,
  textareaClass,
} from "@/components/ui";

export default function EditApplicationPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [app, setApp] = useState<Application | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  useEffect(() => {
    getApplication(id).then(setApp).catch((e) => setError(e.message));
  }, [id]);

  if (!app && !error) {
    return <div className="text-sm text-[var(--hub-muted)]">Loading…</div>;
  }

  if (!app) {
    return <div className="text-sm text-red-700">{error}</div>;
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError("");
    startTransition(async () => {
      try {
        await updateApplication(id, {
          name: String(fd.get("name") ?? ""),
          description: String(fd.get("description") ?? ""),
          status: String(fd.get("status") ?? "ACTIVE") as EntityStatus,
          model_type: String(fd.get("model_type") ?? "STRING") as ApplicationModelType,
        });
        router.push(`/applications/${id}`);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Update failed");
      }
    });
  }

  return (
    <div>
      <PageHeader
        title={`Edit ${app.name}`}
        back={{ href: `/applications/${id}`, label: "Back to overview" }}
      />
      <Card className="max-w-xl p-5">
        <form onSubmit={onSubmit} className="space-y-4">
          <Field label="Name">
            <input
              name="name"
              className={inputClass}
              defaultValue={app.name}
              required
            />
          </Field>
          <Field label="Description">
            <textarea
              name="description"
              className={textareaClass}
              rows={3}
              defaultValue={app.description}
            />
          </Field>
          <Field label="Status">
            <select
              name="status"
              className={inputClass}
              defaultValue={app.status}
            >
              <option value="ACTIVE">ACTIVE</option>
              <option value="INACTIVE">INACTIVE</option>
            </select>
          </Field>
          <Field label="Model type">
            <select
              name="model_type"
              className={inputClass}
              defaultValue={app.model_type}
            >
              <option value="STRING">STRING</option>
              <option value="CONTENT">CONTENT</option>
            </select>
          </Field>
          {error ? <p className="text-sm text-red-700">{error}</p> : null}
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save changes"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
