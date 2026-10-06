"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteContentType } from "@/lib/actions/content-types";
import type { ContentTypeRecord } from "@/lib/types";
import { ContentTypeDialog } from "@/components/content-type-dialog";
import { IconButton, PencilIcon, TrashIcon } from "@/components/icon-button";
import { Badge, Button, Card, statusTone } from "@/components/ui";

export function ContentTypesManager({
  applicationId,
  contentTypes,
  counts,
  canEdit,
}: {
  applicationId: string;
  contentTypes: ContentTypeRecord[];
  counts: Record<string, number>;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [dialog, setDialog] = useState<ContentTypeRecord | "new" | null>(null);
  const [error, setError] = useState("");

  return (
    <div className="space-y-4">
      {canEdit ? (
        <div className="flex justify-end">
          <Button type="button" onClick={() => setDialog("new")}>
            New type
          </Button>
        </div>
      ) : null}
      <Card className="overflow-x-auto">
        <table className="hub-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Code</th>
              <th>Description</th>
              <th>Articles</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {contentTypes.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-sm text-[var(--hub-muted)]">
                  No types yet.
                </td>
              </tr>
            ) : (
              contentTypes.map((type) => {
                const used = counts[type.code] ?? 0;
                return (
                  <tr key={type.id} className="border-b border-[var(--hub-border)]">
                    <td className="px-4 py-3 font-medium">{type.name}</td>
                    <td className="px-4 py-3 text-[var(--hub-muted)]">{type.code}</td>
                    <td className="px-4 py-3 text-[var(--hub-muted)]">
                      {type.description || "—"}
                    </td>
                    <td className="px-4 py-3">{used}</td>
                    <td className="px-4 py-3">
                      <Badge tone={statusTone(type.status)}>{type.status}</Badge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {canEdit ? (
                        <div className="inline-flex items-center justify-end gap-1">
                          <IconButton
                            label={`Edit ${type.name}`}
                            onClick={() => setDialog(type)}
                          >
                            <PencilIcon />
                          </IconButton>
                          {used === 0 ? (
                            <IconButton
                              label={`Delete ${type.name}`}
                              danger
                              disabled={pending}
                              onClick={() => {
                                if (!confirm(`Delete “${type.name}”?`)) return;
                                setError("");
                                startTransition(async () => {
                                  try {
                                    await deleteContentType(type.id, applicationId);
                                    router.refresh();
                                  } catch (err) {
                                    setError(
                                      err instanceof Error ? err.message : "Failed"
                                    );
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
                );
              })
            )}
          </tbody>
        </table>
      </Card>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      {dialog ? (
        <ContentTypeDialog
          applicationId={applicationId}
          contentType={dialog === "new" ? null : dialog}
          onClose={() => setDialog(null)}
          onSaved={() => router.refresh()}
        />
      ) : null}
    </div>
  );
}
