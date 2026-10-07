import { analyzeTranslationQuality } from "@/lib/translation-quality/handlers";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      applicationId?: string;
      contentId?: string;
      sourceLanguage?: string;
      targetLanguage?: string;
      sourceTitle?: string;
      sourceSummary?: string;
      sourceContent?: string;
      translatedTitle?: string;
      translatedSummary?: string;
      translatedContent?: string;
    };
    const result = await analyzeTranslationQuality({
      applicationId: body.applicationId ?? "",
      contentId: body.contentId ?? "",
      sourceLanguage: body.sourceLanguage ?? "",
      targetLanguage: body.targetLanguage ?? "",
      sourceTitle: body.sourceTitle ?? "",
      sourceSummary: body.sourceSummary ?? "",
      sourceContent: body.sourceContent ?? "",
      translatedTitle: body.translatedTitle ?? "",
      translatedSummary: body.translatedSummary ?? "",
      translatedContent: body.translatedContent ?? "",
    });
    return Response.json(result);
  } catch (error) {
    return jsonError(error);
  }
}

function jsonError(error: unknown) {
  const message = error instanceof Error ? error.message : "Request failed.";
  const status = /not found/i.test(message)
    ? 404
    : /permission|sign in|access/i.test(message)
      ? 403
      : 400;
  return Response.json({ error: message }, { status });
}
