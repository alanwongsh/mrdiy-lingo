"use client";

import { useState, useTransition } from "react";
import {
  createContentType,
  updateContentType,
} from "@/lib/actions/content-types";
import { normalizeContentTypeCode } from "@/lib/content-types";
import type { ContentTypeRecord, EntityStatus } from "@/lib/types";
import { Button, Card, Field, inputClass, textareaClass } from "@/components/ui";

export function ContentTypeDialog({
  applicationId,
  contentType,
  onClose,
  onSaved,
}: {
  applicationId: string;
  contentType: ContentTypeRecord | null;
  onClose: () => void;
  onSaved?: (saved: ContentTypeRecord) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(contentType?.name ?? "");
  const [code, setCode] = useState(contentType?.code ?? "");
  const [codeTouched, setCodeTouched] = useState(Boolean(contentType));
  const [description, setDescription] = useState(contentType?.description ?? "");
  const [status, setStatus] = useState<EntityStatus>(
    contentType?.status ?? "ACTIVE"
  );
  const [error, setError] = useState("");
  const previewCode = contentType
    ? contentType.code
    : codeTouched
      ? normalizeContentTypeCode(code)
      : normalizeContentTypeCode(name);

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-slate-900/40 p-4 sm:items-center"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="content-type-dialog-title"
        className="w-full max-w-md"
      >
      <Card className="p-4">
        <h2 id="content-type-dialog-title" className="mb-3 text-sm font-semibold">
          {contentType ? "Edit type" : "New type"}
        </h2>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            setError("");
            startTransition(async () => {
              try {
                const saved = contentType
                  ? await updateContentType(contentType.id, applicationId, {
                      name,
                      description,
                      status,
                    })
                  : await createContentType({
                      application_id: applicationId,
                      name,
                      code: previewCode || undefined,
                      description,
                    });
                onSaved?.(saved);
                onClose();
              } catch (err) {
                setError(err instanceof Error ? err.message : "Failed");
              }
            });
          }}
        >
          <Field label="Name">
            <input
              className={inputClass}
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoFocus
            />
          </Field>
          <Field label="Code">
            {contentType ? (
              <p className="text-sm font-medium text-slate-800">
                {contentType.code}
              </p>
            ) : (
              <input
                className={inputClass}
                value={codeTouched ? code : previewCode}
                placeholder="Filled in from the name"
                onChange={(e) => {
                  setCodeTouched(true);
                  setCode(e.target.value);
                }}
              />
            )}
            <p className="mt-1 text-xs text-[var(--hub-muted)]">
              {contentType
                ? "The code stays the same so existing articles and imports keep working."
                : previewCode
                  ? `Articles and imports store this as ${previewCode}.`
                  : "Use letters, for example Promotion or Press release."}
            </p>
          </Field>
          <Field label="Description">
            <textarea
              className={textareaClass}
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
          {contentType ? (
            <Field label="Status">
              <select
                className={inputClass}
                value={status}
                onChange={(e) => setStatus(e.target.value as EntityStatus)}
              >
                <option value="ACTIVE">ACTIVE</option>
                <option value="INACTIVE">INACTIVE</option>
              </select>
            </Field>
          ) : null}
          {error ? <p className="text-sm text-red-700">{error}</p> : null}
          <div className="flex gap-2">
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : contentType ? "Save" : "Create"}
            </Button>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </form>
      </Card>
      </div>
    </div>
  );
}
