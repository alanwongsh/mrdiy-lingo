import { getTranslationQualityFindings } from "@/lib/translation-quality/handlers";

function jsonError(error: unknown) {
  const message = error instanceof Error ? error.message : "Request failed.";
  const status = /not found/i.test(message)
    ? 404
    : /permission|sign in|access/i.test(message)
      ? 403
      : 400;
  return Response.json({ error: message }, { status });
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    return Response.json(await getTranslationQualityFindings(id));
  } catch (error) {
    return jsonError(error);
  }
}
