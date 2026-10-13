"use client";

import { can } from "@/lib/auth/permissions";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { getApplication } from "@/lib/actions/applications";
import type { Application } from "@/lib/types";
import { PageHeader } from "@/components/ui";
import { ApplicationDetailsForm } from "@/components/application-details-form";

export default function EditApplicationPage() {
  const { id } = useParams<{ id: string }>();
  const [app, setApp] = useState<Application | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    getApplication(id)
      .then((row) => {
        if (!row) {
          setError("You do not have access to this application.");
          return;
        }
        if (!can(row.access, "settings.general")) {
          setError("Only the owner or a superadmin can edit this application.");
          return;
        }
        setApp(row);
      })
      .catch((e) => setError(e.message));
  }, [id]);

  if (!app && !error) {
    return <div className="text-sm text-[var(--hub-muted)]">Loading…</div>;
  }

  if (!app) {
    return <div className="text-sm text-red-700">{error}</div>;
  }

  return (
    <div>
      <PageHeader
        title={`Edit ${app.name}`}
        back={{ href: `/applications/${id}`, label: "Back to application" }}
      />
      <ApplicationDetailsForm application={app} showModelType savedHref={`/applications/${id}`} />
    </div>
  );
}
