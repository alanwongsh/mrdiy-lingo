"use client";

import { FilterSelect } from "@/components/filter-select";
import { effectiveToneCode } from "@/lib/tones";
import type { ContentTypeRecord, ToneProfile } from "@/lib/types";

/** The article's tone. Empty follows the article type's default. */
export function ToneSelect({
  tones,
  value,
  onChange,
  contentType,
  disabled = false,
}: {
  tones: ToneProfile[];
  value: string;
  onChange: (value: string) => void;
  contentType: ContentTypeRecord | undefined;
  disabled?: boolean;
}) {
  const typeDefault = tones.find((tone) => tone.code === contentType?.default_tone);
  const effective = tones.find(
    (tone) => tone.code === effectiveToneCode(value, contentType) && tone.status === "ACTIVE"
  );
  return (
    <div className="space-y-1.5">
      <FilterSelect
        fullWidth
        label="Tone"
        value={value}
        disabled={disabled}
        onChange={onChange}
        options={tones
          .filter((tone) => tone.status === "ACTIVE" || tone.code === value)
          .map((tone) => ({
            value: tone.code,
            label: tone.status === "ACTIVE" ? tone.name : `${tone.name} (inactive)`,
            title: tone.instructions || undefined,
          }))}
        placeholder={
          typeDefault && typeDefault.status === "ACTIVE"
            ? `Type default (${typeDefault.name})`
            : "Type default (none)"
        }
      />
      {effective?.allow_adaptation ? (
        <p className="text-xs text-[var(--hub-muted)]">
          Machine translation may reword this article. Reviewers see it marked Adapted.
        </p>
      ) : null}
    </div>
  );
}
