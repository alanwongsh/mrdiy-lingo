"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createApplication } from "@/lib/actions/applications";
import { appHomePath, CATALOG_TEMPLATES } from "@/lib/catalog";
import type { ApplicationModelType } from "@/lib/types";
import {
  Button,
  Card,
  Field,
  PageHeader,
  inputClass,
  textareaClass,
} from "@/components/ui";

const MODELS: { value: ApplicationModelType; label: string; hint: string }[] = [
  {
    value: "CATALOG",
    label: "Catalog",
    hint: "Records with their own fields, such as SKUs with an HS code, package text, and manual. Any team can define its fields.",
  },
  {
    value: "CONTENT",
    label: "Content",
    hint: "Articles and press releases with a body, summary, and SEO fields, published to vendors.",
  },
  {
    value: "STRING",
    label: "UI strings",
    hint: "Short interface text grouped by namespace and key, such as button.save.",
  },
];

export function NewApplicationForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [modelType, setModelType] = useState<ApplicationModelType>("CATALOG");
  const [template, setTemplate] = useState(CATALOG_TEMPLATES[0].code);
  const [itemLabel, setItemLabel] = useState(CATALOG_TEMPLATES[0].itemLabel);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    startTransition(async () => {
      try {
        const app = await createApplication({
          name,
          description,
          model_type: modelType,
          ...(modelType === "CATALOG" ? { template, item_label: itemLabel } : {}),
        });
        router.push(appHomePath(app));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to create");
      }
    });
  }

  return (
    <div>
      <PageHeader
        title="New Application"
        back={{ href: "/applications", label: "Back to applications" }}
      />
      <Card className="max-w-xl p-5">
        <form onSubmit={onSubmit} className="space-y-4">
          <Field label="Name" htmlFor="app-name">
            <input
              id="app-name"
              className={inputClass}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="For example, Customs products"
              required
            />
          </Field>
          <Field label="Description" htmlFor="app-description">
            <textarea
              id="app-description"
              className={textareaClass}
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
          <fieldset className="space-y-2">
            <legend className="text-xs font-semibold tracking-wide text-[var(--hub-muted-strong)]">
              Model
            </legend>
            {MODELS.map((model) => (
              <label
                key={model.value}
                className={`flex cursor-pointer gap-3 rounded-lg border p-3 ${
                  modelType === model.value
                    ? "border-[var(--hub-accent)] bg-[var(--hub-accent-soft)]"
                    : "border-[var(--hub-border)] hover:border-[var(--hub-border-strong)]"
                }`}
              >
                <input
                  type="radio"
                  name="model"
                  className="mt-1"
                  checked={modelType === model.value}
                  onChange={() => setModelType(model.value)}
                />
                <span>
                  <span className="block text-sm font-semibold text-slate-900">{model.label}</span>
                  <span className="block text-xs text-[var(--hub-muted-strong)]">{model.hint}</span>
                </span>
              </label>
            ))}
          </fieldset>
          {modelType === "CATALOG" ? (
            <div className="space-y-4 rounded-lg border border-[var(--hub-border)] bg-slate-50 p-3">
              <fieldset className="space-y-2">
                <legend className="text-xs font-semibold tracking-wide text-[var(--hub-muted-strong)]">
                  Template
                </legend>
                {CATALOG_TEMPLATES.map((t) => (
                  <label
                    key={t.code}
                    className={`flex cursor-pointer gap-3 rounded-lg border bg-white p-3 ${
                      template === t.code
                        ? "border-[var(--hub-accent)]"
                        : "border-[var(--hub-border)] hover:border-[var(--hub-border-strong)]"
                    }`}
                  >
                    <input
                      type="radio"
                      name="template"
                      className="mt-1"
                      checked={template === t.code}
                      onChange={() => {
                        setTemplate(t.code);
                        setItemLabel(t.itemLabel);
                      }}
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-slate-900">{t.name}</span>
                      <span className="mt-1 flex flex-wrap gap-1">
                        {t.fields.map((f) => (
                          <span
                            key={f.code}
                            className="rounded border border-[var(--hub-border)] bg-slate-50 px-1.5 py-0.5 text-[11px] text-[var(--hub-muted-strong)]"
                          >
                            {f.label}
                          </span>
                        ))}
                      </span>
                    </span>
                  </label>
                ))}
                <p className="text-xs text-[var(--hub-muted)]">
                  Fields can be added, renamed, or switched off later on the Fields tab.
                </p>
              </fieldset>
              <Field label="Record name" htmlFor="app-item-label">
                <input
                  id="app-item-label"
                  className={`${inputClass} max-w-xs`}
                  value={itemLabel}
                  maxLength={40}
                  onChange={(e) => setItemLabel(e.target.value)}
                  placeholder="SKU"
                  required
                />
                <p className="text-xs text-[var(--hub-muted)]">
                  Used across the app, for example “New {itemLabel.trim() || "SKU"}” and “
                  {itemLabel.trim() || "SKU"} list”.
                </p>
              </Field>
            </div>
          ) : null}
          {error ? <p className="text-sm text-red-700">{error}</p> : null}
          <Button type="submit" disabled={pending}>
            {pending ? "Creating…" : "Create application"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
