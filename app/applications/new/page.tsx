"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createApplication } from "@/lib/actions/applications";
import type { ApplicationModelType } from "@/lib/types";
import {
  Button,
  Card,
  Field,
  PageHeader,
  inputClass,
  textareaClass,
} from "@/components/ui";

export default function NewApplicationPage() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [modelType, setModelType] = useState<ApplicationModelType>("STRING");

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    startTransition(async () => {
      try {
        const app = await createApplication({
          name,
          description,
          model_type: modelType,
        });
        router.push(
          modelType === "CONTENT"
            ? `/applications/${app.id}/articles`
            : `/applications/${app.id}`
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to create");
      }
    });
  }

  return (
    <div>
      <PageHeader
        title="New Application"
        description="Choose string translations (Product) or content translations (Press)."
        back={{ href: "/applications", label: "Back to applications" }}
      />
      <Card className="max-w-xl p-5">
        <form onSubmit={onSubmit} className="space-y-4">
          <Field label="Name">
            <input
              className={inputClass}
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </Field>
          <Field label="Description">
            <textarea
              className={textareaClass}
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
          <Field label="Model type">
            <select
              className={inputClass}
              value={modelType}
              onChange={(e) =>
                setModelType(e.target.value as ApplicationModelType)
              }
            >
              <option value="STRING">STRING — key/value localization</option>
              <option value="CONTENT">CONTENT — articles / long-form</option>
            </select>
          </Field>
          {error ? <p className="text-sm text-red-700">{error}</p> : null}
          <Button type="submit" disabled={pending}>
            {pending ? "Creating…" : "Create application"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
