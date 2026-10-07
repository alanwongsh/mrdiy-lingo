import { previewQualityAction } from "@/lib/translation-quality/handlers";

function jsonError(error: unknown) {
  const message = error instanceof Error ? error.message : "Request failed.";
  const status = /not found|no longer matches/i.test(message)
    ? /no longer matches/i.test(message)
      ? 409
      : 404
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
    const body = (await request.json().catch(() => ({}))) as {
      title?: string;
      summary?: string;
      content?: string;
    };
    return Response.json(
      await previewQualityAction({
        actionId: id,
        title: body.title,
        summary: body.summary,
        content: body.content,
      })
    );
  } catch (error) {
    return jsonError(error);
  }
}
