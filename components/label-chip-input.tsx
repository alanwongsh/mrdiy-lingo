"use client";

import { useId, useState } from "react";

export type LabelChip = { key: string; label: string };

/**
 * Picks labels as chips. Typing filters the known labels; Enter adds the highlighted one, or the
 * typed text as a new label when nothing matches it exactly.
 */
export function LabelChipInput({
  chips,
  suggestions,
  onAdd,
  onRemove,
  disabled = false,
  placeholder = "Add a field",
  ariaLabel,
}: {
  chips: LabelChip[];
  /** Known labels. Ones already chosen are left out of the menu. */
  suggestions: string[];
  onAdd: (label: string) => void;
  /** Leave out to show the chips without a remove button. */
  onRemove?: (chip: LabelChip) => void;
  disabled?: boolean;
  placeholder?: string;
  ariaLabel?: string;
}) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const listId = useId();

  const taken = new Set(chips.map((chip) => chip.label.trim().toLowerCase()));
  const typed = text.trim().replace(/\s+/g, " ");
  const term = typed.toLowerCase();
  const matches = suggestions
    .filter((label) => !taken.has(label.toLowerCase()))
    .filter((label) => !term || label.toLowerCase().includes(term))
    .slice(0, 8);
  const exact = suggestions.some((label) => label.toLowerCase() === term);
  const options = [
    ...matches.map((label) => ({ label, create: false })),
    ...(term && !exact && !taken.has(term) ? [{ label: typed, create: true }] : []),
  ];
  const active = Math.min(highlight, options.length - 1);

  function add(label: string) {
    const clean = label.trim().replace(/\s+/g, " ");
    setText("");
    setHighlight(0);
    if (!clean || taken.has(clean.toLowerCase())) return;
    // Reuse the known spelling when the typed text differs only in case.
    onAdd(suggestions.find((s) => s.toLowerCase() === clean.toLowerCase()) ?? clean);
  }

  return (
    <div className="relative">
      <div
        className={`flex min-h-9 flex-wrap items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2 py-1 shadow-sm focus-within:border-[var(--hub-accent)] ${
          disabled ? "opacity-60" : ""
        }`}
      >
        {chips.map((chip) => (
          <span
            key={chip.key}
            className="inline-flex items-center gap-1 rounded-full border border-[var(--hub-border-strong)] bg-[var(--diy-yellow-soft)] py-0.5 pr-1 pl-2.5 text-sm font-medium text-slate-800"
          >
            {chip.label}
            {onRemove ? (
              <button
                type="button"
                disabled={disabled}
                aria-label={`Remove ${chip.label}`}
                className="inline-flex h-5 w-5 items-center justify-center rounded-full text-slate-500 hover:bg-white hover:text-[var(--diy-red)]"
                onClick={() => onRemove(chip)}
              >
                ×
              </button>
            ) : null}
          </span>
        ))}
        <input
          className="h-7 min-w-[10rem] flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400"
          value={text}
          disabled={disabled}
          placeholder={chips.length === 0 ? placeholder : "Add another"}
          aria-label={ariaLabel ?? placeholder}
          role="combobox"
          aria-expanded={open && options.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onChange={(e) => {
            setText(e.target.value);
            setHighlight(0);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              // Never submit the surrounding form from here.
              e.preventDefault();
              if (open && options[active]) add(options[active].label);
              else add(text);
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
              setHighlight((h) => Math.min(h + 1, options.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setHighlight((h) => Math.max(h - 1, 0));
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
        />
      </div>
      {open && !disabled && options.length > 0 ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute left-0 z-20 mt-1 max-h-60 w-full space-y-0.5 overflow-auto rounded-lg border border-slate-200 bg-white p-2 shadow-lg sm:w-[min(20rem,90vw)]"
        >
          {options.map((option, index) => (
            <li key={`${option.create ? "new" : "known"}:${option.label}`}>
              <button
                type="button"
                role="option"
                aria-selected={index === active}
                // Keep focus in the input so the menu does not close before the click lands.
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setHighlight(index)}
                onClick={() => add(option.label)}
                className={`flex w-full rounded-md px-2 py-1.5 text-left text-sm ${
                  index === active
                    ? "bg-[var(--diy-red)] font-semibold text-white"
                    : "text-slate-700 hover:bg-[var(--diy-yellow-soft)] hover:text-slate-900"
                }`}
              >
                <span className="truncate">
                  {option.create ? `Create “${option.label}”` : option.label}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
