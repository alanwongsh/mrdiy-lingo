"use client";

import { useEffect, useId, useRef, useState } from "react";

const triggerClass =
  "inline-flex h-9 min-w-[11rem] max-w-[16rem] items-center justify-between gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-800 shadow-sm hover:border-slate-400";

const menuClass =
  "absolute left-0 z-20 mt-1 w-[min(18rem,90vw)] rounded-lg border border-slate-200 bg-white p-2 shadow-lg";

export type FilterOption = {
  value: string;
  label: string;
};

function useMenuDismiss(open: boolean, setOpen: (v: boolean) => void) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
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
  }, [open, setOpen]);

  return rootRef;
}

export function FilterSelect({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  options: FilterOption[];
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useMenuDismiss(open, setOpen);
  const listId = useId();
  const selected = options.find((o) => o.value === value);
  const summary = selected?.label ?? placeholder;

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        className={triggerClass}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={`truncate ${value ? "" : "text-slate-500"}`}>
          {summary}
        </span>
        <span className="text-slate-400" aria-hidden>
          ▾
        </span>
      </button>
      {open ? (
        <div id={listId} className={menuClass} role="listbox">
          <ul className="max-h-60 space-y-0.5 overflow-auto">
            <li>
              <button
                type="button"
                role="option"
                aria-selected={!value}
                className={`flex w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-slate-50 ${
                  !value ? "bg-slate-50 font-semibold text-slate-900" : "text-slate-700"
                }`}
                onClick={() => {
                  onChange("");
                  setOpen(false);
                }}
              >
                {placeholder}
              </button>
            </li>
            {options.map((o) => {
              const active = o.value === value;
              return (
                <li key={o.value}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={active}
                    className={`flex w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-slate-50 ${
                      active
                        ? "bg-slate-50 font-semibold text-slate-900"
                        : "text-slate-700"
                    }`}
                    onClick={() => {
                      onChange(o.value);
                      setOpen(false);
                    }}
                  >
                    {o.label}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export function FilterMultiSelect({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string[];
  onChange: (value: string[]) => void;
  options: FilterOption[];
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useMenuDismiss(open, setOpen);
  const listId = useId();

  function toggle(code: string) {
    if (value.includes(code)) {
      onChange(value.filter((c) => c !== code));
    } else {
      onChange([...value, code]);
    }
  }

  const summary =
    value.length === 0
      ? placeholder
      : value.length === 1
        ? options.find((o) => o.value === value[0])?.label ?? "1 selected"
        : `${value.length} selected`;

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        className={triggerClass}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={`truncate ${value.length ? "" : "text-slate-500"}`}>
          {summary}
        </span>
        <span className="text-slate-400" aria-hidden>
          ▾
        </span>
      </button>
      {open ? (
        <div id={listId} className={menuClass}>
          <div className="mb-1 flex items-center justify-between gap-2 px-1 pb-1">
            <button
              type="button"
              className="hub-text-button text-xs"
              onClick={() => onChange(options.map((o) => o.value))}
            >
              Select all
            </button>
            <button
              type="button"
              className="text-xs font-semibold text-slate-500 hover:underline"
              onClick={() => onChange([])}
            >
              Clear
            </button>
          </div>
          <ul className="max-h-60 space-y-0.5 overflow-auto">
            {options.map((o) => {
              const checked = value.includes(o.value);
              return (
                <li key={o.value}>
                  <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-slate-50">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(o.value)}
                    />
                    <span className="flex-1 font-medium text-slate-900">
                      {o.label}
                    </span>
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
