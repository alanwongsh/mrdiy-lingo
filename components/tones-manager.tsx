"use client";

import { errorMessage } from "@/lib/errors";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createTone, deleteTone, updateTone } from "@/lib/actions/tones";
import { normalizeToneCode } from "@/lib/tones";
import type { EntityStatus, Language, ToneProfile } from "@/lib/types";
import { IconButton, PencilIcon, TrashIcon } from "@/components/icon-button";
import { FilterSelect } from "@/components/filter-select";
import {
  Badge,
  Button,
  Card,
  Field,
  inputClass,
  statusTone,
  textareaClass,
} from "@/components/ui";

/** Every active language, plus any language a tone already has a note for. */
function noteLanguages(languages: Language[], notes: Record<string, string>) {
  const rows = languages.map((language) => ({ code: language.code, name: language.name }));
  for (const code of Object.keys(notes)) {
    if (!rows.some((row) => row.code.toLowerCase() === code.toLowerCase())) {
      rows.push({ code, name: code.toUpperCase() });
    }
  }
  return rows;
}

export function TonesManager({
  applicationId,
  tones,
  languages,
  canEdit,
}: {
  applicationId: string;
  tones: ToneProfile[];
  languages: Language[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [dialog, setDialog] = useState<ToneProfile | "new" | null>(null);
  const [error, setError] = useState("");

  return (
    <div className="space-y-4">
      {canEdit ? (
        <div className="flex justify-end">
          <Button type="button" onClick={() => setDialog("new")}>
            New tone
          </Button>
        </div>
      ) : null}
      <Card className="overflow-x-auto">
        <table className="hub-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Code</th>
              <th>Instructions</th>
              <th>Rewording</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {tones.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-sm text-[var(--hub-muted)]">
                  No tones yet.
                </td>
              </tr>
            ) : (
              tones.map((tone) => (
                <tr key={tone.id} className="border-b border-[var(--hub-border)]">
                  <td className="px-4 py-3 font-medium">{tone.name}</td>
                  <td className="px-4 py-3 text-[var(--hub-muted)]">{tone.code}</td>
                  <td className="max-w-md px-4 py-3 text-[var(--hub-muted)]">
                    <span className="line-clamp-2">{tone.instructions || "—"}</span>
                  </td>
                  <td className="px-4 py-3">
                    {tone.allow_adaptation ? (
                      <Badge tone="info">Adapts</Badge>
                    ) : (
                      <span className="text-[var(--hub-muted)]">Register only</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={statusTone(tone.status)}>{tone.status}</Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {canEdit ? (
                      <div className="inline-flex items-center justify-end gap-1">
                        <IconButton label={`Edit ${tone.name}`} onClick={() => setDialog(tone)}>
                          <PencilIcon />
                        </IconButton>
                        <IconButton
                          label={`Delete ${tone.name}`}
                          danger
                          disabled={pending}
                          onClick={() => {
                            if (!confirm(`Delete “${tone.name}”?`)) return;
                            setError("");
                            startTransition(async () => {
                              try {
                                await deleteTone(tone.id, applicationId);
                                router.refresh();
                              } catch (err) {
                                setError(errorMessage(err, "Failed"));
                              }
                            });
                          }}
                        >
                          <TrashIcon />
                        </IconButton>
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      {dialog ? (
        <ToneDialog
          applicationId={applicationId}
          tone={dialog === "new" ? null : dialog}
          languages={languages}
          onClose={() => setDialog(null)}
          onSaved={() => router.refresh()}
        />
      ) : null}
    </div>
  );
}

function ToneDialog({
  applicationId,
  tone,
  languages,
  onClose,
  onSaved,
}: {
  applicationId: string;
  tone: ToneProfile | null;
  languages: Language[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(tone?.name ?? "");
  const [instructions, setInstructions] = useState(tone?.instructions ?? "");
  const [notes, setNotes] = useState<Record<string, string>>(tone?.language_notes ?? {});
  const [allowAdaptation, setAllowAdaptation] = useState(tone?.allow_adaptation ?? false);
  const [status, setStatus] = useState<EntityStatus>(tone?.status ?? "ACTIVE");
  const [error, setError] = useState("");
  const previewCode = tone ? tone.code : normalizeToneCode(name);

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
        aria-labelledby="tone-dialog-title"
        className="max-h-[90vh] w-full max-w-xl overflow-y-auto"
      >
        <Card className="p-4">
          <h2 id="tone-dialog-title" className="mb-3 text-sm font-semibold">
            {tone ? "Edit tone" : "New tone"}
          </h2>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              setError("");
              const input = {
                name,
                instructions,
                language_notes: notes,
                allow_adaptation: allowAdaptation,
              };
              startTransition(async () => {
                try {
                  if (tone) {
                    await updateTone(tone.id, applicationId, { ...input, status });
                  } else {
                    await createTone({ ...input, application_id: applicationId });
                  }
                  onSaved();
                  onClose();
                } catch (err) {
                  setError(errorMessage(err, "Failed"));
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
              <p className="mt-1 text-xs text-[var(--hub-muted)]">
                {tone
                  ? `Code ${tone.code}. It stays the same so articles keep their tone.`
                  : previewCode
                    ? `Stored as ${previewCode}.`
                    : "For example Formal, Press, or Social media."}
              </p>
            </Field>
            <Field label="Instructions">
              <textarea
                className={textareaClass}
                rows={3}
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                placeholder="Third person, factual, no emoji or exclamation marks."
              />
              <p className="mt-1 text-xs text-[var(--hub-muted)]">
                Sent to machine translation and to the quality check.
              </p>
            </Field>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={allowAdaptation}
                onChange={(e) => setAllowAdaptation(e.target.checked)}
              />
              <span>
                <span className="font-medium">Allow rewording (transcreation)</span>
                <span className="block text-xs text-[var(--hub-muted)]">
                  Translations may be shortened, reordered, and adapted for the audience. Prices,
                  dates, names, and glossary terms still stay the same. Reviewers see these
                  translations marked Adapted.
                </span>
              </span>
            </label>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Notes for each language</legend>
              <p className="text-xs text-[var(--hub-muted)]">
                Optional. How this tone should read in each language, such as “standard Bahasa
                Melayu, no slang”. Word choices that never change go in the glossary.
              </p>
              {noteLanguages(languages, notes).map((language) => (
                <Field key={language.code} label={`${language.name} (${language.code})`}>
                  <input
                    className={inputClass}
                    value={notes[language.code] ?? ""}
                    onChange={(e) =>
                      setNotes((current) => ({ ...current, [language.code]: e.target.value }))
                    }
                  />
                </Field>
              ))}
            </fieldset>
            {tone ? (
              <Field label="Status">
                <FilterSelect
                  fullWidth
                  hideEmptyOption
                  ariaLabel="Status"
                  value={status}
                  onChange={(value) => setStatus(value as EntityStatus)}
                  options={[
                    { value: "ACTIVE", label: "ACTIVE" },
                    { value: "INACTIVE", label: "INACTIVE" },
                  ]}
                  placeholder="Select status"
                />
              </Field>
            ) : null}
            {error ? <p className="text-sm text-red-700">{error}</p> : null}
            <div className="flex gap-2">
              <Button type="submit" disabled={pending}>
                {pending ? "Saving…" : tone ? "Save" : "Create"}
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
