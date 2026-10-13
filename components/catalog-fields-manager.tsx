"use client";

import { errorMessage } from "@/lib/errors";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createItemField, deleteItemField, updateItemField } from "@/lib/actions/catalog";
import { normalizeFieldCode } from "@/lib/catalog";
import { FilterSelect } from "@/components/filter-select";
import type { CatalogField, EntityStatus } from "@/lib/types";
import { IconButton, PencilIcon, TrashIcon } from "@/components/icon-button";
import { Badge, Button, Card, Field, inputClass, statusTone } from "@/components/ui";

export function CatalogFieldsManager({
  applicationId,
  fields,
  usage,
  canManage,
}: {
  applicationId: string;
  fields: CatalogField[];
  usage: Record<string, boolean>;
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [dialog, setDialog] = useState<CatalogField | "new" | null>(null);
  const [error, setError] = useState("");

  return (
    <div className="space-y-4">
      {canManage ? (
        <div className="flex justify-end">
          <Button type="button" onClick={() => setDialog("new")}>
            New field
          </Button>
        </div>
      ) : null}
      <Card className="overflow-x-auto">
        <table className="hub-table">
          <thead>
            <tr>
              <th>Order</th>
              <th>Label</th>
              <th>Code</th>
              <th>Translated</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {fields.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-sm text-[var(--hub-muted)]">
                  No fields yet.
                </td>
              </tr>
            ) : (
              fields.map((field) => (
                <tr key={field.id}>
                  <td className="tabular-nums text-[var(--hub-muted)]">{field.sort_order}</td>
                  <td className="font-medium">{field.label}</td>
                  <td className="font-mono text-xs text-[var(--hub-muted)]">{field.code}</td>
                  <td>{field.translatable ? "Per language" : "Same everywhere"}</td>
                  <td>
                    <Badge tone={statusTone(field.status)}>{field.status}</Badge>
                  </td>
                  <td className="text-right">
                    {canManage ? (
                      <div className="inline-flex items-center gap-1">
                        <IconButton label={`Edit ${field.label}`} onClick={() => setDialog(field)}>
                          <PencilIcon />
                        </IconButton>
                        {!usage[field.id] ? (
                          <IconButton
                            label={`Delete ${field.label}`}
                            danger
                            disabled={pending}
                            onClick={() => {
                              if (!confirm(`Delete “${field.label}”?`)) return;
                              setError("");
                              startTransition(async () => {
                                try {
                                  await deleteItemField(field.id, applicationId);
                                  router.refresh();
                                } catch (err) {
                                  setError(errorMessage(err, "Failed"));
                                }
                              });
                            }}
                          >
                            <TrashIcon />
                          </IconButton>
                        ) : null}
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      {dialog ? (
        <FieldDialog
          applicationId={applicationId}
          field={dialog === "new" ? null : dialog}
          onClose={() => setDialog(null)}
          onSaved={() => router.refresh()}
        />
      ) : null}
    </div>
  );
}

function FieldDialog({
  applicationId,
  field,
  onClose,
  onSaved,
}: {
  applicationId: string;
  field: CatalogField | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [label, setLabel] = useState(field?.label ?? "");
  const [code, setCode] = useState(field?.code ?? "");
  const [codeTouched, setCodeTouched] = useState(Boolean(field));
  const [translatable, setTranslatable] = useState(field?.translatable ?? true);
  const [sortOrder, setSortOrder] = useState(String(field?.sort_order ?? ""));
  const [status, setStatus] = useState<EntityStatus>(field?.status ?? "ACTIVE");
  const [error, setError] = useState("");
  const previewCode = field ? field.code : normalizeFieldCode(codeTouched ? code : label);

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-slate-900/40 p-4 sm:items-center"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div role="dialog" aria-modal="true" aria-labelledby="field-dialog-title" className="w-full max-w-md">
        <Card className="p-4">
          <h2 id="field-dialog-title" className="mb-3 text-sm font-semibold">
            {field ? "Edit field" : "New field"}
          </h2>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              setError("");
              startTransition(async () => {
                try {
                  if (field) {
                    await updateItemField(field.id, applicationId, {
                      label,
                      translatable,
                      sort_order: Number(sortOrder) || 0,
                      status,
                    });
                  } else {
                    await createItemField({
                      application_id: applicationId,
                      label,
                      code: previewCode,
                      translatable,
                    });
                  }
                  onSaved();
                  onClose();
                } catch (err) {
                  setError(errorMessage(err, "Failed"));
                }
              });
            }}
          >
            <Field label="Label" htmlFor="field-label">
              <input
                id="field-label"
                className={inputClass}
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                required
                autoFocus
              />
            </Field>
            <Field label="Code" htmlFor="field-code">
              {field ? (
                <p className="font-mono text-sm">{field.code}</p>
              ) : (
                <input
                  id="field-code"
                  className={`${inputClass} font-mono`}
                  value={codeTouched ? code : previewCode}
                  onChange={(e) => {
                    setCodeTouched(true);
                    setCode(e.target.value);
                  }}
                />
              )}
              <p className="text-xs text-[var(--hub-muted)]">
                Import columns use this code{previewCode ? `, for example ${previewCode} and ms_${previewCode}` : ""}.
              </p>
            </Field>
            <p className="text-xs text-[var(--hub-muted)]">
              Every field takes typed text, an upload (image, PDF, Word), or both. Text in an upload is
              read in automatically.
            </p>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={translatable}
                onChange={(e) => setTranslatable(e.target.checked)}
              />
              <span>
                Translate into each language
                <span className="block text-xs text-[var(--hub-muted)]">
                  {translatable
                    ? "Translated and approved per language. A country can also upload its own version."
                    : "Same in every language, such as an HS code, barcode, brand name, or product photo."}
                </span>
              </span>
            </label>
            {field ? (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Order" htmlFor="field-order">
                  <input
                    id="field-order"
                    type="number"
                    className={inputClass}
                    value={sortOrder}
                    onChange={(e) => setSortOrder(e.target.value)}
                  />
                </Field>
                <FilterSelect
                  label="Status"
                  fullWidth
                  hideEmptyOption
                  value={status}
                  placeholder="Status"
                  options={[
                    { value: "ACTIVE", label: "Active" },
                    { value: "INACTIVE", label: "Inactive (hidden)" },
                  ]}
                  onChange={(value) => value && setStatus(value as EntityStatus)}
                />
              </div>
            ) : null}
            {error ? <p className="text-sm text-red-700">{error}</p> : null}
            <div className="flex gap-2">
              <Button type="submit" disabled={pending}>
                {pending ? "Saving…" : field ? "Save" : "Create"}
              </Button>
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      </div>
    </div>
  );
}
