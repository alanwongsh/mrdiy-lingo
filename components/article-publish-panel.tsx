import Link from "next/link";
import type { ContentPublication, PublishLanguageTarget, PublishVendorChoice } from "@/lib/types";
import { languageKey } from "@/lib/target-languages";
import { Badge } from "@/components/ui";

function hostLabel(url: string | null) {
  if (!url) return "";
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function languageLabel(languages: { code: string; name: string }[], code: string) {
  const key = languageKey(code);
  return languages.find((language) => languageKey(language.code) === key)?.name ?? code;
}

function pairKey(languageCode: string, vendorId: string) {
  return `${languageKey(languageCode)}:${vendorId}`;
}

export function PublishLanguagePicker({
  applicationId,
  languages,
  sourceLanguage,
  languageCodes,
  vendors,
  selected,
  publications = [],
  ready,
  notice,
  readOnly = false,
  onChange,
}: {
  applicationId: string;
  languages: { code: string; name: string }[];
  sourceLanguage: string;
  languageCodes: string[];
  vendors: PublishVendorChoice[];
  selected: PublishLanguageTarget[];
  publications?: ContentPublication[];
  ready: boolean;
  notice?: string;
  readOnly?: boolean;
  onChange: (targets: PublishLanguageTarget[]) => void;
}) {
  if (!ready) {
    return <p className="text-sm text-red-700">{notice}</p>;
  }
  const codes = uniqueLanguages(sourceLanguage, [
    ...languageCodes,
    ...publications.map((item) => item.language_code),
    ...selected.map((item) => item.language_code),
  ]);
  const choices = vendors.filter(
    (vendor) =>
      vendor.status === "ACTIVE" ||
      selected.some((row) => row.vendor_id === vendor.id) ||
      publications.some((row) => row.vendor_id === vendor.id)
  );
  if (readOnly && selected.length === 0 && publications.length === 0) return null;

  function publicationFor(languageCode: string, vendorId: string) {
    const key = pairKey(languageCode, vendorId);
    return publications.find((row) => pairKey(row.language_code, row.vendor_id) === key);
  }

  function toggle(languageCode: string, vendorId: string) {
    if (readOnly || publicationFor(languageCode, vendorId)?.status === "PUBLISHED") return;
    const key = pairKey(languageCode, vendorId);
    const on = selected.some((row) => pairKey(row.language_code, row.vendor_id) === key);
    onChange(
      on
        ? selected.filter((row) => pairKey(row.language_code, row.vendor_id) !== key)
        : [...selected, { language_code: languageCode, vendor_id: vendorId }]
    );
  }

  return (
    <fieldset className="space-y-1.5">
      <legend className="text-xs font-semibold tracking-wide text-[var(--hub-muted-strong)]">
        Publisher
      </legend>
      {choices.length === 0 ? (
        <p className="text-sm text-[var(--hub-muted)]">
          No providers yet. Add one under{" "}
          <Link
            className="font-semibold text-[var(--hub-accent)] underline-offset-2 hover:underline"
            href={`/applications/${applicationId}/settings/publish`}
          >
            Settings → Publish
          </Link>
          .
        </p>
      ) : (
        <ul className="space-y-2 rounded-lg border border-[var(--hub-border-strong)] bg-white p-2">
          {codes.map((code) => (
            <li key={code} className="rounded-md px-2 py-1.5">
              <div className="text-sm font-medium text-slate-900">
                {languageLabel(languages, code)}
                {languageKey(code) === languageKey(sourceLanguage) ? (
                  <span className="ml-2 text-xs font-normal text-[var(--hub-muted)]">Source</span>
                ) : null}
              </div>
              <ul className="mt-1 space-y-1">
                {choices.map((vendor) => {
                  const publication = publicationFor(code, vendor.id);
                  const published = publication?.status === "PUBLISHED";
                  const checked =
                    published ||
                    selected.some(
                      (row) => pairKey(row.language_code, row.vendor_id) === pairKey(code, vendor.id)
                    );
                  const locked = readOnly || published;
                  const host = hostLabel(publication?.external_url ?? null);
                  return (
                    <li key={vendor.id} className="flex flex-wrap items-center gap-2 text-sm text-slate-800">
                      <label className={`flex items-center gap-2 ${locked ? "" : "cursor-pointer"}`}>
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={locked}
                          onChange={() => toggle(code, vendor.id)}
                        />
                        <span>{vendor.name}</span>
                      </label>
                      {vendor.status === "INACTIVE" ? (
                        <span className="text-xs text-[var(--hub-muted)]">Inactive</span>
                      ) : null}
                      {checked || publication ? (
                        <Badge tone={publication?.status === "PUBLISHED" ? "good" : publication?.status === "FAILED" ? "bad" : "warn"}>
                          {publication?.status === "PUBLISHED"
                            ? "Published"
                            : publication?.status === "PENDING"
                              ? "Publishing"
                              : publication?.status === "FAILED"
                                ? "Failed"
                                : "Waiting"}
                        </Badge>
                      ) : null}
                      {published && publication?.external_url ? (
                        <a
                          href={`/published/${publication.id}`}
                          target="_blank"
                          className="font-semibold text-[var(--hub-accent)] underline-offset-2 hover:underline"
                        >
                          Open
                        </a>
                      ) : null}
                      {publication?.status === "FAILED" && publication.error_message ? (
                        <span className="text-[var(--hub-muted)]">{publication.error_message}</span>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      )}
      {readOnly ? null : (
        <p className="text-xs text-[var(--hub-muted)]">
          Tick every provider that should receive that language. A published provider stays ticked. The source language is sent when the article is approved. A translation is sent when that language is approved.
        </p>
      )}
    </fieldset>
  );
}

function uniqueLanguages(sourceLanguage: string, languageCodes: string[]) {
  const seen = new Set<string>();
  const codes: string[] = [];
  for (const code of [sourceLanguage, ...languageCodes]) {
    const trimmed = code.trim();
    const key = languageKey(trimmed);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    codes.push(trimmed);
  }
  return codes;
}
