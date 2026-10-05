"use client";

import { Fragment, useEffect, useState } from "react";
import { Badge, Card, inputClass, statusTone } from "@/components/ui";
import type {
  Content,
  ContentLifecycleStatus,
  ContentTranslation,
  ContentType,
  Language,
  TranslationStatus,
} from "@/lib/types";

const TYPE_LABEL: Record<ContentType, string> = {
  ARTICLE: "Article",
  NEWS: "News",
  ANNOUNCEMENT: "Announcement",
};

const STATUS_LABEL: Record<ContentLifecycleStatus, string> = {
  DRAFT: "Draft",
  TRANSLATING: "Translating",
  REVIEW: "Review",
  APPROVED: "Approved",
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
};

function isLayout(value: string | null): value is ViewLayout {
  return LAYOUTS.some((layout) => layout.id === value);
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

function FieldBody({ value }: { value: string }) {
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
  compact,
}: {
  label: string;
  value: string;
  compact?: boolean;
}) {
  if (!hasText(value)) return null;
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
      <FieldBody value={value} />
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
      <ReadField label="Title" value={pane.title} compact={compact} />
      <ReadField label="Summary" value={pane.summary} compact={compact} />
      <ReadField label="Body" value={pane.body} compact={compact} />
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
      role="radiogroup"
      aria-label="View layout"
      className="inline-flex flex-wrap rounded-lg border border-[var(--hub-border)] bg-[var(--hub-panel-soft)] p-0.5"
    >
      {LAYOUTS.map((layout) => {
        const active = value === layout.id;
        return (
          <button
            key={layout.id}
            type="button"
            role="radio"
            aria-checked={active}
            title={
              layout.id === "source"
                ? "Show the source language"
                : layout.id === "split"
                  ? "Compare two languages"
                  : layout.id === "columns"
                    ? "Show every language in its own column"
                    : "Line up title, summary, and body across languages"
            }
            className={`rounded-md px-2.5 py-1 text-xs font-semibold focus-visible:ring-2 focus-visible:ring-[var(--hub-accent-ring)] ${
              active
                ? "bg-white text-[var(--hub-fg)] shadow-sm"
                : "text-[var(--hub-muted-strong)] hover:text-[var(--hub-fg)]"
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
                <FieldBody value={pane[row.key]} />
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
}: {
  article: Article;
  languages: Language[];
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

  const [layout, setLayout] = useState<ViewLayout>("source");
  const [left, setLeft] = useState(article.source_language);
  const [right, setRight] = useState(defaultRight);

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
  const allPanes = options.map((code) => paneFor(article, languages, code));

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

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center gap-2 px-4 py-3 text-sm text-[var(--hub-muted-strong)]">
        <span>{TYPE_LABEL[article.content_type]}</span>
        <span aria-hidden>·</span>
        <span>Source {languageName(languages, article.source_language)}</span>
        <Badge tone={statusTone(article.status)}>{STATUS_LABEL[article.status]}</Badge>
        {article.scheduled_publish_at ? (
          <span>
            Due{" "}
            {new Date(article.scheduled_publish_at).toLocaleString(undefined, {
              month: "short",
              day: "numeric",
              year: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
          </span>
        ) : null}
      </Card>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--hub-border)] px-4 py-3">
          {canCompare ? (
            <LayoutSwitch value={activeLayout} onChange={chooseLayout} />
          ) : (
            <h2 className="text-sm font-semibold text-[var(--hub-fg)]">
              {sourcePane.name}
            </h2>
          )}
          {activeLayout === "source" ? <StatusBadge pane={sourcePane} /> : null}
          {activeLayout === "split" ? (
            <button
              type="button"
              className="hub-text-button text-xs"
              onClick={swapSides}
            >
              Swap sides
            </button>
          ) : null}
        </div>

        {activeLayout === "source" ? (
          <div className="px-4 py-4">
            <ArticleBody pane={sourcePane} />
          </div>
        ) : null}
        {activeLayout === "split" ? (
          <PaneGrid
            panes={splitPanes}
            optionLabels={optionLabels}
            onChange={assignSide}
          />
        ) : null}
        {activeLayout === "columns" ? (
          <PaneGrid panes={allPanes} optionLabels={optionLabels} scroll />
        ) : null}
        {activeLayout === "fields" ? <FieldCompare panes={allPanes} /> : null}
      </Card>
    </div>
  );
}
