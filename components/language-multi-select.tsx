"use client";

import type { Language, TranslationStatus } from "@/lib/types";
import { languageKey } from "@/lib/target-languages";
import { Badge, Button, statusTone } from "@/components/ui";
import { FilterMultiSelect, FilterSelect } from "@/components/filter-select";

function sameCode(a: string, b: string) {
  return languageKey(a) === languageKey(b);
}

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
  function optionFor(code: string) {
    return options.find((option) => sameCode(option.code, code));
  }

  function statusFor(code: string): TranslationStatus | null {
    return statuses?.find((status) => sameCode(status.code, code))?.status ?? null;
  }

  function toggle(code: string) {
    if (selected.some((item) => sameCode(item, code))) {
      onSelectedChange(selected.filter((item) => !sameCode(item, code)));
    } else {
      onSelectedChange([...selected, code]);
    }
  }

  // The menu lists option codes; stored codes may differ in case (zh-hans vs zh-Hans).
  const selectedOptionCodes = options
    .filter((o) => selected.some((code) => sameCode(code, o.code)))
    .map((o) => o.code);

  function setOptionCodes(codes: string[]) {
    // Keep the existing order and any selected code the menu does not list.
    const kept = selected.filter(
      (code) =>
        !options.some((o) => sameCode(o.code, code)) ||
        codes.some((c) => sameCode(c, code))
    );
    const added = codes.filter((c) => !kept.some((code) => sameCode(code, c)));
    onSelectedChange([...kept, ...added]);
  }

  const editingChoices = selected.map((code) => {
    const match = optionFor(code);
    return {
      id: match?.id ?? code,
      code: match?.code ?? code,
      name: match?.name ?? code,
    };
  });
  const activeChoice =
    editingChoices.find((choice) => activeCode && sameCode(choice.code, activeCode)) ??
    null;
  const activeStatus = activeChoice ? statusFor(activeChoice.code) : null;

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
            <FilterMultiSelect
              value={selectedOptionCodes}
              onChange={setOptionCodes}
              options={options.map((l) => {
                const status = statusFor(l.code);
                return {
                  value: l.code,
                  label: l.name,
                  badge: status ? (
                    <Badge tone={statusTone(status)}>{status}</Badge>
                  ) : undefined,
                };
              })}
              placeholder="Select languages…"
            />
          </div>
        </div>
        {translateAction}
      </div>

      {selected.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {selected.map((code) => {
            const lang = optionFor(code);
            const status = statusFor(code);
            return (
              <span
                key={code}
                className="inline-flex items-center gap-1.5 rounded-full border border-[var(--hub-sidebar-active-border)] bg-[var(--diy-yellow-soft)] px-2.5 py-1 text-sm text-bold"
              >
                <span className="font-medium">{lang?.name ?? code}</span>
                {status ? (
                  <Badge tone={statusTone(status)}>{status}</Badge>
                ) : null}
                <button
                  type="button"
                  className="ml-0.5 rounded-full px-1 text-[var(--hub-accent)] hover:bg-[var(--hub-accent-soft)]"
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

      {showEditingSwitcher && activeChoice && onActiveChange ? (
        <div className="space-y-1.5 border-t border-slate-100 pt-3">
          <div className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
            Editing language
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <FilterSelect
              ariaLabel="Editing language"
              value={activeChoice.code}
              onChange={onActiveChange}
              options={editingChoices.map((choice) => ({
                value: choice.code,
                label: choice.name,
              }))}
              placeholder="Select language"
              hideEmptyOption
            />
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
