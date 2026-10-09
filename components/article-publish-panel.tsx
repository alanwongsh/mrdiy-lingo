"use client";

import Link from "next/link";
import { useState } from "react";
import type {
  ContentLifecycleStatus,
  ContentPublication,
  PublishLanguageTarget,
  PublishVendorChoice,
} from "@/lib/types";
import { languageKey } from "@/lib/target-languages";
import {
  formatWhen,
  fromLocalInput,
  languagePublishAt,
  toLocalInput,
  waitingEstimate,
  type WaitingEstimate,
} from "@/lib/publish/schedule";
import { Badge, Button, inputClass } from "@/components/ui";

// Most urgent first: the collapsed row shows the first one that applies.
const SUMMARY_ORDER = ["Failed", "Retrying", "Publishing", "Due now", "Waiting", "Scheduled"];

/** One-line state of a language for its collapsed row. */
function languageSummary(
  rows: Array<{
    vendor: PublishVendorChoice;
    published: boolean;
    checked: boolean;
    estimate: WaitingEstimate | null;
  }>,
  publishAt: string | null
): { label: string; tone: WaitingEstimate["tone"] | "good"; detail: string; providers: string } {
  const ticked = rows.filter((row) => row.checked);
  const providers = ticked.map((row) => row.vendor.name).join(", ");
  if (ticked.length === 0) {
    return { label: "Not publishing", tone: "neutral", detail: "", providers: "" };
  }
  const live = ticked.filter((row) => row.published).length;
  if (live === ticked.length) {
    return { label: "Published", tone: "good", detail: "", providers };
  }
  const urgent = ticked
    .map((row) => row.estimate)
    .filter((estimate): estimate is WaitingEstimate => Boolean(estimate))
    .sort((a, b) => SUMMARY_ORDER.indexOf(a.label) - SUMMARY_ORDER.indexOf(b.label))[0];
  const partly = live > 0 ? `${live} of ${ticked.length} live · ` : "";
  if (!urgent) {
    return {
      label: "Waiting",
      tone: "neutral",
      detail: `${partly}${publishAt ? formatWhen(publishAt) : ""}`,
      providers,
    };
  }
  return { label: urgent.label, tone: urgent.tone, detail: `${partly}${urgent.detail}`, providers };
}

function languageLabel(languages: { code: string; name: string }[], code: string) {
  const key = languageKey(code);
  return languages.find((language) => languageKey(language.code) === key)?.name ?? code;
}

function pairKey(languageCode: string, vendorId: string) {
  return `${languageKey(languageCode)}:${vendorId}`;
}

export function PublishLanguagePicker({
  applicationId,
  languages,
  sourceLanguage,
  languageCodes,
  vendors,
  selected,
  publications = [],
  ready,
  notice,
  readOnly = false,
  publishing = false,
  onPublish,
  onChange,
  articleStatus,
  scheduledPublishAt = null,
  languageSchedule = {},
  approvedLanguages = [],
  onScheduleChange,
}: {
  applicationId: string;
  languages: { code: string; name: string }[];
  sourceLanguage: string;
  languageCodes: string[];
  vendors: PublishVendorChoice[];
  selected: PublishLanguageTarget[];
  publications?: ContentPublication[];
  ready: boolean;
  notice?: string;
  readOnly?: boolean;
  publishing?: boolean;
  onPublish?: () => void;
  onChange: (targets: PublishLanguageTarget[]) => void;
  /** Article status, for the reason a language is still waiting. */
  articleStatus: ContentLifecycleStatus;
  /** Article publish time. Languages without their own time use it. */
  scheduledPublishAt?: string | null;
  /** Language key -> ISO time. */
  languageSchedule?: Record<string, string>;
  /** Language codes whose translation is approved. The source always counts as approved. */
  approvedLanguages?: string[];
  /** Edit mode only. Receives the whole per-language schedule. */
  onScheduleChange?: (schedule: Record<string, string>) => void;
}) {
  // Languages with a failed send start open so the error is visible.
  const [openKeys, setOpenKeys] = useState<Set<string>>(
    () =>
      new Set(
        publications.filter((row) => row.status === "FAILED").map((row) => languageKey(row.language_code))
      )
  );
  function toggleOpen(code: string) {
    const key = languageKey(code);
    setOpenKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  if (!ready) {
    return <p className="text-sm text-red-700">{notice}</p>;
  }
  const codes = uniqueLanguages(sourceLanguage, [
    ...languageCodes,
    ...publications.map((item) => item.language_code),
    ...selected.map((item) => item.language_code),
  ]);
  const choices = vendors.filter(
    (vendor) =>
      vendor.status === "ACTIVE" ||
      selected.some((row) => row.vendor_id === vendor.id) ||
      publications.some((row) => row.vendor_id === vendor.id)
  );
  if (readOnly && selected.length === 0 && publications.length === 0) return null;
  const waiting = selected.some(
    (row) => publicationStatus(publications, row.language_code, row.vendor_id) !== "PUBLISHED"
  );

  function publicationFor(languageCode: string, vendorId: string) {
    const key = pairKey(languageCode, vendorId);
    return publications.find((row) => pairKey(row.language_code, row.vendor_id) === key);
  }

  const approved = new Set([languageKey(sourceLanguage), ...approvedLanguages.map(languageKey)]);
  const schedule = { scheduled_publish_at: scheduledPublishAt, language_publish_at: languageSchedule };

  function setLanguageTime(code: string, value: string) {
    if (!onScheduleChange) return;
    const next = { ...languageSchedule };
    const iso = fromLocalInput(value);
    if (iso) next[languageKey(code)] = iso;
    else delete next[languageKey(code)];
    onScheduleChange(next);
  }

  function toggle(languageCode: string, vendorId: string) {
    if (readOnly || publicationFor(languageCode, vendorId)?.status === "PUBLISHED") return;
    const key = pairKey(languageCode, vendorId);
    const on = selected.some((row) => pairKey(row.language_code, row.vendor_id) === key);
    onChange(
      on
        ? selected.filter((row) => pairKey(row.language_code, row.vendor_id) !== key)
        : [...selected, { language_code: languageCode, vendor_id: vendorId }]
    );
  }

  /** Every provider row for one language, with its status worked out once. */
  function providerRows(code: string) {
    const publishAt = languagePublishAt(schedule, code);
    return choices.map((vendor) => {
      const publication = publicationFor(code, vendor.id);
      const published = publication?.status === "PUBLISHED";
      const checked =
        published ||
        selected.some((row) => pairKey(row.language_code, row.vendor_id) === pairKey(code, vendor.id));
      const estimate =
        checked && !published
          ? waitingEstimate({
              publicationStatus: publication?.status,
              articleStatus,
              translationApproved: approved.has(languageKey(code)),
              publishAt,
            })
          : null;
      return { vendor, publication, published, checked, estimate };
    });
  }

  const rowsByLanguage = new Map(codes.map((code) => [code, providerRows(code)]));
  const tickedLanguages = codes.filter((code) => rowsByLanguage.get(code)!.some((row) => row.checked));
  const liveLanguages = tickedLanguages.filter((code) =>
    rowsByLanguage.get(code)!.filter((row) => row.checked).every((row) => row.published)
  );
  const nextUp = tickedLanguages
    .filter((code) => !liveLanguages.includes(code))
    .map((code) => ({ code, at: languagePublishAt(schedule, code) }))
    .filter((item): item is { code: string; at: string } => Boolean(item.at))
    .sort((a, b) => a.at.localeCompare(b.at))[0];

  return (
    <fieldset className="space-y-1.5">
      <legend className="flex w-full flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-semibold tracking-wide text-[var(--hub-muted-strong)]">
          Publisher
        </span>
        {tickedLanguages.length > 0 ? (
          <span className="text-xs font-normal text-[var(--hub-muted)]" suppressHydrationWarning>
            {liveLanguages.length} of {tickedLanguages.length} live
            {nextUp ? ` · Next: ${languageLabel(languages, nextUp.code)}, ${formatWhen(nextUp.at)}` : ""}
          </span>
        ) : null}
      </legend>
      {choices.length === 0 ? (
        <p className="text-sm text-[var(--hub-muted)]">
          No providers yet. Add one under{" "}
          <Link
            className="font-semibold text-[var(--hub-accent)] underline-offset-2 hover:underline"
            href={`/applications/${applicationId}/settings/publish`}
          >
            Settings → Publish
          </Link>
          .
        </p>
      ) : (
        <ul className="divide-y divide-[var(--hub-border)] rounded-lg border border-[var(--hub-border-strong)] bg-white">
          {codes.map((code) => {
            const ownTime = languageSchedule[languageKey(code)] ?? null;
            const publishAt = languagePublishAt(schedule, code);
            const rows = rowsByLanguage.get(code)!;
            const summary = languageSummary(rows, publishAt);
            const isOpen = openKeys.has(languageKey(code));
            const panelId = `publish-lang-${languageKey(code)}`;
            const ticked = rows.filter((row) => row.checked);
            const live = ticked.filter((row) => row.published);
            // Changing the time after a language is live sends nothing, so the field is locked.
            const allLive = ticked.length > 0 && live.length === ticked.length;
            const liveAt = live
              .map((row) => row.publication?.published_at)
              .filter((value): value is string => Boolean(value))
              .sort()
              .at(-1);
            return (
            <li key={code}>
              <button
                type="button"
                className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-left hover:bg-slate-50"
                aria-expanded={isOpen}
                aria-controls={panelId}
                onClick={() => toggleOpen(code)}
              >
                <span
                  aria-hidden
                  className={`text-xs text-[var(--hub-muted)] transition-transform ${isOpen ? "rotate-90" : ""}`}
                >
                  ▶
                </span>
                <span className="text-sm font-medium text-slate-900">
                  {languageLabel(languages, code)}
                  {languageKey(code) === languageKey(sourceLanguage) ? (
                    <span className="ml-2 text-xs font-normal text-[var(--hub-muted)]">Source</span>
                  ) : null}
                </span>
                <Badge tone={summary.tone}>{summary.label}</Badge>
                {summary.detail ? (
                  <span className="text-xs text-[var(--hub-muted)]" suppressHydrationWarning>
                    {summary.detail}
                  </span>
                ) : null}
                <span className="ml-auto truncate text-xs text-[var(--hub-muted)]">
                  {summary.providers}
                </span>
              </button>
              {isOpen ? (
              <div id={panelId} className="space-y-2 border-t border-[var(--hub-border)] bg-slate-50/60 px-3 py-2 pl-8">
              {allLive ? (
                <p className="text-xs text-[var(--hub-muted)]">
                  {liveAt ? `Published ${formatWhen(liveAt)}.` : "Published."} The publish time can no
                  longer be changed.
                </p>
              ) : !readOnly && onScheduleChange ? (
                <div className="space-y-1">
                <label className="flex flex-wrap items-center gap-1.5 text-xs text-[var(--hub-muted)]">
                  Publish at
                  <input
                    type="datetime-local"
                    className={`${inputClass} h-8 w-auto py-0 text-xs`}
                    value={toLocalInput(ownTime)}
                    onChange={(event) => setLanguageTime(code, event.target.value)}
                  />
                  {ownTime ? (
                    <button
                      type="button"
                      className="font-semibold text-[var(--hub-accent)] hover:underline"
                      onClick={() => setLanguageTime(code, "")}
                    >
                      Use article time
                    </button>
                  ) : (
                    <span>
                      {scheduledPublishAt ? `Article time: ${formatWhen(scheduledPublishAt)}` : "No article time"}
                    </span>
                  )}
                </label>
                {live.length > 0 ? (
                  <p className="text-xs text-[var(--hub-muted)]">
                    Already live with {live.map((row) => row.vendor.name).join(", ")}. This time applies
                    only to the providers still waiting.
                  </p>
                ) : null}
                </div>
              ) : publishAt ? (
                <p className="text-xs text-[var(--hub-muted)]">
                  {ownTime ? "Own publish time" : "Article time"}: {formatWhen(publishAt)}
                </p>
              ) : null}
              <ul className="space-y-1">
                {rows.map(({ vendor, publication, published, checked, estimate }) => {
                  const locked = readOnly || published;
                  return (
                    <li key={vendor.id} className="flex flex-wrap items-center gap-2 text-sm text-slate-800">
                      <label className={`flex items-center gap-2 ${locked ? "" : "cursor-pointer"}`}>
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={locked}
                          onChange={() => toggle(code, vendor.id)}
                        />
                        <span>{vendor.name}</span>
                      </label>
                      {vendor.status === "INACTIVE" ? (
                        <span className="text-xs text-[var(--hub-muted)]">Inactive</span>
                      ) : null}
                      {published ? (
                        <Badge tone="good">Published</Badge>
                      ) : estimate ? (
                        <>
                          <Badge tone={estimate.tone}>{estimate.label}</Badge>
                          {/* The countdown depends on the clock, so server and browser can differ by a minute. */}
                          <span className="text-xs text-[var(--hub-muted)]" suppressHydrationWarning>
                            {estimate.detail}
                          </span>
                        </>
                      ) : publication ? (
                        <Badge tone={publication.status === "FAILED" ? "bad" : "warn"}>
                          {publication.status === "FAILED" ? "Failed" : "Publishing"}
                        </Badge>
                      ) : null}
                      {published && publication?.external_url ? (
                        <a
                          href={`/published/${publication.id}`}
                          target="_blank"
                          className="font-semibold text-[var(--hub-accent)] underline-offset-2 hover:underline"
                        >
                          Open
                        </a>
                      ) : null}
                      {publication?.status === "FAILED" && publication.error_message ? (
                        <span className="text-[var(--hub-muted)]">{publication.error_message}</span>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
              </div>
              ) : null}
            </li>
            );
          })}
        </ul>
      )}
      {readOnly ? null : (
        <div className="flex flex-wrap items-center gap-3">
          {onPublish ? (
            <Button type="button" disabled={publishing || !waiting} onClick={onPublish}>
              {publishing ? "Publishing…" : "Publish now"}
            </Button>
          ) : null}
        </div>
      )}
    </fieldset>
  );
}

function publicationStatus(
  publications: ContentPublication[],
  languageCode: string,
  vendorId: string
) {
  return publications.find((row) => pairKey(row.language_code, row.vendor_id) === pairKey(languageCode, vendorId))
    ?.status;
}

function uniqueLanguages(sourceLanguage: string, languageCodes: string[]) {
  const seen = new Set<string>();
  const codes: string[] = [];
  for (const code of [sourceLanguage, ...languageCodes]) {
    const trimmed = code.trim();
    const key = languageKey(trimmed);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    codes.push(trimmed);
  }
  return codes;
}
