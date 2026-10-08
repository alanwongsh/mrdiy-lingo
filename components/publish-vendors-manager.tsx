"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deletePublishVendor, savePublishVendor } from "@/lib/actions/publish";
import type { PublishIntegrationType } from "@/lib/publish/integrations/integration";
import type { EntityStatus, PublishVendor } from "@/lib/types";
import { IconButton, PencilIcon, TrashIcon } from "@/components/icon-button";
import { Badge, Button, Card, Field, inputClass, statusTone } from "@/components/ui";

const FIELD_LABEL: Record<string, string> = {
  title: "Title",
  summary: "Summary",
  html: "Body HTML",
  seoTitle: "SEO title",
  seoDescription: "SEO description",
  slug: "Slug",
  languageCode: "Language",
};

export function PublishVendorsManager({
  applicationId,
  vendors,
  types,
  canConfigure,
  disabled = false,
}: {
  applicationId: string;
  vendors: PublishVendor[];
  types: PublishIntegrationType[];
  canConfigure: boolean;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [dialog, setDialog] = useState<PublishVendor | "new" | null>(null);
  const [error, setError] = useState("");
  const typeName = new Map(types.map((type) => [type.code, type.name]));

  return (
    <div className="space-y-4">
      <Card className="space-y-3 p-4 text-sm text-[var(--hub-muted-strong)]">
        <p>
          The server publishes an approved article after its estimated time. An article can
          go to more than one connection.
        </p>
        {!canConfigure ? <p>HOD and above can add connections.</p> : null}
      </Card>

      {/* <div className="grid gap-3 md:grid-cols-2">
        {types.map((type) => (
          <Card key={type.code} className="space-y-2 p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">{type.name}</h2>
              <Badge tone="info">Type</Badge>
            </div>
            <p className="text-sm text-[var(--hub-muted)]">{type.description}</p>
            <ul className="space-y-1 text-sm">
              {type.mapping.map((field) => (
                <li key={`${field.from}-${field.to}`}>
                  <span className="text-[var(--hub-muted)]">{FIELD_LABEL[field.from] ?? field.from}</span>
                  {" → "}
                  <span className="font-medium">{field.to}</span>
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div> */}

      {canConfigure ? (
        <div className="flex justify-end">
          <Button type="button" disabled={disabled || types.length === 0} onClick={() => setDialog("new")}>
            New connection
          </Button>
        </div>
      ) : null}

      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      <Card className="overflow-x-auto">
        <table className="hub-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {vendors.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-sm text-[var(--hub-muted)]">
                  No connections yet.
                </td>
              </tr>
            ) : (
              vendors.map((vendor) => (
                <tr key={vendor.id} className="border-b border-[var(--hub-border)]">
                  <td className="px-4 py-3 font-medium">{vendor.name}</td>
                  <td className="px-4 py-3 text-[var(--hub-muted)]">
                    {typeName.get(vendor.type_code) ?? vendor.type_code}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={statusTone(vendor.status)}>{vendor.status}</Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {canConfigure ? (
                      <div className="inline-flex items-center justify-end gap-1">
                        <IconButton label={`Edit ${vendor.name}`} onClick={() => setDialog(vendor)}>
                          <PencilIcon />
                        </IconButton>
                        <IconButton
                          label={`Delete ${vendor.name}`}
                          danger
                          disabled={pending}
                          onClick={() => remove(vendor)}
                        >
                          <TrashIcon />
                        </IconButton>
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>

      {dialog ? (
        <VendorDialog
          applicationId={applicationId}
          vendor={dialog === "new" ? null : dialog}
          types={types}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </div>
  );

  function remove(vendor: PublishVendor) {
    if (
      !confirm(
        `Remove “${vendor.name}”? Articles will stop publishing to it, and its published links will stop working.`
      )
    ) {
      return;
    }
    setError("");
    startTransition(async () => {
      try {
        await deletePublishVendor(vendor.id, applicationId);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not delete the connection.");
      }
    });
  }
}

function VendorDialog({
  applicationId,
  vendor,
  types,
  onClose,
}: {
  applicationId: string;
  vendor: PublishVendor | null;
  types: PublishIntegrationType[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(vendor?.name ?? "");
  const [typeCode, setTypeCode] = useState(vendor?.type_code ?? types[0]?.code ?? "");
  const [config, setConfig] = useState<Record<string, string>>(vendor?.config ?? {});
  const [clearSecrets, setClearSecrets] = useState<string[]>([]);
  const [status, setStatus] = useState<EntityStatus>(vendor?.status ?? "ACTIVE");
  const [error, setError] = useState("");
  const selected = types.find((type) => type.code === typeCode) ?? types[0];

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-slate-900/40 p-4 sm:items-center"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <Card className="max-h-[90vh] w-full max-w-lg space-y-4 overflow-auto p-4">
        <h2 className="text-base font-semibold">{vendor ? "Edit connection" : "New connection"}</h2>
        <Field label="Name" htmlFor="vendor-name">
          <input
            id="vendor-name"
            className={inputClass}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Field label="Type" htmlFor="vendor-type">
          <select
            id="vendor-type"
            className={inputClass}
            value={selected?.code ?? ""}
            disabled={Boolean(vendor)}
            onChange={(event) => {
              setTypeCode(event.target.value);
              setConfig({});
              setClearSecrets([]);
            }}
          >
            {types.map((type) => (
              <option key={type.code} value={type.code}>
                {type.name}
              </option>
            ))}
          </select>
        </Field>
        {selected ? (
          <p className="text-xs text-[var(--hub-muted)]">
            {`${selected.mapping
              .map((field) => `${FIELD_LABEL[field.from] ?? field.from} is sent as ${field.to}`)
              .join(". ")}.`}
          </p>
        ) : null}
        {selected?.credentials.map((field) => {
          const saved = vendor?.type_code === selected.code && vendor.saved_secrets.includes(field.key);
          return (
            <div key={field.key} className="space-y-1.5">
              <Field label={field.label} htmlFor={`vendor-${field.key}`}>
                <input
                  id={`vendor-${field.key}`}
                  type={field.input === "secret" ? "password" : "text"}
                  autoComplete={field.input === "secret" ? "new-password" : "off"}
                  className={inputClass}
                  placeholder={
                    field.input === "secret" && saved
                      ? "Leave blank to keep the saved value"
                      : field.help
                  }
                  value={config[field.key] ?? ""}
                  onChange={(event) =>
                    setConfig((current) => ({ ...current, [field.key]: event.target.value }))
                  }
                />
              </Field>
              {field.help && field.input !== "secret" ? (
                <p className="text-xs text-[var(--hub-muted)]">{field.help}</p>
              ) : null}
              {field.input === "secret" && saved ? (
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={clearSecrets.includes(field.key)}
                    onChange={(event) =>
                      setClearSecrets((current) =>
                        event.target.checked
                          ? [...current, field.key]
                          : current.filter((key) => key !== field.key)
                      )
                    }
                  />
                  Remove the saved {field.label.toLowerCase()}
                </label>
              ) : null}
            </div>
          );
        })}
        <Field label="Status" htmlFor="vendor-status">
          <select
            id="vendor-status"
            className={inputClass}
            value={status}
            onChange={(event) => setStatus(event.target.value === "INACTIVE" ? "INACTIVE" : "ACTIVE")}
          >
            <option value="ACTIVE">ACTIVE</option>
            <option value="INACTIVE">INACTIVE</option>
          </select>
        </Field>
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" disabled={pending || !selected} onClick={save}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </div>
      </Card>
    </div>
  );

  function save() {
    if (!selected) return;
    setError("");
    startTransition(async () => {
      try {
        await savePublishVendor({
          applicationId,
          id: vendor?.id,
          name,
          typeCode: selected.code,
          config,
          clearSecrets,
          status,
        });
        router.refresh();
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not save the connection.");
      }
    });
  }
}
