"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { listLanguages } from "@/lib/actions/languages";
import { createArticle } from "@/lib/actions/press";
import type { ContentType, Language } from "@/lib/types";
import {
  Button,
  Card,
  Field,
  PageHeader,
  inputClass,
  textareaClass,
} from "@/components/ui";
import { LanguageMultiSelect } from "@/components/language-multi-select";
import { HtmlEditor } from "@/components/html-editor";
import { MARKETS } from "@/lib/markets";

export default function NewArticlePage() {
  const { id: applicationId } = useParams<{ id: string }>();
  const router = useRouter();
  const [languages, setLanguages] = useState<Language[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [body, setBody] = useState("");
  const [sourceLanguage, setSourceLanguage] = useState("en");
  const [market, setMarket] = useState("");
  const [targetLanguages, setTargetLanguages] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  useEffect(() => {
    listLanguages().then((list) => {
      setLanguages(list);
      if (list.some((l) => l.code === "en")) setSourceLanguage("en");
      else if (list[0]) setSourceLanguage(list[0].code);
    });
  }, []);

  const targetOptions = useMemo(
    () => languages.filter((l) => l.code !== sourceLanguage),
    [languages, sourceLanguage]
  );

  useEffect(() => {
    setTargetLanguages((prev) =>
      prev.filter((code) => code !== sourceLanguage)
    );
  }, [sourceLanguage]);

  return (
    <div>
      <PageHeader
        title="New article"
        back={{
          href: `/applications/${applicationId}/articles`,
          label: "Back to articles",
        }}
      />
      <Card className="max-w-3xl p-5">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            setError("");
            startTransition(async () => {
              try {
                const scheduled = String(fd.get("scheduled_publish_at") ?? "");
                const article = await createArticle({
                  application_id: applicationId,
                  title,
                  slug: null,
                  source_language: sourceLanguage,
                  content_type: (String(fd.get("content_type") ?? "ARTICLE") ||
                    "ARTICLE") as ContentType,
                  status: "DRAFT",
                  market: market || null,
                  target_languages: targetLanguages,
                  scheduled_publish_at: scheduled
                    ? new Date(scheduled).toISOString()
                    : null,
                  source_content: {
                    title,
                    summary: description,
                    body,
                    seo_title: title,
                    seo_description: description,
                  },
                });
                router.push(
                  `/applications/${applicationId}/articles/${article.id}/edit`
                );
              } catch (err) {
                setError(err instanceof Error ? err.message : "Failed");
              }
            });
          }}
        >
          <Field label="Title">
            <input
              className={inputClass}
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Content type">
              <select
                name="content_type"
                className={inputClass}
                defaultValue="ARTICLE"
              >
                <option value="ARTICLE">ARTICLE</option>
                <option value="NEWS">NEWS</option>
                <option value="ANNOUNCEMENT">ANNOUNCEMENT</option>
              </select>
            </Field>
            <Field label="Source language">
              <select
                className={inputClass}
                value={sourceLanguage}
                onChange={(e) => setSourceLanguage(e.target.value)}
              >
                {languages.map((l) => (
                  <option key={l.id} value={l.code}>
                    {l.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Market">
              <select
                className={inputClass}
                value={market}
                onChange={(e) => setMarket(e.target.value)}
              >
                <option value="">No market</option>
                {MARKETS.map((item) => (
                  <option key={item.code} value={item.code}>
                    {item.code} · {item.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-4">
            <LanguageMultiSelect
              label="Target languages"
              options={targetOptions}
              selected={targetLanguages}
              onSelectedChange={setTargetLanguages}
              showEditingSwitcher={false}
            />
          </div>
          <Field label="Estimated publish (optional)">
            <input
              type="datetime-local"
              name="scheduled_publish_at"
              className={inputClass}
            />
          </Field>
          <Field label="Description">
            <textarea
              className={textareaClass}
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
          <Field label="Body">
            <HtmlEditor
              value={body}
              onChange={setBody}
              placeholder="Write article body…"
              minHeightClass="min-h-[14rem]"
            />
          </Field>
          {error ? <p className="text-sm text-red-700">{error}</p> : null}
          <Button type="submit" disabled={pending}>
            {pending ? "Creating…" : "Create article"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
