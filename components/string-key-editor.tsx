"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  autoTranslateKeyLanguages,
  deleteTranslationVersion,
  listTranslationVersions,
  saveManualStringTranslation,
  setStringTranslationStatus,
  type TranslationKeyListItem,
} from "@/lib/actions/product";
import type { Language, TranslationStatus, TranslationVersion } from "@/lib/types";
import {
  Badge,
  Button,
  Card,
  statusTone,
  textareaClass,
} from "@/components/ui";
import {
  BatchTranslateButton,
  LanguageMultiSelect,
} from "@/components/language-multi-select";
import { StringVersionPanel } from "@/components/version-panel";

export function StringKeyEditor({
  applicationId,
  translationKey,
  languages,
}: {
  applicationId: string;
  translationKey: TranslationKeyListItem;
  languages: Language[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [isTranslating, setIsTranslating] = useState(false);
  const [translatingLabel, setTranslatingLabel] = useState("");
  const [historyLoading, setHistoryLoading] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const targets = useMemo(
    () => languages.filter((l) => l.code !== translationKey.source_language),
    [languages, translationKey.source_language]
  );
  const [targetLang, setTargetLang] = useState(
    targets[0]?.code ?? languages[0]?.code ?? "ms"
  );
  const [selected, setSelected] = useState<string[]>(() =>
    targets.slice(0, 1).map((l) => l.code)
  );
  const [draft, setDraft] = useState("");
  const [versions, setVersions] = useState<TranslationVersion[]>([]);
  const [error, setError] = useState("");
  const [historyError, setHistoryError] = useState("");

  const sourceLang = languages.find(
    (l) => l.code === translationKey.source_language
  );
  const targetMeta = languages.find((l) => l.code === targetLang);
  const targetTranslation = translationKey.translations?.find(
    (t) => t.language_code === targetLang
  );
  const status: TranslationStatus = targetTranslation?.status ?? "MISSING";
  const savedText = targetTranslation?.current_text ?? "";
  const isDirty = draft !== savedText;

  const statuses = useMemo(
    () =>
      targets.map((l) => ({
        code: l.code,
        status:
          translationKey.translations?.find((t) => t.language_code === l.code)
            ?.status ?? ("MISSING" as TranslationStatus),
      })),
    [targets, translationKey.translations]
  );

  useEffect(() => {
    setDraft(targetTranslation?.current_text ?? "");
    setShowHistory(false);
    setVersions([]);
    setHistoryError("");
  }, [targetLang, targetTranslation?.current_text, targetTranslation?.id]);

  function loadHistory() {
    setShowHistory(true);
    setHistoryError("");
    setHistoryLoading(true);
    setVersions([]);

    startTransition(async () => {
      try {
        if (!targetTranslation?.id) {
          setVersions([]);
          return;
        }
        setVersions(await listTranslationVersions(targetTranslation.id));
      } catch (err) {
        setHistoryError(
          err instanceof Error ? err.message : "Failed to load history"
        );
      } finally {
        setHistoryLoading(false);
      }
    });
  }

  function runBatchTranslate() {
    if (selected.length === 0) return;
    setError("");
    setIsTranslating(true);
    setTranslatingLabel(
      selected
        .map((c) => languages.find((l) => l.code === c)?.name ?? c)
        .join(", ")
    );
    startTransition(async () => {
      try {
        await autoTranslateKeyLanguages({
          translationKeyId: translationKey.id,
          targetLanguages: selected,
          applicationId,
        });
        if (!selected.includes(targetLang) && selected[0]) {
          setTargetLang(selected[0]);
        }
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Translate failed");
      } finally {
        setIsTranslating(false);
        setTranslatingLabel("");
      }
    });
  }

  return (
    <div className="space-y-4">
      <Card className="space-y-3 p-4">
        <LanguageMultiSelect
          sourceLabel={sourceLang?.name ?? translationKey.source_language}
          options={targets}
          statuses={statuses}
          selected={selected}
          activeCode={targetLang}
          onSelectedChange={setSelected}
          onActiveChange={setTargetLang}
          translateAction={
            <BatchTranslateButton
              count={selected.length}
              disabled={pending}
              loading={isTranslating}
              onClick={runBatchTranslate}
            />
          }
        />
        {isTranslating ? (
          <div className="flex items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">
            <span
              className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-sky-300 border-t-sky-700"
              aria-hidden
            />
            Translating selected languages: {translatingLabel}…
          </div>
        ) : null}
      </Card>

      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="overflow-hidden">
          <div className="border-b border-[var(--hub-border)] bg-slate-50 px-4 py-3">
            <div className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
              Source
            </div>
            <div className="mt-0.5 font-semibold text-slate-900">
              {sourceLang?.name ?? translationKey.source_language}
            </div>
          </div>
          <div className="p-4">
            <div className="mb-2 font-mono text-xs text-slate-500">
              {translationKey.key}
            </div>
            <div className="min-h-[8rem] whitespace-pre-wrap rounded-lg border border-dashed border-slate-200 bg-slate-50 p-3 text-sm leading-relaxed text-slate-900">
              {translationKey.source_text || "—"}
            </div>
          </div>
        </Card>

        <Card className="overflow-hidden border-[var(--diy-red)]/20">
          <div className="border-b border-[var(--hub-border)] bg-[var(--diy-red-soft)] px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <div>
                <div className="text-xs font-semibold tracking-wide text-[var(--diy-red)] uppercase">
                  Editing
                </div>
                <div className="mt-0.5 font-semibold text-slate-900">
                  {targetMeta?.name ?? targetLang}
                </div>
              </div>
              <Badge tone={statusTone(status)}>{status}</Badge>
            </div>
          </div>
          <div className="space-y-3 p-4">
            <textarea
              className={`${textareaClass} min-h-[8rem]`}
              value={draft}
              disabled={isTranslating}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={`Enter ${targetMeta?.name ?? targetLang} translation…`}
            />
            <div className="flex flex-wrap items-center gap-2">
              {isDirty ? (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={pending || isTranslating || !draft.trim()}
                  onClick={() =>
                    startTransition(async () => {
                      setError("");
                      try {
                        await saveManualStringTranslation({
                          translationKeyId: translationKey.id,
                          languageCode: targetLang,
                          text: draft,
                          applicationId,
                        });
                        router.refresh();
                        if (showHistory) loadHistory();
                      } catch (err) {
                        setError(
                          err instanceof Error ? err.message : "Save failed"
                        );
                      }
                    })
                  }
                >
                  Save changes
                </Button>
              ) : savedText ? (
                <span className="text-xs font-medium text-emerald-700">
                  Saved
                </span>
              ) : null}
              <Button
                type="button"
                variant="secondary"
                disabled={
                  pending ||
                  isTranslating ||
                  status === "APPROVED" ||
                  !draft.trim()
                }
                onClick={() =>
                  startTransition(async () => {
                    setError("");
                    try {
                      let translationId = targetTranslation?.id;
                      if (
                        !translationId ||
                        draft !== (targetTranslation?.current_text ?? "")
                      ) {
                        const saved = await saveManualStringTranslation({
                          translationKeyId: translationKey.id,
                          languageCode: targetLang,
                          text: draft,
                          applicationId,
                        });
                        translationId = saved.id;
                      }
                      await setStringTranslationStatus({
                        translationId,
                        status: "APPROVED",
                        applicationId,
                        translationKeyId: translationKey.id,
                      });
                      router.refresh();
                    } catch (err) {
                      setError(
                        err instanceof Error ? err.message : "Approve failed"
                      );
                    }
                  })
                }
              >
                {status === "APPROVED" ? "Approved" : "Approve"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={pending || historyLoading || isTranslating}
                onClick={() =>
                  showHistory ? setShowHistory(false) : loadHistory()
                }
              >
                {showHistory
                  ? "Close history"
                  : historyLoading
                    ? "Loading…"
                    : "History"}
              </Button>
            </div>
          </div>
        </Card>
      </div>

      {showHistory ? (
        <StringVersionPanel
          versions={versions}
          draft={draft}
          loading={historyLoading}
          error={historyError}
          pending={pending}
          onRestore={setDraft}
          onDelete={(versionId, versionNumber) => {
            if (
              !confirm(
                `Delete version v${versionNumber}? This cannot be undone.`
              )
            ) {
              return;
            }
            startTransition(async () => {
              setHistoryError("");
              try {
                await deleteTranslationVersion({
                  versionId,
                  applicationId,
                  translationKeyId: translationKey.id,
                });
                setVersions((prev) =>
                  prev.filter((item) => item.id !== versionId)
                );
              } catch (err) {
                setHistoryError(
                  err instanceof Error
                    ? err.message
                    : "Failed to delete version"
                );
              }
            });
          }}
        />
      ) : null}
    </div>
  );
}
