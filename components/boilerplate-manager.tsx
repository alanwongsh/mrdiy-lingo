"use client";

import { errorMessage } from "@/lib/errors";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  deleteBoilerplate,
  saveBoilerplate,
  type BoilerplateSet,
} from "@/lib/actions/boilerplate";
import { IconButton, PencilIcon, TrashIcon } from "@/components/icon-button";
import { Badge, Button, Field, inputClass, textareaClass } from "@/components/ui";
import type { Language } from "@/lib/types";

type Draft = BoilerplateSet & { originalName: string | null };

function languageLabel(languages: Language[], code: string) {
  const match = languages.find((language) => language.code.toLowerCase() === code.toLowerCase());
  return match ? `${match.name} (${match.code.toUpperCase()})` : code.toUpperCase();
}

/** Every active language, plus any language a passage already has. */
function editorLanguages(languages: Language[], draft: Draft): string[] {
  const codes = languages.map((language) => language.code);
  for (const code of Object.keys(draft.phrases)) {
    if (!codes.some((item) => item.toLowerCase() === code.toLowerCase())) codes.push(code);
  }
  return codes;
}

export function BoilerplateManager({
  applicationId,
  sets,
  languages,
  canEdit,
  loadError,
}: {
  applicationId: string;
  sets: BoilerplateSet[];
  languages: Language[];
  canEdit: boolean;
  loadError?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState("");

  function run(task: () => Promise<void>, after?: () => void) {
    setError("");
    startTransition(async () => {
      try {
        await task();
        after?.();
        router.refresh();
      } catch (err) {
        setError(errorMessage(err, "Could not save the boilerplate."));
      }
    });
  }

  function save(event: React.FormEvent) {
    event.preventDefault();
    if (!draft) return;
    run(
      () =>
        saveBoilerplate({
          applicationId,
          originalName: draft.originalName,
          name: draft.name,
          isActive: draft.isActive,
          phrases: draft.phrases,
        }),
      () => setDraft(null)
    );
  }

  function remove(set: BoilerplateSet) {
    if (!confirm(`Delete “${set.name}” in every language?`)) return;
    run(() => deleteBoilerplate({ applicationId, name: set.name }));
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-sm text-[var(--hub-muted)]">
          Standard passages, such as the company introduction. When the source contains one, the
          translation must keep the approved wording unchanged.
          {canEdit ? null : " Your role cannot change boilerplate."}
        </p>
        {canEdit ? (
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={() => setDraft({ originalName: null, name: "", isActive: true, phrases: {} })}
          >
            Add a passage
          </Button>
        ) : null}
      </div>

      {draft ? (
        <div className="rounded-lg border border-[var(--hub-border)] p-4">
          <form className="space-y-3" onSubmit={save}>
            <h3 className="text-base font-semibold text-slate-900">
              {draft.originalName ? "Edit passage" : "Add a passage"}
            </h3>
            <Field label="Name" required>
              <input
                className={inputClass}
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                placeholder="Company introduction"
                maxLength={80}
                required
              />
            </Field>
            {editorLanguages(languages, draft).map((code) => (
              <Field key={code} label={languageLabel(languages, code)}>
                <textarea
                  className={textareaClass}
                  rows={3}
                  value={draft.phrases[code] ?? ""}
                  onChange={(event) =>
                    setDraft({ ...draft, phrases: { ...draft.phrases, [code]: event.target.value } })
                  }
                  placeholder="Leave blank if this language does not use it"
                  maxLength={4000}
                />
              </Field>
            ))}
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={draft.isActive}
                onChange={(event) => setDraft({ ...draft, isActive: event.target.checked })}
              />
              Include this passage in reviews and auto-translate
            </label>
            <div className="flex gap-2">
              <Button type="submit" disabled={pending}>
                {pending ? "Saving…" : draft.originalName ? "Save passage" : "Add passage"}
              </Button>
              <Button type="button" variant="secondary" disabled={pending} onClick={() => setDraft(null)}>
                Cancel
              </Button>
            </div>
          </form>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-lg border border-[var(--hub-border)]">
        {loadError ? (
          <p className="p-4 text-sm text-red-700">{loadError}</p>
        ) : sets.length === 0 ? (
          <p className="py-12 text-center text-sm text-[var(--hub-muted)]">No passages yet.</p>
        ) : (
          <ul className="divide-y divide-[var(--hub-border)]">
            {sets.map((set) => {
              const codes = Object.keys(set.phrases);
              const preview = set.phrases[codes[0]] ?? "";
              return (
                <li
                  key={set.name}
                  className={`flex flex-wrap items-start justify-between gap-3 px-4 py-3 ${
                    draft?.originalName === set.name ? "bg-[var(--hub-accent-soft)]" : ""
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-[var(--hub-fg)]">{set.name}</span>
                      <Badge tone={set.isActive ? "good" : "neutral"}>
                        {set.isActive ? "In use" : "Not in use"}
                      </Badge>
                      {codes.map((code) => (
                        <Badge key={code} tone="info">
                          {code.toUpperCase()}
                        </Badge>
                      ))}
                    </div>
                    <p className="mt-1 line-clamp-2 text-sm text-[var(--hub-muted)]">{preview}</p>
                  </div>
                  {canEdit ? (
                    <div className="inline-flex items-center gap-1">
                      <IconButton
                        label={`Edit ${set.name}`}
                        disabled={pending}
                        onClick={() => setDraft({ ...set, phrases: { ...set.phrases }, originalName: set.name })}
                      >
                        <PencilIcon />
                      </IconButton>
                      <IconButton label={`Delete ${set.name}`} danger disabled={pending} onClick={() => remove(set)}>
                        <TrashIcon />
                      </IconButton>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
    </div>
  );
}
