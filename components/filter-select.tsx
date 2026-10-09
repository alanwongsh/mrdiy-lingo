"use client";

import { useEffect, useId, useRef, useState } from "react";
import { IconButton, PencilIcon } from "@/components/icon-button";

const triggerClass =
  "inline-flex h-9 w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-800 shadow-sm hover:border-slate-400 sm:w-auto sm:min-w-[11rem] sm:max-w-[16rem]";

const menuClass =
  "absolute left-0 z-20 mt-1 w-full rounded-lg border border-slate-200 bg-white p-2 shadow-lg sm:w-[min(18rem,90vw)]";

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

function FilterLabel({ id, label }: { id: string; label?: string }) {
  if (!label) return null;
  return (
    <label
      htmlFor={id}
      className="mb-1.5 block text-xs font-semibold tracking-wide text-[var(--hub-muted-strong)]"
    >
      {label}
    </label>
  );
}

export function FilterSelect({
  label,
  value,
  onChange,
  options,
  placeholder,
  onEditOption,
  footer,
  fullWidth = false,
  hideEmptyOption = false,
  disabled = false,
  ariaLabel,
}: {
  label?: string;
  /** Accessible name when there is no visible label. */
  ariaLabel?: string;
  disabled?: boolean;
  value: string;
  onChange: (value: string) => void;
  options: FilterOption[];
  placeholder: string;
  onEditOption?: (option: FilterOption) => void;
  footer?: React.ReactNode;
  /** Stretch to the parent width. The filter bar keeps the compact width. */
  fullWidth?: boolean;
  /** Leave the placeholder out of the menu so one of the options must be picked. */
  hideEmptyOption?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useMenuDismiss(open, setOpen);
  const listId = useId();
  const buttonId = useId();
  const selected = options.find((o) => o.value === value);
  const summary = selected?.label ?? placeholder;

  return (
    <div
      className={fullWidth ? "relative w-full" : "relative w-full sm:w-auto"}
      ref={rootRef}
    >
      <FilterLabel id={buttonId} label={label} />
      <button
        id={buttonId}
        type="button"
        aria-label={label ? undefined : ariaLabel}
        aria-expanded={open}
        aria-controls={listId}
        disabled={disabled}
        className={`${
          fullWidth
            ? "inline-flex h-9 w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-800 shadow-sm hover:border-slate-400"
            : triggerClass
        } disabled:cursor-not-allowed disabled:opacity-60`}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={`truncate ${value ? "" : "text-slate-500"}`}>
          {summary}
        </span>
        <span className="text-slate-400" aria-hidden>
          ▾
        </span>
      </button>
      {open && !disabled ? (
        <div
          id={listId}
          className={
            fullWidth
              ? "absolute left-0 z-20 mt-1 w-full rounded-lg border border-slate-200 bg-white p-2 shadow-lg"
              : menuClass
          }
          role="listbox"
        >
          <ul className="max-h-60 space-y-0.5 overflow-auto">
            {hideEmptyOption ? null : (
              <li>
                <button
                  type="button"
                  role="option"
                  aria-selected={!value}
                  className={`flex w-full rounded-md px-2 py-1.5 text-left text-sm ${
                    !value
                      ? "bg-[var(--diy-red)] font-semibold text-white"
                      : "text-slate-700 hover:bg-[var(--diy-yellow-soft)] hover:text-slate-900"
                  }`}
                  onClick={() => {
                    onChange("");
                    setOpen(false);
                  }}
                >
                  {placeholder}
                </button>
              </li>
            )}
            {options.map((o) => {
              const active = o.value === value;
              return (
                <li key={o.value} className="flex items-center gap-1">
                  <button
                    type="button"
                    role="option"
                    aria-selected={active}
                    className={`flex min-w-0 flex-1 rounded-md px-2 py-1.5 text-left text-sm ${
                      active
                        ? "bg-[var(--diy-red)] font-semibold text-white"
                        : "text-slate-700 hover:bg-[var(--diy-yellow-soft)] hover:text-slate-900"
                    }`}
                    onClick={() => {
                      onChange(o.value);
                      setOpen(false);
                    }}
                  >
                    <span className="truncate">{o.label}</span>
                  </button>
                  {onEditOption ? (
                    <IconButton
                      label={`Edit ${o.label}`}
                      onClick={() => {
                        onEditOption(o);
                        setOpen(false);
                      }}
                    >
                      <PencilIcon />
                    </IconButton>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {footer ? (
            <div
              className="mt-2 border-t border-slate-200 pt-2"
              onClick={() => setOpen(false)}
            >
              {footer}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function FilterMultiSelect({
  label,
  value,
  onChange,
  options,
  placeholder,
}: {
  label?: string;
  value: string[];
  onChange: (value: string[]) => void;
  options: FilterOption[];
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useMenuDismiss(open, setOpen);
  const listId = useId();
  const buttonId = useId();

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
    <div className="relative w-full sm:w-auto" ref={rootRef}>
      <FilterLabel id={buttonId} label={label} />
      <button
        id={buttonId}
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
                  <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-[var(--diy-yellow-soft)]">
                    <input
                      type="checkbox"
                      className="accent-[var(--diy-red)]"
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
