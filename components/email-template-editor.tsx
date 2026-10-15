"use client";

import { errorMessage } from "@/lib/errors";
import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveReviewEmailTemplate } from "@/lib/actions/email-templates";
import {
  DEFAULT_REVIEW_TEMPLATE,
  REVIEW_TEMPLATE_FIELDS,
  REVIEW_VARIABLES,
  SAMPLE_REVIEW_VARIABLES,
  renderReviewEmail,
  resolveReviewTemplate,
  unknownVariables,
  type ReviewTemplate,
  type ReviewTemplateField,
} from "@/lib/notifications/review-template";
import { Button, Card, Field, inputClass, textareaClass } from "@/components/ui";
import { useTimeZone } from "@/components/time-zone";
import { formatDateTime } from "@/lib/datetime";

type Control = HTMLInputElement | HTMLTextAreaElement;

export function EmailTemplateEditor({
  initialTemplate,
  updatedAt,
  mailReady,
  senderOverridden,
}: {
  initialTemplate: ReviewTemplate;
  updatedAt: string | null;
  mailReady: boolean;
  senderOverridden: boolean;
}) {
  const timeZone = useTimeZone();
  const router = useRouter();
  const [saved, setSaved] = useState(initialTemplate);
  const [draft, setDraft] = useState(initialTemplate);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [showText, setShowText] = useState(false);
  const controls = useRef<Partial<Record<ReviewTemplateField, Control | null>>>({});
  const lastFocused = useRef<ReviewTemplateField>("body");

  const dirty = REVIEW_TEMPLATE_FIELDS.some(({ key }) => draft[key] !== saved[key]);
  const isDefault = REVIEW_TEMPLATE_FIELDS.every(
    ({ key }) => draft[key].trim() === DEFAULT_REVIEW_TEMPLATE[key].trim()
  );
  const preview = useMemo(
    () => renderReviewEmail(resolveReviewTemplate(draft), SAMPLE_REVIEW_VARIABLES),
    [draft]
  );

  function change(key: ReviewTemplateField, value: string) {
    setDraft((current) => ({ ...current, [key]: value }));
    setMessage("");
  }

  /** Replaces the selection of a field and keeps the cursor after the new text. */
  function insertAt(key: ReviewTemplateField, insert: string) {
    const control = controls.current[key];
    const value = draft[key];
    const start = control?.selectionStart ?? value.length;
    const end = control?.selectionEnd ?? value.length;
    change(key, value.slice(0, start) + insert + value.slice(end));
    requestAnimationFrame(() => {
      control?.focus();
      control?.setSelectionRange(start + insert.length, start + insert.length);
    });
  }

  function save() {
    setError("");
    setMessage("");
    startTransition(async () => {
      try {
        await saveReviewEmailTemplate(draft);
        // Blank fields fall back to the default on the server; show that here too.
        const stored = resolveReviewTemplate(draft);
        setSaved(stored);
        setDraft(stored);
        setMessage("Saved. New review emails use this template.");
        router.refresh();
      } catch (err) {
        setError(errorMessage(err, "Could not save the template."));
      }
    });
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="space-y-4">
        <Card className="space-y-3 p-4">
          <div>
            <h2 className="text-sm font-semibold text-[var(--hub-fg)]">Variables</h2>
            <p className="text-xs text-[var(--hub-muted)]">
              Click one to insert it where your cursor is. They work in every field and are filled in for each
              article.
            </p>
          </div>
          <ul className="space-y-1.5">
            {REVIEW_VARIABLES.map((variable) => (
              <li key={variable.key} className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => insertAt(lastFocused.current, `{{${variable.key}}}`)}
                  disabled={pending}
                  className="rounded-md border border-[var(--hub-border-strong)] bg-[var(--hub-panel-soft)] px-1.5 py-0.5 font-mono text-xs text-[var(--hub-fg)] hover:border-[var(--hub-accent)] hover:text-[var(--hub-accent)]"
                >
                  {`{{${variable.key}}}`}
                </button>
                <span className="text-xs text-[var(--hub-muted)]">{variable.description}</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="space-y-4 p-4">
          {REVIEW_TEMPLATE_FIELDS.map((field) => {
            const unknown = unknownVariables(draft[field.key]);
            const id = `email-template-${field.key}`;
            const common = {
              id,
              value: draft[field.key],
              disabled: pending,
              maxLength: field.maxLength,
              onFocus: () => {
                lastFocused.current = field.key;
              },
              onChange: (e: React.ChangeEvent<Control>) => change(field.key, e.target.value),
            };
            return (
              <Field key={field.key} label={field.label} htmlFor={id}>
                {field.html ? (
                  <textarea
                    {...common}
                    ref={(el) => {
                      controls.current[field.key] = el;
                    }}
                    rows={26}
                    spellCheck={false}
                    wrap="off"
                    onKeyDown={(e) => {
                      if (e.key !== "Tab" || e.shiftKey) return;
                      e.preventDefault();
                      insertAt(field.key, "  ");
                    }}
                    className={`${textareaClass} font-mono text-xs leading-5`}
                  />
                ) : (
                  <input
                    {...common}
                    ref={(el) => {
                      controls.current[field.key] = el;
                    }}
                    placeholder={DEFAULT_REVIEW_TEMPLATE[field.key]}
                    className={inputClass}
                  />
                )}
                <p className="text-xs text-[var(--hub-muted)]">{field.hint}</p>
                {field.key === "sender_name" && senderOverridden ? (
                  <p className="text-xs text-amber-800">
                    MAIL_FROM is set on the server, so it replaces this name. Remove it to use this field.
                  </p>
                ) : null}
                {unknown.length > 0 ? (
                  <p className="text-xs text-red-700">
                    Unknown variable: {unknown.map((name) => `{{${name}}}`).join(", ")}
                  </p>
                ) : null}
              </Field>
            );
          })}

          {!mailReady ? (
            <p className="text-xs text-amber-800">
              Email is not set up on this server yet, so review emails wait in the queue until it is.
            </p>
          ) : null}
          {error ? <p className="text-sm text-red-700">{error}</p> : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" onClick={save} disabled={!dirty || pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
            {dirty ? (
              <Button type="button" variant="ghost" onClick={() => setDraft(saved)} disabled={pending}>
                Cancel
              </Button>
            ) : null}
            {!isDefault ? (
              <Button
                type="button"
                variant="secondary"
                className="ml-auto"
                onClick={() => {
                  setDraft(DEFAULT_REVIEW_TEMPLATE);
                  setMessage("");
                }}
                disabled={pending}
              >
                Restore defaults
              </Button>
            ) : null}
            {message && !dirty ? <span className="text-sm text-emerald-700">{message}</span> : null}
          </div>
          {updatedAt ? (
            <p className="text-xs text-[var(--hub-muted)]">
              Last saved {formatDateTime(updatedAt, timeZone)}
            </p>
          ) : null}
        </Card>
      </div>

      <div className="space-y-2 xl:sticky xl:top-6 xl:self-start">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-[var(--hub-fg)]">Preview</h2>
          <div className="flex items-center gap-3 text-xs">
            <span className="text-[var(--hub-muted)]">Sample article</span>
            <button
              type="button"
              className="hub-text-button"
              onClick={() => setShowText((value) => !value)}
            >
              {showText ? "Show HTML" : "Show plain text"}
            </button>
          </div>
        </div>
        <Card className="overflow-hidden">
          <div className="space-y-0.5 border-b border-[var(--hub-border)] px-4 py-3 text-sm">
            <p className="truncate">
              <span className="text-[var(--hub-muted)]">From: </span>
              <span className="font-semibold text-[var(--hub-fg)]">
                {senderOverridden ? "Set by MAIL_FROM on the server" : preview.fromName}
              </span>
            </p>
            <p className="truncate">
              <span className="text-[var(--hub-muted)]">Subject: </span>
              <span className="font-semibold text-[var(--hub-fg)]">{preview.subject}</span>
            </p>
          </div>
          {showText ? (
            <pre className="h-[640px] overflow-auto bg-[var(--hub-panel-soft)] p-4 font-mono text-xs leading-5 whitespace-pre-wrap text-[var(--hub-fg)]">
              {preview.text}
            </pre>
          ) : (
            <iframe
              title="Email preview"
              srcDoc={preview.html}
              sandbox=""
              className="block h-[640px] w-full bg-white"
            />
          )}
        </Card>
      </div>
    </div>
  );
}
