"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createTerminologyEntry,
  deleteTerminologyEntries,
  deleteTerminologyEntry,
  saveQualityCategories,
  updateTerminologyEntry,
} from "@/lib/actions/quality";
import { FilterSelect, type FilterOption } from "@/components/filter-select";
import { IconButton, PencilIcon, TrashIcon } from "@/components/icon-button";
import { Badge, Button, Card, Field, Pagination, inputClass } from "@/components/ui";
import type { Language } from "@/lib/types";
import type {
  QualityCategoryConfig,
  TerminologyEntry,
} from "@/lib/translation-quality/types";

type CategoryDraft = {
  id: string;
  name: string;
  description: string;
  categoryType: QualityCategoryConfig["categoryType"];
  enabled: boolean;
  weight: number;
};

type TermDraft = {
  id: string | null;
  term: string;
  sourceLanguage: string;
  targetLanguage: string;
  preferred: string;
  forbidden: string;
  category: string;
  definition: string;
  isActive: boolean;
};

type TermFilters = {
  q: string;
  source: string;
  target: string;
  status: string;
};

export function QualitySettings({
  applicationId,
  categories,
  terminology,
  languages,
  canManage,
  page,
  pageSize,
  total,
  filters,
}: {
  applicationId: string;
  categories: QualityCategoryConfig[];
  terminology: TerminologyEntry[];
  languages: Language[];
  canManage: boolean;
  page: number;
  pageSize: number;
  total: number;
  filters: TermFilters;
}) {
  const router = useRouter();
  const basePath = `/applications/${applicationId}/settings/quality`;
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [drafts, setDrafts] = useState<CategoryDraft[]>(() => categories.map(toDraft));
  const [editor, setEditor] = useState<TermDraft | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [q, setQ] = useState(filters.q);
  const [source, setSource] = useState(() =>
    filters.source ? matchLanguage(languages, filters.source) : ""
  );
  const [target, setTarget] = useState(() =>
    filters.target ? matchLanguage(languages, filters.target) : ""
  );
  const [status, setStatus] = useState(filters.status);
  const [filtersOpen, setFiltersOpen] = useState(
    Boolean(filters.source || filters.target || filters.status)
  );

  const scoringDirty = drafts.some((draft) => {
    const saved = categories.find((item) => item.id === draft.id);
    return !saved || saved.enabled !== draft.enabled || saved.weight !== draft.weight;
  });
  const enabledWeight = drafts
    .filter((item) => item.enabled)
    .reduce((sum, item) => sum + (item.weight > 0 ? item.weight : 0), 0);
  const languageOptions = languages.map((language) => ({
    value: language.code,
    label: languageOptionLabel(language),
  }));
  const pageIds = useMemo(() => terminology.map((item) => item.id), [terminology]);
  const selectedOnPage = pageIds.filter((id) => selected.has(id));
  const allSelected = pageIds.length > 0 && selectedOnPage.length === pageIds.length;
  const someSelected = selectedOnPage.length > 0 && !allSelected;
  const activeFilterCount =
    (filters.source ? 1 : 0) + (filters.target ? 1 : 0) + (filters.status ? 1 : 0);

  function saveScoring(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setNotice("");
    startTransition(async () => {
      try {
        await saveQualityCategories({
          applicationId,
          categories: drafts.map((item) => ({
            id: item.id,
            enabled: item.enabled,
            weight: item.weight,
          })),
        });
        setNotice("Scoring saved.");
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not save scoring.");
      }
    });
  }

  function applyFilters(event: React.FormEvent) {
    event.preventDefault();
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (source) params.set("source", source);
    if (target) params.set("target", target);
    if (status) params.set("status", status);
    const qs = params.toString();
    startTransition(() => {
      router.push(qs ? `${basePath}?${qs}` : basePath);
    });
  }

  function openCreate() {
    setError("");
    setNotice("");
    setEditor(blankTerm(languages));
  }

  function openEdit(entry: TerminologyEntry) {
    setError("");
    setNotice("");
    setEditor({
      id: entry.id,
      term: entry.term,
      sourceLanguage: matchLanguage(languages, entry.sourceLanguage),
      targetLanguage: matchLanguage(languages, entry.targetLanguage),
      preferred: entry.preferredTranslation,
      forbidden: entry.forbiddenTranslations.join(", "),
      category: entry.category,
      definition: entry.definition,
      isActive: entry.isActive,
    });
  }

  function saveTerm(event: React.FormEvent) {
    event.preventDefault();
    if (!editor) return;
    setError("");
    setNotice("");
    const payload = {
      applicationId,
      term: editor.term,
      sourceLanguage: editor.sourceLanguage,
      targetLanguage: editor.targetLanguage,
      preferredTranslation: editor.preferred,
      forbiddenTranslations: editor.forbidden,
      category: editor.category,
      definition: editor.definition,
      isActive: editor.isActive,
    };
    startTransition(async () => {
      try {
        if (editor.id) {
          await updateTerminologyEntry({ ...payload, terminologyId: editor.id });
          setNotice("Word updated.");
        } else {
          await createTerminologyEntry(payload);
          setNotice("Word added.");
        }
        setEditor(null);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not save the word.");
      }
    });
  }

  function removeTerm(entry: TerminologyEntry) {
    const ok = window.confirm(
      `Delete “${entry.term}” (${languageName(languages, entry.sourceLanguage)} → ${languageName(languages, entry.targetLanguage)})? Reviews will stop checking it.`
    );
    if (!ok) return;
    setError("");
    setNotice("");
    startTransition(async () => {
      try {
        await deleteTerminologyEntry({ applicationId, terminologyId: entry.id });
        setSelected((prev) => {
          const next = new Set(prev);
          next.delete(entry.id);
          return next;
        });
        if (editor?.id === entry.id) setEditor(null);
        setNotice("Word deleted.");
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not delete the word.");
      }
    });
  }

  function removeSelected() {
    if (selectedOnPage.length === 0) return;
    const count = selectedOnPage.length;
    const ok = window.confirm(
      `Delete ${count} word${count === 1 ? "" : "s"}? Reviews will stop checking them.`
    );
    if (!ok) return;
    setError("");
    setNotice("");
    startTransition(async () => {
      try {
        await deleteTerminologyEntries({
          applicationId,
          terminologyIds: selectedOnPage,
        });
        setSelected(new Set());
        if (editor?.id && selectedOnPage.includes(editor.id)) setEditor(null);
        setNotice(count === 1 ? "Word deleted." : `${count} words deleted.`);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not delete the words.");
      }
    });
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        for (const id of pageIds) next.delete(id);
      } else {
        for (const id of pageIds) next.add(id);
      }
      return next;
    });
  }

  return (
    <div className="space-y-4">
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      {notice ? <p className="text-sm text-emerald-700">{notice}</p> : null}

      <form onSubmit={saveScoring}>
        <Card className="p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Scoring</h2>
              <p className="mt-1 max-w-2xl text-sm text-slate-500">
                Tick the checks you want, then set how much each one counts.
                The percentages are their share of the checks that are on.
                Nothing is saved until you click Save scoring.
              </p>
            </div>
            {canManage ? (
              <Button type="submit" disabled={pending || !scoringDirty}>
                Save scoring
              </Button>
            ) : null}
          </div>
          <div className="mt-4 grid gap-6 lg:grid-cols-2">
            <CategoryList
              title="Written by AI"
              drafts={drafts.filter((item) => item.categoryType === "ai")}
              enabledWeight={enabledWeight}
              disabled={!canManage || pending}
              onChange={(id, patch) =>
                setDrafts((current) =>
                  current.map((item) => (item.id === id ? { ...item, ...patch } : item))
                )
              }
            />
            <CategoryList
              title="Checked from your lists"
              drafts={drafts.filter((item) => item.categoryType === "rule")}
              enabledWeight={enabledWeight}
              disabled={!canManage || pending}
              onChange={(id, patch) =>
                setDrafts((current) =>
                  current.map((item) => (item.id === id ? { ...item, ...patch } : item))
                )
              }
            />
          </div>
          {!canManage ? (
            <p className="mt-4 text-xs text-slate-500">
              An application admin can change scoring and words.
            </p>
          ) : null}
        </Card>
      </form>

      <Card className="p-3 sm:p-4">
        <form onSubmit={applyFilters}>
          <div className="flex items-center gap-2">
            <input
              value={q}
              onChange={(event) => setQ(event.target.value)}
              placeholder="Search words…"
              className={`${inputClass} h-9 min-w-0 flex-1`}
            />
            <button
              type="button"
              className={`inline-flex h-9 shrink-0 items-center rounded-lg border px-3 text-sm font-semibold sm:hidden ${
                filtersOpen || activeFilterCount > 0
                  ? "border-[var(--hub-accent)] bg-[var(--hub-accent-soft)] text-[var(--hub-accent)]"
                  : "border-[var(--hub-border-strong)] bg-white text-slate-800"
              }`}
              aria-expanded={filtersOpen}
              onClick={() => setFiltersOpen((open) => !open)}
            >
              Filters{activeFilterCount > 0 ? ` · ${activeFilterCount}` : ""}
            </button>
            <Button type="submit" className="hidden shrink-0 sm:inline-flex" disabled={pending}>
              {pending ? "Filtering…" : "Filter"}
            </Button>
            {canManage ? (
              <Button type="button" variant="secondary" className="shrink-0" disabled={pending} onClick={openCreate}>
                Add a word
              </Button>
            ) : null}
          </div>
          <div
            className={`${filtersOpen ? "mt-3 grid" : "hidden"} grid-cols-1 gap-3 sm:mt-3 sm:flex sm:flex-wrap sm:items-end`}
          >
            <FilterSelect
              label="From"
              value={source}
              onChange={setSource}
              options={languageOptions}
              placeholder="All languages"
            />
            <FilterSelect
              label="To"
              value={target}
              onChange={setTarget}
              options={languageOptions}
              placeholder="All languages"
            />
            <FilterSelect
              label="Status"
              value={status}
              onChange={setStatus}
              options={[
                { value: "active", label: "In use" },
                { value: "inactive", label: "Not in use" },
              ]}
              placeholder="Any status"
            />
            <Button type="submit" className="w-full sm:hidden" disabled={pending}>
              {pending ? "Filtering…" : "Apply"}
            </Button>
          </div>
        </form>
      </Card>

      {editor ? (
        <TermForm
          editor={editor}
          languages={languages}
          pending={pending}
          onChange={setEditor}
          onSubmit={saveTerm}
          onCancel={() => setEditor(null)}
        />
      ) : null}

      <Card className="overflow-hidden">
        {canManage && selectedOnPage.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2 border-b border-[var(--hub-border)] px-4 py-3">
            <span className="text-sm text-[var(--hub-muted-strong)]">
              {selectedOnPage.length} selected
            </span>
            <Button type="button" variant="danger" disabled={pending} onClick={removeSelected}>
              {pending ? "Deleting…" : "Delete"}
            </Button>
            <button
              type="button"
              className="text-sm text-[var(--hub-muted)] underline-offset-2 hover:underline"
              disabled={pending}
              onClick={() => setSelected(new Set())}
            >
              Clear
            </button>
          </div>
        ) : null}
        <div className="overflow-x-auto">
          <table className="hub-table">
            <thead>
              <tr>
                {canManage ? (
                  <th className="w-10">
                    <input
                      type="checkbox"
                      aria-label="Select all words on this page"
                      checked={allSelected}
                      ref={(element) => {
                        if (element) element.indeterminate = someSelected;
                      }}
                      disabled={pageIds.length === 0 || pending}
                      onChange={toggleAll}
                    />
                  </th>
                ) : null}
                <th>Term</th>
                <th>From</th>
                <th>To</th>
                <th>Use this</th>
                <th className="hidden md:table-cell">Avoid</th>
                <th>Status</th>
                {canManage ? <th className="w-20 text-right"> </th> : null}
              </tr>
            </thead>
            <tbody>
              {terminology.length === 0 ? (
                <tr>
                  <td colSpan={canManage ? 8 : 6} className="py-12 text-center text-sm text-[var(--hub-muted)]">
                    {total === 0 && !filters.q && !filters.source && !filters.target && !filters.status
                      ? "No words yet."
                      : "No words found."}
                  </td>
                </tr>
              ) : (
                terminology.map((entry) => (
                  <tr key={entry.id} className={editor?.id === entry.id ? "bg-[var(--hub-accent-soft)]" : ""}>
                    {canManage ? (
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Select ${entry.term}`}
                          checked={selected.has(entry.id)}
                          disabled={pending}
                          onChange={() => toggleOne(entry.id)}
                        />
                      </td>
                    ) : null}
                    <td className="font-semibold text-[var(--hub-fg)]">{entry.term}</td>
                    <td>{languageName(languages, entry.sourceLanguage)}</td>
                    <td>{languageName(languages, entry.targetLanguage)}</td>
                    <td>{entry.preferredTranslation}</td>
                    <td className="hidden max-w-[16rem] truncate md:table-cell" title={entry.forbiddenTranslations.join(", ")}>
                      {entry.forbiddenTranslations.join(", ") || "—"}
                    </td>
                    <td>
                      <Badge tone={entry.isActive ? "good" : "neutral"}>
                        {entry.isActive ? "In use" : "Not in use"}
                      </Badge>
                    </td>
                    {canManage ? (
                      <td className="text-right">
                        <div className="inline-flex items-center justify-end gap-1">
                          <IconButton label={`Edit ${entry.term}`} disabled={pending} onClick={() => openEdit(entry)}>
                            <PencilIcon />
                          </IconButton>
                          <IconButton label={`Delete ${entry.term}`} danger disabled={pending} onClick={() => removeTerm(entry)}>
                            <TrashIcon />
                          </IconButton>
                        </div>
                      </td>
                    ) : null}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Pagination
        page={page}
        pageSize={pageSize}
        total={total}
        basePath={basePath}
        query={{
          q: filters.q || undefined,
          source: filters.source || undefined,
          target: filters.target || undefined,
          status: filters.status || undefined,
        }}
      />
    </div>
  );
}

function TermForm({
  editor,
  languages,
  pending,
  onChange,
  onSubmit,
  onCancel,
}: {
  editor: TermDraft;
  languages: Language[];
  pending: boolean;
  onChange: (next: TermDraft) => void;
  onSubmit: (event: React.FormEvent) => void;
  onCancel: () => void;
}) {
  const sourceOptions = editorOptions(languages, editor.sourceLanguage);
  const targetOptions = editorOptions(languages, editor.targetLanguage);

  return (
    <Card className="p-4">
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={onSubmit}>
        <div className="sm:col-span-2">
          <h2 className="text-base font-semibold text-slate-900">
            {editor.id ? "Edit word" : "Add a word"}
          </h2>
        </div>
        <Field label="Term">
          <input
            className={inputClass}
            value={editor.term}
            required
            onChange={(event) => onChange({ ...editor, term: event.target.value })}
          />
        </Field>
        <Field label="Use this wording">
          <input
            className={inputClass}
            value={editor.preferred}
            required
            onChange={(event) => onChange({ ...editor, preferred: event.target.value })}
          />
        </Field>
        <FilterSelect
          label="From"
          value={editor.sourceLanguage}
          onChange={(value) => onChange({ ...editor, sourceLanguage: value })}
          options={sourceOptions}
          placeholder="Choose a language"
          fullWidth
        />
        <FilterSelect
          label="To"
          value={editor.targetLanguage}
          onChange={(value) => onChange({ ...editor, targetLanguage: value })}
          options={targetOptions}
          placeholder="Choose a language"
          fullWidth
        />
        <Field label="Spellings to avoid">
          <input
            className={inputClass}
            value={editor.forbidden}
            placeholder="Separate with commas"
            onChange={(event) => onChange({ ...editor, forbidden: event.target.value })}
          />
        </Field>
        <Field label="Group">
          <input
            className={inputClass}
            value={editor.category}
            placeholder="brand, store, product"
            onChange={(event) => onChange({ ...editor, category: event.target.value })}
          />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Note">
            <input
              className={inputClass}
              value={editor.definition}
              onChange={(event) => onChange({ ...editor, definition: event.target.value })}
            />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700 sm:col-span-2">
          <input
            type="checkbox"
            checked={editor.isActive}
            onChange={(event) => onChange({ ...editor, isActive: event.target.checked })}
          />
          Include this word in reviews
        </label>
        <div className="flex gap-2 sm:col-span-2">
          <Button type="submit" disabled={pending || !editor.sourceLanguage || !editor.targetLanguage}>
            {editor.id ? "Save word" : "Add word"}
          </Button>
          <Button type="button" variant="secondary" disabled={pending} onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}

function CategoryList({
  title,
  drafts,
  enabledWeight,
  disabled,
  onChange,
}: {
  title: string;
  drafts: CategoryDraft[];
  enabledWeight: number;
  disabled: boolean;
  onChange: (id: string, patch: Partial<Pick<CategoryDraft, "enabled" | "weight">>) => void;
}) {
  return (
    <div>
      <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">{title}</h3>
      <ul className="mt-3 space-y-3">
        {drafts.map((category) => {
          const share =
            category.enabled && enabledWeight > 0
              ? Math.round((category.weight / enabledWeight) * 100)
              : null;
          return (
            <li key={category.id} className="flex items-start gap-3">
              <input
                type="checkbox"
                className="mt-1"
                checked={category.enabled}
                disabled={disabled}
                aria-label={`Include ${category.name}`}
                onChange={(event) => onChange(category.id, { enabled: event.target.checked })}
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium text-slate-900">{category.name}</span>
                  <label className="flex items-center gap-2 text-xs text-slate-500">
                    Share
                    <input
                      type="number"
                      min={1}
                      max={100}
                      step={1}
                      disabled={disabled}
                      aria-label={`${category.name} share`}
                      className="h-8 w-16 rounded-lg border border-[var(--hub-border-strong)] bg-white px-2 text-sm text-slate-900"
                      value={Number.isFinite(category.weight) ? category.weight : ""}
                      onChange={(event) =>
                        onChange(category.id, { weight: Number(event.target.value) })
                      }
                    />
                    <span className="w-10 tabular-nums">{share === null ? "—" : `${share}%`}</span>
                  </label>
                </div>
                <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{category.description}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function toDraft(category: QualityCategoryConfig): CategoryDraft {
  return {
    id: category.id,
    name: category.name,
    description: category.description,
    categoryType: category.categoryType,
    enabled: category.enabled,
    weight: category.weight,
  };
}

function languageOptionLabel(language: Language) {
  return `${language.name} (${language.code.toUpperCase()})`;
}

function matchLanguage(languages: Language[], code: string) {
  return (
    languages.find((language) => language.code.toLowerCase() === code.toLowerCase())?.code ??
    code
  );
}

function languageName(languages: Language[], code: string) {
  const match = languages.find(
    (language) => language.code.toLowerCase() === code.toLowerCase()
  );
  return match ? languageOptionLabel(match) : code.toUpperCase();
}

function editorOptions(languages: Language[], current: string): FilterOption[] {
  const options = languages.map((language) => ({
    value: language.code,
    label: languageOptionLabel(language),
  }));
  if (
    current &&
    !options.some((option) => option.value.toLowerCase() === current.toLowerCase())
  ) {
    options.unshift({ value: current, label: current.toUpperCase() });
  }
  return options;
}

function catalogCode(languages: Language[], code: string) {
  return (
    languages.find((language) => language.code.toLowerCase() === code.toLowerCase())?.code ??
    ""
  );
}

function blankTerm(languages: Language[]): TermDraft {
  const source = catalogCode(languages, "en") || languages[0]?.code || "";
  const malay = catalogCode(languages, "ms");
  const other = languages.find(
    (language) => language.code.toLowerCase() !== source.toLowerCase()
  )?.code;
  return {
    id: null,
    term: "",
    sourceLanguage: source,
    targetLanguage: malay && malay.toLowerCase() !== source.toLowerCase() ? malay : other || "",
    preferred: "",
    forbidden: "",
    category: "",
    definition: "",
    isActive: true,
  };
}
