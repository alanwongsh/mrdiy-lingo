"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setReviewEmailNotifications } from "@/lib/actions/applications";
import { Button, Card } from "@/components/ui";

export function NotificationSettings({
  applicationId,
  reviewEmail,
  canConfigure,
  mailReady,
}: {
  applicationId: string;
  reviewEmail: boolean;
  canConfigure: boolean;
  mailReady: boolean;
}) {
  const router = useRouter();
  const [saved, setSaved] = useState(reviewEmail);
  const [enabled, setEnabled] = useState(reviewEmail);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const dirty = enabled !== saved;

  function save() {
    setError("");
    setMessage("");
    startTransition(async () => {
      try {
        await setReviewEmailNotifications(applicationId, enabled);
        setSaved(enabled);
        setMessage("Saved.");
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not save this setting.");
      }
    });
  }

  return (
    <Card className="max-w-2xl space-y-3 p-4">
      <label
        className={`flex items-start gap-3 ${canConfigure && !pending ? "cursor-pointer" : ""}`}
      >
        <input
          type="checkbox"
          className="mt-0.5 accent-[var(--diy-red)]"
          checked={enabled}
          disabled={!canConfigure || pending}
          onChange={(e) => {
            setEnabled(e.target.checked);
            setMessage("");
          }}
        />
        <span className="space-y-1">
          <span className="block text-sm font-semibold text-slate-900">
            Email approvers when an article is ready for review
          </span>
          <span className="block text-sm text-[var(--hub-muted)]">
            The owner and every HOD or Admin with an email address get one email when an article
            moves to Review.
          </span>
        </span>
      </label>
      {!canConfigure ? (
        <p className="text-xs text-[var(--hub-muted)]">Only approvers can change this.</p>
      ) : null}
      {!mailReady ? (
        <p className="text-xs text-amber-800">
          Email is not set up on this server yet, so notices wait in the queue until it is.
        </p>
      ) : null}
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      {canConfigure ? (
        <div className="flex items-center gap-2">
          <Button type="button" onClick={save} disabled={!dirty || pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
          {dirty ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() => setEnabled(saved)}
              disabled={pending}
            >
              Cancel
            </Button>
          ) : null}
          {message && !dirty ? (
            <span className="text-sm text-emerald-700">{message}</span>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
