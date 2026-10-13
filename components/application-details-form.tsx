"use client";

import { errorMessage } from "@/lib/errors";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { updateApplication } from "@/lib/actions/applications";
import type { Application, ApplicationModelType, EntityStatus } from "@/lib/types";
import { Button, Card, Field, inputClass, textareaClass } from "@/components/ui";

/** Name, description and status. Model type is shown only where switching it makes sense. */
export function ApplicationDetailsForm({
  application,
  showModelType = false,
  savedHref,
}: {
  application: Pick<Application, "id" | "name" | "description" | "status" | "model_type">;
  showModelType?: boolean;
  /** Where to go after saving. Omit to stay on the page. */
  savedHref?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError("");
    setMessage("");
    startTransition(async () => {
      try {
        await updateApplication(application.id, {
          name: String(fd.get("name") ?? ""),
          description: String(fd.get("description") ?? ""),
          status: String(fd.get("status") ?? "ACTIVE") as EntityStatus,
          model_type: String(
            fd.get("model_type") ?? application.model_type
          ) as ApplicationModelType,
        });
        if (savedHref) router.push(savedHref);
        else setMessage("Saved.");
        router.refresh();
      } catch (err) {
        setError(errorMessage(err, "Update failed"));
      }
    });
  }

  return (
    <Card className="max-w-xl p-5">
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Name">
          <input
            name="name"
            className={inputClass}
            defaultValue={application.name}
            required
          />
        </Field>
        <Field label="Description">
          <textarea
            name="description"
            className={textareaClass}
            rows={3}
            defaultValue={application.description}
          />
        </Field>
        <Field label="Status">
          <select name="status" className={inputClass} defaultValue={application.status}>
            <option value="ACTIVE">ACTIVE</option>
            <option value="INACTIVE">INACTIVE</option>
          </select>
        </Field>
        {showModelType ? (
          <Field label="Model type">
            <select
              name="model_type"
              className={inputClass}
              defaultValue={application.model_type}
            >
              <option value="STRING">UI strings</option>
              <option value="CONTENT">Content</option>
              <option value="CATALOG">Catalog</option>
            </select>
          </Field>
        ) : null}
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        <div className="flex items-center gap-2">
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save changes"}
          </Button>
          {message ? <span className="text-sm text-emerald-700">{message}</span> : null}
        </div>
      </form>
    </Card>
  );
}
