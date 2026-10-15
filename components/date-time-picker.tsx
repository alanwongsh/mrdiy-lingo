"use client";

import { useEffect, useId, useRef, useState } from "react";
import { FilterSelect } from "@/components/filter-select";

/**
 * Date and time picker in the app's own style, in place of the browser's
 * datetime-local popup, which cannot follow the theme.
 * The value uses the datetime-local format, "YYYY-MM-DDTHH:mm" in local time, or "".
 */

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const MINUTE_STEP = 5;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function parse(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!match) return null;
  const [, y, m, d, h, min] = match.map(Number);
  return new Date(y, m - 1, d, h, min);
}

function format(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

function sameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Six weeks starting on the Monday on or before the 1st of the month. */
function monthGrid(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, index) => new Date(year, month, 1 - offset + index));
}

function hourLabel(hour: number) {
  const suffix = hour < 12 ? "AM" : "PM";
  return `${hour % 12 === 0 ? 12 : hour % 12} ${suffix}`;
}

export function DateTimePicker({
  value,
  onChange,
  name,
  placeholder = "Pick a date and time",
  ariaLabel,
  compact = false,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  /** Also posts the value with a surrounding form under this name. */
  name?: string;
  placeholder?: string;
  ariaLabel?: string;
  /** Smaller trigger for tight rows. */
  compact?: boolean;
  disabled?: boolean;
}) {
  const selected = parse(value);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => {
    const base = selected ?? new Date();
    return { year: base.getFullYear(), month: base.getMonth() };
  });
  const rootRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    function onDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function toggle() {
    if (!open) {
      const base = selected ?? new Date();
      setView({ year: base.getFullYear(), month: base.getMonth() });
    }
    setOpen((current) => !current);
  }

  function pickDay(day: Date) {
    const time = selected ?? new Date(0, 0, 1, 9, 0);
    onChange(
      format(new Date(day.getFullYear(), day.getMonth(), day.getDate(), time.getHours(), time.getMinutes()))
    );
    if (day.getMonth() !== view.month) setView({ year: day.getFullYear(), month: day.getMonth() });
  }

  function setTime(hours: number, minutes: number) {
    const base = selected ?? new Date();
    onChange(format(new Date(base.getFullYear(), base.getMonth(), base.getDate(), hours, minutes)));
  }

  function moveMonth(step: number) {
    setView((current) => {
      const next = new Date(current.year, current.month + step, 1);
      return { year: next.getFullYear(), month: next.getMonth() };
    });
  }

  const today = new Date();
  const minutes = Array.from({ length: 60 / MINUTE_STEP }, (_, index) => index * MINUTE_STEP);
  if (selected && !minutes.includes(selected.getMinutes())) {
    minutes.push(selected.getMinutes());
    minutes.sort((a, b) => a - b);
  }
  // Formatted by hand so the server and the browser render the same text.
  const label = selected
    ? `${selected.getDate()} ${MONTHS[selected.getMonth()]} ${selected.getFullYear()}, ${
        selected.getHours() % 12 === 0 ? 12 : selected.getHours() % 12
      }:${pad(selected.getMinutes())} ${selected.getHours() < 12 ? "AM" : "PM"}`
    : placeholder;

  return (
    <div ref={rootRef} className={`relative ${compact ? "inline-block" : "w-full"}`}>
      {name ? <input type="hidden" name={name} value={value} /> : null}
      <button
        type="button"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={panelId}
        disabled={disabled}
        onClick={toggle}
        className={`inline-flex w-full items-center justify-between gap-2 rounded-lg border border-[var(--hub-border-strong)] bg-white px-3 text-left text-[var(--hub-fg)] hover:border-slate-400 focus:border-[var(--hub-accent)] focus:ring-2 focus:ring-[var(--hub-accent-ring)] focus:outline-none disabled:cursor-not-allowed disabled:opacity-60 ${
          compact ? "h-8 text-xs" : "h-9 text-sm"
        }`}
      >
        <span className={`truncate ${selected ? "" : "text-slate-400"}`}>{label}</span>
        <svg aria-hidden viewBox="0 0 20 20" className="h-4 w-4 shrink-0 text-[var(--hub-accent)]">
          <rect x="3" y="4.5" width="14" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <path d="M3 8.5h14M7 3v3M13 3v3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>

      {open ? (
        <div
          id={panelId}
          role="dialog"
          aria-label="Choose date and time"
          className="absolute left-0 z-30 mt-1 w-72 rounded-xl border border-[var(--hub-border)] bg-[var(--hub-panel)] p-3 shadow-lg"
        >
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              className="rounded-md px-2 py-1 text-[var(--hub-accent)] hover:bg-[var(--diy-yellow-soft)]"
              aria-label="Previous month"
              onClick={() => moveMonth(-1)}
            >
              ‹
            </button>
            <span className="text-sm font-semibold text-slate-900">
              {new Date(view.year, view.month, 1).toLocaleString(undefined, {
                month: "long",
                year: "numeric",
              })}
            </span>
            <button
              type="button"
              className="rounded-md px-2 py-1 text-[var(--hub-accent)] hover:bg-[var(--diy-yellow-soft)]"
              aria-label="Next month"
              onClick={() => moveMonth(1)}
            >
              ›
            </button>
          </div>

          <div className="grid grid-cols-7 gap-0.5 text-center">
            {WEEKDAYS.map((day) => (
              <div key={day} className="py-1 text-[11px] font-semibold text-[var(--hub-muted)] uppercase">
                {day}
              </div>
            ))}
            {monthGrid(view.year, view.month).map((day) => {
              const isSelected = !!selected && sameDay(day, selected);
              const isToday = sameDay(day, today);
              const outside = day.getMonth() !== view.month;
              return (
                <button
                  key={day.toISOString()}
                  type="button"
                  onClick={() => pickDay(day)}
                  aria-pressed={isSelected}
                  className={`h-8 rounded-md text-sm transition ${
                    isSelected
                      ? "bg-[var(--hub-accent-fill)] font-semibold text-[var(--hub-on-accent)]"
                      : isToday
                        ? "font-semibold text-[var(--hub-accent)] ring-1 ring-[var(--hub-accent)] ring-inset hover:bg-[var(--diy-yellow-soft)]"
                        : outside
                          ? "text-slate-300 hover:bg-[var(--diy-yellow-soft)]"
                          : "text-slate-800 hover:bg-[var(--diy-yellow-soft)]"
                  }`}
                >
                  {day.getDate()}
                </button>
              );
            })}
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 border-t border-[var(--hub-border)] pt-3">
            <FilterSelect
              label="Hour"
              fullWidth
              hideEmptyOption
              placeholder="Hour"
              value={selected ? String(selected.getHours()) : ""}
              options={HOURS.map((hour) => ({ value: String(hour), label: hourLabel(hour) }))}
              onChange={(hour) => setTime(Number(hour), selected?.getMinutes() ?? 0)}
            />
            <FilterSelect
              label="Minute"
              fullWidth
              hideEmptyOption
              placeholder="Minute"
              value={selected ? String(selected.getMinutes()) : ""}
              options={minutes.map((minute) => ({ value: String(minute), label: pad(minute) }))}
              onChange={(minute) => setTime(selected?.getHours() ?? 9, Number(minute))}
            />
          </div>

          <div className="mt-3 flex items-center justify-between">
            <button
              type="button"
              className="text-sm font-semibold text-[var(--hub-muted)] hover:text-[var(--hub-fg)]"
              onClick={() => {
                onChange("");
                setOpen(false);
              }}
            >
              Clear
            </button>
            <div className="flex gap-3">
              <button
                type="button"
                className="text-sm font-semibold text-[var(--hub-accent)] hover:underline"
                onClick={() => {
                  const now = new Date();
                  now.setSeconds(0, 0);
                  onChange(format(now));
                  setView({ year: now.getFullYear(), month: now.getMonth() });
                }}
              >
                Now
              </button>
              <button
                type="button"
                className="rounded-md bg-[var(--hub-accent-fill)] px-3 py-1 text-sm font-semibold text-[var(--hub-on-accent)] hover:bg-[var(--hub-accent-fill-hover)]"
                onClick={() => setOpen(false)}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
