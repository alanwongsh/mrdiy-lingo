"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { listLanguages } from "@/lib/actions/languages";
import {
  createTranslationKey,
  listNamespaces,
} from "@/lib/actions/product";
import type { Language, Namespace } from "@/lib/types";
import {
  Button,
  Card,
  Field,
  PageHeader,
  inputClass,
  textareaClass,
} from "@/components/ui";

export default function NewTranslationKeyPage() {
  const { id: applicationId } = useParams<{ id: string }>();
  const router = useRouter();
  const [namespaces, setNamespaces] = useState<Namespace[]>([]);
  const [languages, setLanguages] = useState<Language[]>([]);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([
      listNamespaces(applicationId),
      listLanguages(),
    ]).then(([ns, langs]) => {
      setNamespaces(ns);
      setLanguages(langs);
    });
  }, [applicationId]);

  return (
    <div>
      <PageHeader
        title="New translation key"
        description="Keys are unique within an application."
        back={{
          href: `/applications/${applicationId}/translations`,
          label: "Back to translations",
        }}
      />
      <Card className="max-w-xl p-5">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            setError("");
            startTransition(async () => {
              try {
                const key = await createTranslationKey({
                  application_id: applicationId,
                  namespace_id: String(fd.get("namespace_id") ?? ""),
                  key: String(fd.get("key") ?? ""),
                  source_language: String(fd.get("source_language") ?? "en"),
                  source_text: String(fd.get("source_text") ?? ""),
                });
                router.push(
                  `/applications/${applicationId}/translations/${key.id}`
                );
              } catch (err) {
                setError(err instanceof Error ? err.message : "Failed");
              }
            });
          }}
        >
          <Field label="Namespace">
            <select name="namespace_id" className={inputClass} required>
              <option value="">Select namespace</option>
              {namespaces.map((ns) => (
                <option key={ns.id} value={ns.id}>
                  {ns.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Key">
            <input
              name="key"
              className={inputClass}
              placeholder="checkout.pay_now"
              required
            />
          </Field>
          <Field label="Source language">
            <select
              name="source_language"
              className={inputClass}
              defaultValue="en"
            >
              {languages.map((l) => (
                <option key={l.id} value={l.code}>
                  {l.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Source text">
            <textarea
              name="source_text"
              className={textareaClass}
              rows={3}
              required
            />
          </Field>
          {error ? <p className="text-sm text-red-700">{error}</p> : null}
          <Button type="submit" disabled={pending || namespaces.length === 0}>
            {pending ? "Creating…" : "Create key"}
          </Button>
          {namespaces.length === 0 ? (
            <p className="text-sm text-[var(--hub-muted)]">
              Create a namespace first.
            </p>
          ) : null}
        </form>
      </Card>
    </div>
  );
}
