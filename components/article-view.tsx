"use client";

import { Fragment, useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveReviewedContentTranslation } from "@/lib/actions/quality";
import { applyQualityAction, qualityActionStillOpen } from "@/lib/translation-quality/apply-action";
import type { QualityAction, QualityTargetField } from "@/lib/translation-quality/types";
import { TranslationQualityPanel } from "@/components/translation-quality-panel";
import { PublishLanguagePicker } from "@/components/article-publish-panel";
import { Badge, Card, inputClass, statusTone } from "@/components/ui";
import type {
  Content,
  ContentLifecycleStatus,
  ContentPublication,
  ContentTranslation,
  Language,
  PublishVendorChoice,
  SourceContentFields,
  TranslationStatus,
} from "@/lib/types";

const STATUS_LABEL: Record<ContentLifecycleStatus, string> = {
  DRAFT: "Draft",
  TRANSLATING: "Translating",
  REVIEW: "Review",
  APPROVED: "Approved",
  PUBLISHING: "Publishing",
  PUBLISHED: "Published",
};

const TRANSLATION_LABEL: Record<TranslationStatus, string> = {
  MISSING: "Missing",
  SYSTEM_GENERATED: "Auto",
  MANUALLY_MODIFIED: "Edited",
  APPROVED: "Approved",
};

const LAYOUTS = [
  { id: "source", label: "Source" },
  { id: "split", label: "Side by side" },
  { id: "columns", label: "All languages" },
  { id: "fields", label: "By field" },
] as const;

type ViewLayout = (typeof LAYOUTS)[number]["id"];

const LAYOUT_STORAGE_KEY = "mrdiy-lingo:article-view-layout";

const FIELD_ROWS = [
  { key: "title", label: "Title" },
  { key: "summary", label: "Summary" },
  { key: "body", label: "Body" },
] as const;

type Article = Content & { translations: ContentTranslation[] };

type Pane = {
  code: string;
  name: string;
  isSource: boolean;
  status: TranslationStatus | null;
  title: string;
  summary: string;
  body: string;
  empty: boolean;
  marks?: ReviewMark[];
  locate?: { field: QualityTargetField; text: string } | null;
};

function marksFor(pane: Pane, field: QualityTargetField) {
  return pane.marks?.filter((mark) => mark.field === field);
}

function locateFor(pane: Pane, field: QualityTargetField) {
  return pane.locate?.field === field ? pane.locate.text : undefined;
}

type ReviewMark = {
  field: QualityTargetField;
  original: string;
  proposed: string;
};

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function sourceHtml(value: string) {
  if (/<[a-z][\s\S]*>/i.test(value)) return value;
  return escapeHtml(value).replace(/\n/g, "<br>");
}

/** Wrap the first plain-text match, leaving tags and surrounding formatting in place. */
function wrapFirstText(html: string, phrase: string, wrap: (matched: string) => string) {
  const needle = phrase.trim();
  if (!needle || !html) return html;
  const lower = needle.toLowerCase();
  let index = 0;
  let out = "";
  while (index < html.length) {
    if (html[index] === "<") {
      const end = html.indexOf(">", index);
      if (end === -1) return out + html.slice(index);
      out += html.slice(index, end + 1);
      index = end + 1;
      continue;
    }
    const next = html.indexOf("<", index);
    const end = next === -1 ? html.length : next;
    const text = html.slice(index, end);
    const at = text.toLowerCase().indexOf(lower);
    if (at >= 0) {
      const matched = text.slice(at, at + needle.length);
      return (
        out +
        text.slice(0, at) +
        wrap(matched) +
        text.slice(at + needle.length) +
        html.slice(end)
      );
    }
    out += text;
    index = end;
  }
  return html;
}

function decodeTextEntity(text: string, offset: number): { char: string; length: number } | null {
  if (text[offset] !== "&") return null;
  const end = text.indexOf(";", offset + 1);
  if (end < 0 || end - offset > 16) return null;
  const body = text.slice(offset + 1, end);
  const named: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
  };
  if (body.startsWith("#")) {
    const code =
      body[1] === "x" || body[1] === "X"
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);
    if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return null;
    const char = String.fromCodePoint(code);
    return { char: char === "\u00a0" ? " " : char, length: end - offset + 1 };
  }
  const char = named[body.toLowerCase()];
  if (!char) return null;
  return { char, length: end - offset + 1 };
}

/** Highlight a sentence that is split by tags, such as a brand name inside a link. */
function markAcrossTags(html: string, phrase: string) {
  const needle = phrase.trim().toLowerCase().replace(/\s+/g, " ");
  if (!needle || !html) return html;
  const segments: Array<{ start: number; end: number; text: string }> = [];
  let cursor = 0;
  while (cursor < html.length) {
    if (html[cursor] === "<") {
      const end = html.indexOf(">", cursor);
      if (end < 0) break;
      cursor = end + 1;
      continue;
    }
    const next = html.indexOf("<", cursor);
    const end = next < 0 ? html.length : next;
    if (end > cursor) segments.push({ start: cursor, end, text: html.slice(cursor, end) });
    cursor = end;
  }
  let flat = "";
  const map: Array<{ segment: number; offset: number; length: number } | null> = [];
  const pushChar = (
    segment: number | null,
    offset: number,
    length: number,
    char: string
  ) => {
    flat += char.toLowerCase();
    map.push(segment == null ? null : { segment, offset, length });
  };
  for (let index = 0; index < segments.length; index += 1) {
    const text = segments[index].text;
    let offset = 0;
    while (offset < text.length) {
      const entity = decodeTextEntity(text, offset);
      const char = entity?.char ?? text[offset];
      const length = entity?.length ?? 1;
      if (/\s/.test(char) && /\s$/.test(flat)) {
        offset += length;
        continue;
      }
      pushChar(index, offset, length, /\s/.test(char) ? " " : char);
      offset += length;
    }
  }
  const at = flat.indexOf(needle);
  if (at < 0) return html;
  const covered = new Map<number, { from: number; to: number }>();
  for (let index = at; index < at + needle.length && index < map.length; index += 1) {
    const point = map[index];
    if (!point) continue;
    const current = covered.get(point.segment);
    const end = point.offset + point.length;
    if (!current) covered.set(point.segment, { from: point.offset, to: end });
    else current.to = Math.max(current.to, end);
  }
  if (covered.size === 0) return html;
  let out = "";
  let written = 0;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    out += html.slice(written, segment.start);
    const range = covered.get(index);
    if (!range) out += segment.text;
    else {
      const matched = segment.text.slice(range.from, range.to);
      out +=
        segment.text.slice(0, range.from) +
        `<mark class="quality-locate" data-quality-change="">${matched}</mark>` +
        segment.text.slice(range.to);
    }
    written = segment.end;
  }
  return out + html.slice(written);
}

function decorateField(value: string, marks: ReviewMark[], locateText?: string) {
  let html = sourceHtml(value);
  for (const mark of marks) {
    if (!mark.proposed) continue;
    html = wrapFirstText(
      html,
      mark.proposed,
      (matched) =>
        `<del class="quality-diff-remove" data-quality-change="">${escapeHtml(mark.original)}</del><mark class="quality-diff-add">${escapeHtml(matched)}</mark>`
    );
  }
  if (locateText) {
    const marked = wrapFirstText(
      html,
      locateText,
      (matched) => `<mark class="quality-locate" data-quality-change="">${escapeHtml(matched)}</mark>`
    );
    html = marked === html ? markAcrossTags(html, locateText) : marked;
  }
  return html;
}

function isLayout(value: string | null): value is ViewLayout {
  return LAYOUTS.some((layout) => layout.id === value);
}

function formatStamp(iso: string) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kuala_Lumpur",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
}

function languageName(languages: Language[], code: string) {
  const key = code.trim().toLowerCase();
  return (
    languages.find((language) => language.code.trim().toLowerCase() === key)
      ?.name ?? code
  );
}

function hasText(value: string | null | undefined) {
  return Boolean(value?.replace(/<[^>]+>/g, "").trim());
}

function translationFields(translation: ContentTranslation | undefined): SourceContentFields {
  return {
    title: translation?.title ?? "",
    summary: translation?.summary ?? "",
    body: translation?.body ?? "",
    seo_title: translation?.seo_title ?? "",
    seo_description: translation?.seo_description ?? "",
  };
}

function paneFor(article: Article, languages: Language[], code: string): Pane {
  const isSource = code === article.source_language;
  const translation = article.translations.find(
    (row) => row.language_code.toLowerCase() === code.toLowerCase()
  );
  const title = isSource
    ? article.source_content.title || article.title
    : (translation?.title ?? "");
  const summary = isSource
    ? article.source_content.summary
    : (translation?.summary ?? "");
  const body = isSource ? article.source_content.body : (translation?.body ?? "");
  return {
    code,
    name: languageName(languages, code),
    isSource,
    status: isSource ? null : (translation?.status ?? "MISSING"),
    title,
    summary,
    body,
    empty: !hasText(title) && !hasText(summary) && !hasText(body),
  };
}

function FieldBody({
  value,
  marks = [],
  locateText,
}: {
  value: string;
  marks?: ReviewMark[];
  locateText?: string;
}) {
  const decorated = marks.length > 0 || locateText;
  if (decorated) {
    return (
      <div
        className="html-editor-surface text-sm leading-relaxed text-[var(--hub-fg)]"
        dangerouslySetInnerHTML={{ __html: decorateField(value, marks, locateText) }}
      />
    );
  }
  if (!hasText(value)) {
    return <p className="text-sm text-[var(--hub-muted)]">Empty</p>;
  }
  const html = /<[a-z][\s\S]*>/i.test(value);
  if (html) {
    return (
      <div
        className="html-editor-surface text-sm leading-relaxed text-[var(--hub-fg)]"
        dangerouslySetInnerHTML={{ __html: value }}
      />
    );
  }
  return (
    <p className="text-sm leading-relaxed break-words whitespace-pre-wrap text-[var(--hub-fg)]">
      {value}
    </p>
  );
}

function ReadField({
  label,
  value,
  marks,
  locateText,
  compact,
}: {
  label: string;
  value: string;
  marks?: ReviewMark[];
  locateText?: string;
  compact?: boolean;
}) {
  if (!hasText(value) && !marks?.length) return null;
  return (
    <div
      className={
        compact
          ? "grid gap-1"
          : "grid gap-1 sm:grid-cols-[7rem_1fr] sm:gap-4"
      }
    >
      <div className="text-xs font-semibold tracking-wide text-[var(--hub-muted)] uppercase">
        {label}
      </div>
      <FieldBody value={value} marks={marks} locateText={locateText} />
    </div>
  );
}

function StatusBadge({ pane }: { pane: Pane }) {
  if (pane.isSource || !pane.status) {
    return <Badge tone="neutral">Source</Badge>;
  }
  return (
    <Badge tone={statusTone(pane.status)}>{TRANSLATION_LABEL[pane.status]}</Badge>
  );
}

function ArticleBody({ pane, compact }: { pane: Pane; compact?: boolean }) {
  if (pane.empty) {
    return (
      <p className="text-sm text-[var(--hub-muted)]">
        {pane.isSource ? "No source text yet." : "No translation yet."}
      </p>
    );
  }
  return (
    <div className="space-y-3">
      <ReadField label="Title" value={pane.title} marks={marksFor(pane, "title")} locateText={locateFor(pane, "title")} compact={compact} />
      <ReadField label="Summary" value={pane.summary} marks={marksFor(pane, "summary")} locateText={locateFor(pane, "summary")} compact={compact} />
      <ReadField label="Body" value={pane.body} marks={marksFor(pane, "content")} locateText={locateFor(pane, "content")} compact={compact} />
    </div>
  );
}

function LayoutSwitch({
  value,
  onChange,
}: {
  value: ViewLayout;
  onChange: (layout: ViewLayout) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="View layout"
      className="flex flex-wrap gap-1 rounded-lg border border-[var(--hub-border)] bg-white p-1"
    >
      {LAYOUTS.map((layout) => {
        const active = value === layout.id;
        return (
          <button
            key={layout.id}
            type="button"
            role="tab"
            aria-selected={active}
            title={
              layout.id === "source"
                ? "Show the source language"
                : layout.id === "split"
                  ? "Compare two languages"
                  : layout.id === "columns"
                    ? "Show every language in its own column"
                    : "Line up title, summary, and body across languages"
            }
            className={`rounded-md px-3 py-1.5 text-xs font-semibold transition focus-visible:ring-2 focus-visible:ring-[var(--hub-accent-ring)] ${
              active
                ? "bg-[var(--diy-red)] text-white shadow-sm"
                : "text-slate-600 hover:bg-[var(--diy-yellow-soft)] hover:text-slate-900"
            }`}
            onClick={() => onChange(layout.id)}
          >
            {layout.label}
          </button>
        );
      })}
    </div>
  );
}

function sameCode(a: string, b: string) {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function VisibleLanguages({
  options,
  selected,
  onChange,
}: {
  options: { code: string; label: string }[];
  selected: string[];
  onChange: (codes: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const chosen = options.filter((option) =>
    selected.some((code) => sameCode(code, option.code))
  );
  const summary =
    chosen.length === 0
      ? "No languages"
      : chosen.length === options.length
        ? "All languages"
        : chosen.length === 1
          ? chosen[0].label
          : `${chosen.length} languages`;

  useEffect(() => {
    function onDoc(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  function toggle(code: string) {
    if (selected.some((item) => sameCode(item, code))) {
      onChange(selected.filter((item) => !sameCode(item, code)));
      return;
    }
    onChange([...selected, code]);
  }

  return (
    <div className={`relative ${open ? "z-30" : ""}`} ref={rootRef}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        aria-label="Languages to show"
        className="inline-flex h-8 max-w-full items-center justify-between gap-2 rounded-lg border border-[var(--hub-border)] bg-white px-3 text-xs font-semibold text-slate-700 hover:border-slate-400 sm:min-w-40"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="truncate">{summary}</span>
        <span className="text-slate-400" aria-hidden>
          ▾
        </span>
      </button>
      {open ? (
        <div
          id={listId}
          className="absolute right-0 z-30 mt-1 w-56 rounded-lg border border-[var(--hub-border)] bg-white p-2 shadow-lg"
        >
          <div className="mb-1 flex items-center justify-between px-1 pb-1">
            <button
              type="button"
              className="hub-text-button text-xs"
              onClick={() => onChange(options.map((option) => option.code))}
            >
              All
            </button>
            <button
              type="button"
              className="hub-text-button text-xs"
              onClick={() => onChange([])}
            >
              None
            </button>
          </div>
          <ul className="max-h-60 space-y-0.5 overflow-auto">
            {options.map((option) => {
              const checked = selected.some((code) => sameCode(code, option.code));
              return (
                <li key={option.code}>
                  <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-slate-50">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(option.code)}
                    />
                    <span className="font-medium text-slate-900">{option.label}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function LanguageSelect({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id?: string;
  label: string;
  value: string;
  options: { code: string; label: string }[];
  onChange: (code: string) => void;
}) {
  return (
    <select
      id={id}
      aria-label={label}
      className={`${inputClass} w-full min-w-0 sm:w-auto sm:min-w-48`}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      {options.map((option) => (
        <option key={option.code} value={option.code}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

function PaneGrid({
  panes,
  optionLabels,
  scroll,
  onChange,
}: {
  panes: Pane[];
  optionLabels: { code: string; label: string }[];
  scroll?: boolean;
  onChange?: (index: number, code: string) => void;
}) {
  const multi = panes.length > 1;
  const grid = (
    <div
      className={
        scroll
          ? "grid gap-px bg-[var(--hub-border)]"
          : `grid gap-px bg-[var(--hub-border)] ${multi ? "lg:grid-cols-2" : ""}`
      }
      style={
        scroll
          ? {
              gridTemplateColumns: `repeat(${panes.length}, minmax(22rem, 1fr))`,
              minWidth: "100%",
            }
          : undefined
      }
    >
      {panes.map((pane, index) => {
        const span =
          !scroll && multi && panes.length % 2 === 1 && index === panes.length - 1;
        return (
          <section
            key={`${index}-${pane.code}`}
            className={`min-w-0 bg-[var(--hub-panel)] ${span ? "lg:col-span-2" : ""}`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--hub-border)] px-4 py-3">
              {onChange ? (
                <LanguageSelect
                  label={index === 0 ? "Left language" : "Right language"}
                  value={pane.code}
                  options={optionLabels}
                  onChange={(code) => onChange(index, code)}
                />
              ) : (
                <h2 className="text-sm font-semibold text-[var(--hub-fg)]">
                  {pane.name}
                  {pane.isSource ? " (source)" : ""}
                </h2>
              )}
              <StatusBadge pane={pane} />
            </div>
            <div className="px-4 py-4">
              <ArticleBody pane={pane} compact={multi && !span} />
            </div>
          </section>
        );
      })}
    </div>
  );

  if (!scroll) return grid;
  return <div className="min-w-0 overflow-x-auto">{grid}</div>;
}

function FieldCompare({ panes }: { panes: Pane[] }) {
  return (
    <div className="min-w-0 overflow-x-auto">
      <div
        className="grid"
        style={{
          gridTemplateColumns: `7.5rem repeat(${panes.length}, minmax(18rem, 1fr))`,
          minWidth: "100%",
        }}
      >
        <div className="sticky left-0 z-20 border-r border-b border-[var(--hub-border)] bg-[var(--hub-panel-soft)]" />
        {panes.map((pane) => (
          <div
            key={pane.code}
            className="flex flex-wrap items-center justify-between gap-2 border-b border-l border-[var(--hub-border)] bg-[var(--hub-panel-soft)] px-3 py-2.5"
          >
            <h2 className="text-sm font-semibold text-[var(--hub-fg)]">
              {pane.name}
              {pane.isSource ? " (source)" : ""}
            </h2>
            <StatusBadge pane={pane} />
          </div>
        ))}
        {FIELD_ROWS.map((row) => (
          <Fragment key={row.key}>
            <div className="sticky left-0 z-10 border-r border-b border-[var(--hub-border)] bg-[var(--hub-panel)] px-3 py-3 text-xs font-semibold tracking-wide text-[var(--hub-muted)] uppercase">
              {row.label}
            </div>
            {panes.map((pane) => (
              <div
                key={`${row.key}-${pane.code}`}
                className="min-w-0 border-b border-l border-[var(--hub-border)] px-3 py-3"
              >
                <FieldBody
                  value={pane[row.key]}
                  marks={marksFor(pane, row.key === "body" ? "content" : row.key)}
                  locateText={locateFor(pane, row.key === "body" ? "content" : row.key)}
                />
              </div>
            ))}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

export function ArticleView({
  article,
  languages,
  contentTypeName,
  applicationId,
  canReview,
  publishVendors,
  publishTargets,
  publications,
}: {
  article: Article;
  languages: Language[];
  contentTypeName: string;
  applicationId: string;
  canReview: boolean;
  publishVendors: PublishVendorChoice[];
  publishTargets: { language_code: string; vendor_id: string }[];
  publications: ContentPublication[];
}) {
  const options = Array.from(
    new Set([
      article.source_language,
      ...(article.target_languages ?? []).filter(Boolean),
    ])
  );
  const canCompare = options.length > 1;
  const optionLabels = options.map((code) => ({
    code,
    label: `${languageName(languages, code)}${
      code === article.source_language ? " (source)" : ""
    }`,
  }));
  const defaultRight =
    options.find((code) => code !== article.source_language) ??
    article.source_language;

  const router = useRouter();
  const [saving, startSave] = useTransition();
  const [layout, setLayout] = useState<ViewLayout>("split");
  const [left, setLeft] = useState(article.source_language);
  const [right, setRight] = useState(defaultRight);
  const [visibleCodes, setVisibleCodes] = useState(options);
  const optionKey = options.join("\0");

  useEffect(() => {
    setVisibleCodes(optionKey ? optionKey.split("\0") : []);
  }, [optionKey]);

  useEffect(() => {
    const saved = localStorage.getItem(LAYOUT_STORAGE_KEY);
    const next = saved === "single" ? "source" : saved;
    if (isLayout(next)) setLayout(next);
  }, []);

  function chooseLayout(next: ViewLayout) {
    setLayout(next);
    localStorage.setItem(LAYOUT_STORAGE_KEY, next);
  }

  const activeLayout: ViewLayout = canCompare ? layout : "source";
  const leftCode = options.includes(left) ? left : article.source_language;
  const rightCandidate = options.includes(right) ? right : defaultRight;
  const rightCode =
    rightCandidate === leftCode
      ? (options.find((code) => code !== leftCode) ?? leftCode)
      : rightCandidate;

  const sourcePane = paneFor(article, languages, article.source_language);
  const splitPanes = [
    paneFor(article, languages, leftCode),
    paneFor(article, languages, rightCode),
  ];
  const shownCodes = options.filter((code) =>
    visibleCodes.some((selected) => sameCode(selected, code))
  );
  const shownPanes = shownCodes.map((code) => paneFor(article, languages, code));

  function assignSide(index: number, code: string) {
    if (index === 0) {
      if (code === rightCode) setRight(leftCode);
      setLeft(code);
      return;
    }
    if (code === leftCode) setLeft(rightCode);
    setRight(code);
  }

  function swapSides() {
    setLeft(rightCode);
    setRight(leftCode);
  }

  const targets = options.filter((code) => !sameCode(code, article.source_language));
  const reviewCode =
    targets.find((code) => sameCode(code, rightCode)) ??
    targets.find((code) => sameCode(code, leftCode)) ??
    targets[0];
  const reviewTranslation = article.translations.find(
    (row) => reviewCode && row.language_code.toLowerCase() === reviewCode.toLowerCase()
  );

  function focusReview(code: string) {
    chooseLayout("split");
    setLeft(article.source_language);
    if (sameCode(code, article.source_language)) return;
    setRight(code);
  }

  const savedFields = translationFields(reviewTranslation);
  const savedKey = `${reviewCode ?? ""}:${reviewTranslation?.updated_at ?? ""}`;
  const [draftKey, setDraftKey] = useState(savedKey);
  const [reviewDraft, setReviewDraft] = useState<SourceContentFields>(savedFields);
  const reviewDraftRef = useRef(reviewDraft);
  reviewDraftRef.current = reviewDraft;
  const [acceptedActionIds, setAcceptedActionIds] = useState<string[]>([]);
  const [ignoredActionIds, setIgnoredActionIds] = useState<string[]>([]);
  const [localHandledIds, setLocalHandledIds] = useState<string[]>([]);
  const [qualityRunId, setQualityRunId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState("");
  const [reviewNote, setReviewNote] = useState("");
  const [reviewMarks, setReviewMarks] = useState<ReviewMark[]>([]);
  const [locate, setLocate] = useState<{ field: QualityTargetField; text: string } | null>(null);
  const [scrollRequest, setScrollRequest] = useState(0);
  if (draftKey !== savedKey) {
    setDraftKey(savedKey);
    setReviewDraft(savedFields);
    setAcceptedActionIds([]);
    setIgnoredActionIds([]);
    setLocalHandledIds([]);
    setQualityRunId(null);
    setSaveError("");
    setReviewNote("");
    setReviewMarks([]);
    setLocate(null);
  }
  const reviewTextChanged =
    reviewDraft.title !== savedFields.title ||
    reviewDraft.summary !== savedFields.summary ||
    reviewDraft.body !== savedFields.body;
  const reviewDirty =
    reviewTextChanged ||
    acceptedActionIds.length > 0 ||
    ignoredActionIds.length > 0;
  function showInArticle(target: { field: QualityTargetField; text: string }) {
    setLocate(target);
    setScrollRequest((current) => current + 1);
  }

  useEffect(() => {
    if (!scrollRequest) return;
    const frame = requestAnimationFrame(() => {
      document.querySelector(".quality-locate")?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [scrollRequest]);

  function withReviewDraft(pane: Pane): Pane {
    if (!reviewCode || !sameCode(pane.code, reviewCode)) return pane;
    return {
      ...pane,
      title: reviewDraft.title,
      summary: reviewDraft.summary,
      body: reviewDraft.body,
      marks: reviewMarks,
      locate,
      empty:
        !hasText(reviewDraft.title) &&
        !hasText(reviewDraft.summary) &&
        !hasText(reviewDraft.body),
    };
  }

  function acceptReviewAction(action: QualityAction, stored = true, quiet = false) {
    try {
      const next = applyQualityAction(reviewDraftRef.current, action);
      reviewDraftRef.current = next;
      setReviewDraft(next);
      const remember = (ids: string[]) => (ids.includes(action.id) ? ids : [...ids, action.id]);
      if (stored) setAcceptedActionIds(remember);
      else setLocalHandledIds(remember);
      if (action.originalText && action.proposedText) {
        setReviewMarks((current) => [
          ...current,
          {
            field: action.targetField,
            original: action.originalText ?? "",
            proposed: action.proposedText ?? "",
          },
        ]);
      }
      setLocate(null);
      setSaveError("");
      const where =
        action.targetField === "content"
          ? "body"
          : action.targetField === "summary"
            ? "description"
            : "title";
      setReviewNote(`Updated the ${where}. Save changes to keep it.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not apply the suggestion.";
      // Accept all: an earlier suggestion may already have replaced this wording.
      if (quiet && !qualityActionStillOpen(reviewDraftRef.current, action)) {
        const remember = (ids: string[]) => (ids.includes(action.id) ? ids : [...ids, action.id]);
        if (stored) setAcceptedActionIds(remember);
        else setLocalHandledIds(remember);
        return;
      }
      setSaveError(
        quiet
          ? "Some suggestions could not be applied automatically. They are still open, so edit them by hand."
          : message
      );
      setReviewNote("");
    }
  }

  function ignoreReviewAction(actionId: string, stored = true) {
    const remember = (ids: string[]) => (ids.includes(actionId) ? ids : [...ids, actionId]);
    if (stored) setIgnoredActionIds(remember);
    else setLocalHandledIds(remember);
    setSaveError("");
    setReviewNote("Ignored. Analyze again if you want this finding back.");
  }

  function saveReview() {
    if (!reviewCode) return;
    setSaveError("");
    startSave(async () => {
      try {
        await saveReviewedContentTranslation({
          contentId: article.id,
          languageCode: reviewCode,
          applicationId,
          fields: {
            ...reviewDraft,
            seo_title: reviewDraft.seo_title || reviewDraft.title,
            seo_description: reviewDraft.seo_description || reviewDraft.summary,
          },
          qualityRunId,
          acceptedActionIds: qualityRunId ? acceptedActionIds : [],
          ignoredActionIds: [],
        });
        router.refresh();
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : "Could not save the translation.");
      }
    });
  }

  return (
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="min-w-0 space-y-4">
      <Card className="flex flex-wrap items-center gap-2 px-4 py-3 text-sm text-[var(--hub-muted-strong)]">
        <span>{contentTypeName}</span>
        {article.market ? (
          <>
            <span aria-hidden>·</span>
            <span>{article.market}</span>
          </>
        ) : null}
        <span aria-hidden>·</span>
        <span>Source {languageName(languages, article.source_language)}</span>
        <Badge tone={statusTone(article.status)}>{STATUS_LABEL[article.status]}</Badge>
        {article.scheduled_publish_at ? (
          <span>
            Due{" "}
            {formatStamp(article.scheduled_publish_at)}
          </span>
        ) : null}
      </Card>

      <PublishLanguagePicker
        applicationId={applicationId}
        languages={languages}
        sourceLanguage={article.source_language}
        languageCodes={article.target_languages ?? []}
        vendors={publishVendors}
        selected={publishTargets}
        publications={publications}
        ready
        readOnly
        onChange={() => {}}
        articleStatus={article.status}
        scheduledPublishAt={article.scheduled_publish_at}
        languageSchedule={article.language_publish_at}
        approvedLanguages={article.translations
          .filter((row) => row.status === "APPROVED")
          .map((row) => row.language_code)}
      />

      <Card className="overflow-visible">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--hub-border)] px-4 py-3">
          {canCompare ? (
            <LayoutSwitch value={activeLayout} onChange={chooseLayout} />
          ) : (
            <h2 className="text-sm font-semibold text-[var(--hub-fg)]">
              {sourcePane.name}
            </h2>
          )}
          {activeLayout === "source" ? <StatusBadge pane={sourcePane} /> : null}
          {reviewMarks.length > 0 ? (
            <div className="flex gap-3 text-[11px] text-slate-600">
              <span className="rounded-sm bg-red-100 px-1 text-red-800 line-through">removed</span>
              <span className="rounded-sm bg-emerald-100 px-1 font-medium text-emerald-900">added</span>
            </div>
          ) : null}
          {activeLayout === "split" ? (
            <button
              type="button"
              className="hub-text-button text-xs"
              onClick={swapSides}
            >
              Swap sides
            </button>
          ) : null}
          {activeLayout === "columns" || activeLayout === "fields" ? (
            <VisibleLanguages
              options={optionLabels}
              selected={visibleCodes}
              onChange={setVisibleCodes}
            />
          ) : null}
        </div>

        {activeLayout === "source" ? (
          <div className="px-4 py-4">
            <ArticleBody pane={withReviewDraft(sourcePane)} />
          </div>
        ) : null}
        {activeLayout === "split" ? (
          <PaneGrid
            panes={splitPanes.map(withReviewDraft)}
            optionLabels={optionLabels}
            onChange={assignSide}
          />
        ) : null}
        {activeLayout === "columns" || activeLayout === "fields" ? (
          shownPanes.length === 0 ? (
            <p className="px-4 py-4 text-sm text-[var(--hub-muted)]">
              Choose a language to show.
            </p>
          ) : activeLayout === "columns" ? (
            <PaneGrid panes={shownPanes.map(withReviewDraft)} optionLabels={optionLabels} scroll />
          ) : (
            <FieldCompare panes={shownPanes.map(withReviewDraft)} />
          )
        ) : null}
      </Card>
      </div>
      {reviewCode ? (
        <>
        <TranslationQualityPanel
          key={`${reviewCode}:${reviewTranslation?.updated_at ?? ""}`}
          variant="rail"
          applicationId={applicationId}
          contentId={article.id}
          languageCode={reviewCode}
          languageName={languageName(languages, reviewCode)}
          languageChoices={targets.map((code) => ({
            code,
            label: languageName(languages, code),
          }))}
          onLanguageChange={focusReview}
          sourceLanguage={article.source_language}
          source={article.source_content}
          draft={reviewDraft}
          savedAt={reviewTranslation?.updated_at ?? ""}
          canReview={canReview}
          canApply={canReview}
          unsaved={reviewDirty}
          saving={saving}
          onSave={reviewDirty ? saveReview : undefined}
          acceptedActionIds={[...acceptedActionIds, ...localHandledIds]}
          ignoredActionIds={ignoredActionIds}
          onLatestRunId={setQualityRunId}
          onAccept={acceptReviewAction}
          onIgnore={ignoreReviewAction}
          onPreview={setLocate}
          onShow={showInArticle}
          showEditLink
        />
        {reviewNote ? <p className="mt-2 text-sm text-slate-600">{reviewNote}</p> : null}
        {saveError ? <p className="mt-2 text-sm text-red-700">{saveError}</p> : null}
        </>
      ) : null}
    </div>
  );
}
