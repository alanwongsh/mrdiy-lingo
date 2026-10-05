"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { Language, TranslationStatus } from "@/lib/types";
import { Badge, Button, inputClass, statusTone } from "@/components/ui";

export type LanguageOptionStatus = {
  code: string;
  status: TranslationStatus;
};

export function LanguageMultiSelect({
  sourceLabel,
  options,
  statuses,
  selected,
  activeCode,
  onSelectedChange,
  onActiveChange,
  translateAction,
  editingAction,
  showEditingSwitcher = true,
  label = "Translate to",
}: {
  sourceLabel?: string;
  options: Language[];
  statuses?: LanguageOptionStatus[];
  selected: string[];
  activeCode?: string;
  onSelectedChange: (codes: string[]) => void;
  onActiveChange?: (code: string) => void;
  translateAction?: React.ReactNode;
  editingAction?: React.ReactNode;
  showEditingSwitcher?: boolean;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const editingId = useId();

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  function statusFor(code: string): TranslationStatus | null {
    return statuses?.find((s) => s.code === code)?.status ?? null;
  }

  function toggle(code: string) {
    if (selected.includes(code)) {
      onSelectedChange(selected.filter((c) => c !== code));
    } else {
      onSelectedChange([...selected, code]);
    }
  }

  function selectAll() {
    onSelectedChange(options.map((o) => o.code));
  }

  function clearAll() {
    onSelectedChange([]);
  }

  const summary =
    selected.length === 0
      ? "Select languages…"
      : selected.length === 1
        ? options.find((o) => o.code === selected[0])?.name ?? "1 language"
        : `${selected.length} languages selected`;

  const activeStatus = activeCode ? statusFor(activeCode) : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
            {label}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {sourceLabel ? (
              <>
                <span className="rounded-md bg-slate-100 px-2.5 py-1.5 text-sm font-semibold text-slate-800">
                  {sourceLabel}
                </span>
                <span className="text-slate-400">→</span>
              </>
            ) : null}
            <div className="relative" ref={rootRef}>
              <button
                type="button"
                aria-expanded={open}
                aria-controls={listId}
                className="inline-flex h-9 min-w-[14rem] items-center justify-between gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-800 shadow-sm hover:border-slate-400"
                onClick={() => setOpen((v) => !v)}
              >
                <span className="truncate">{summary}</span>
                <span className="text-slate-400" aria-hidden>
                  ▾
                </span>
              </button>
              {open ? (
                <div
                  id={listId}
                  className="absolute left-0 z-20 mt-1 w-[min(20rem,90vw)] rounded-lg border border-slate-200 bg-white p-2 shadow-lg"
                >
                  <div className="mb-1 flex items-center justify-between gap-2 px-1 pb-1">
                    <button
                      type="button"
                      className="text-xs font-semibold text-[var(--diy-red)] hover:underline"
                      onClick={selectAll}
                    >
                      Select all
                    </button>
                    <button
                      type="button"
                      className="text-xs font-semibold text-slate-500 hover:underline"
                      onClick={clearAll}
                    >
                      Clear
                    </button>
                  </div>
                  <ul className="max-h-60 space-y-0.5 overflow-auto">
                    {options.map((l) => {
                      const checked = selected.includes(l.code);
                      const status = statusFor(l.code);
                      return (
                        <li key={l.id}>
                          <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-slate-50">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggle(l.code)}
                            />
                            <span className="flex-1 font-medium text-slate-900">
                              {l.name}
                            </span>
                            {status ? (
                              <Badge tone={statusTone(status)}>{status}</Badge>
                            ) : null}
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : null}
            </div>
          </div>
        </div>
        {translateAction}
      </div>

      {selected.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {selected.map((code) => {
            const lang = options.find((o) => o.code === code);
            const status = statusFor(code);
            return (
              <span
                key={code}
                className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-sm text-slate-700"
              >
                <span className="font-medium">{lang?.name ?? code}</span>
                {status ? (
                  <Badge tone={statusTone(status)}>{status}</Badge>
                ) : null}
                <button
                  type="button"
                  className="ml-0.5 rounded-full px-1 text-slate-400 hover:bg-white hover:text-slate-700"
                  aria-label={`Remove ${lang?.name ?? code}`}
                  onClick={() => toggle(code)}
                >
                  ×
                </button>
              </span>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-slate-500">
          Choose one or more languages.
        </p>
      )}

      {showEditingSwitcher && activeCode && onActiveChange ? (
        <div className="space-y-1.5 border-t border-slate-100 pt-3">
          <label
            htmlFor={editingId}
            className="text-xs font-semibold tracking-wide text-slate-500 uppercase"
          >
            Editing language
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <select
              id={editingId}
              className={`${inputClass} w-auto! min-w-48 shrink`}
              value={activeCode}
              onChange={(e) => onActiveChange(e.target.value)}
            >
              {options.map((l) => (
                <option key={l.id} value={l.code}>
                  {l.name}
                </option>
              ))}
            </select>
            {activeStatus ? (
              <Badge tone={statusTone(activeStatus)}>{activeStatus}</Badge>
            ) : null}
            {editingAction}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function BatchTranslateButton({
  count,
  disabled,
  loading,
  label,
  onClick,
}: {
  count: number;
  disabled?: boolean;
  loading?: boolean;
  label?: string;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      disabled={disabled || loading || count === 0}
      onClick={onClick}
      className="shrink-0"
    >
      {loading
        ? "Translating…"
        : count > 1
          ? `Auto-translate ${count} languages`
          : "Auto-translate"}
      {label && loading ? ` (${label})` : null}
    </Button>
  );
}
