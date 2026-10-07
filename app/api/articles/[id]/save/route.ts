import { saveReviewedContentTranslation } from "@/lib/translation-quality/handlers";
import type { SourceContentFields } from "@/lib/types";

function jsonError(error: unknown) {
  const message = error instanceof Error ? error.message : "Request failed.";
  const status = /not found/i.test(message)
    ? 404
    : /permission|sign in|access/i.test(message)
      ? 403
      : 400;
  return Response.json({ error: message }, { status });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const body = (await request.json()) as {
      applicationId?: string;
      languageCode?: string;
      fields?: SourceContentFields;
      qualityRunId?: string | null;
      acceptedActionIds?: string[];
      ignoredActionIds?: string[];
    };
    if (!body.fields) throw new Error("Article fields are required.");
    const saved = await saveReviewedContentTranslation({
      contentId: id,
      applicationId: body.applicationId ?? "",
      languageCode: body.languageCode ?? "",
      fields: body.fields,
      qualityRunId: body.qualityRunId,
      acceptedActionIds: body.acceptedActionIds,
      ignoredActionIds: body.ignoredActionIds,
    });
    return Response.json(saved);
  } catch (error) {
    return jsonError(error);
  }
}
