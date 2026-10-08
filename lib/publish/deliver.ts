import { writeServiceLog } from "@/lib/service-log";
import { readConfig, type PublishArticle } from "@/lib/publish/integrations/integration";
import { getPublishIntegration } from "@/lib/publish/integrations/registry";

export type DeliveryResult =
  | { ok: true; externalUrl: string | null }
  | { ok: false; error: string };

const IN_FLIGHT_MS = 2 * 60 * 1000;

export function publicationInFlight(attemptedAt: string | null, now = Date.now()): boolean {
  if (!attemptedAt) return false;
  const at = new Date(attemptedAt).getTime();
  if (Number.isNaN(at)) return false;
  return now - at < IN_FLIGHT_MS;
}

export async function deliverToVendor(input: {
  id: string;
  name: string;
  typeCode: string;
  config: unknown;
  article: PublishArticle;
}): Promise<DeliveryResult> {
  const started = Date.now();
  const integration = getPublishIntegration(input.typeCode);
  if (!integration) {
    const error = `Unknown integration type “${input.typeCode}”.`;
    await logDelivery(input, false, null, error, Date.now() - started);
    return { ok: false, error };
  }
  try {
    const result = await integration.publish({
      config: readConfig(input.config),
      article: input.article,
    });
    await logDelivery(input, true, result.externalUrl, null, Date.now() - started);
    return { ok: true, externalUrl: result.externalUrl };
  } catch (error) {
    const message = error instanceof Error ? error.message : "The vendor request failed.";
    await logDelivery(input, false, null, message, Date.now() - started);
    return { ok: false, error: message };
  }
}

async function logDelivery(
  input: { id: string; name: string; typeCode: string; article: PublishArticle },
  ok: boolean,
  externalUrl: string | null,
  error: string | null,
  durationMs: number
) {
  await writeServiceLog({
    source: "publish",
    ok,
    durationMs,
    message: ok
      ? `Published “${input.article.title}” to ${input.name}`
      : `Publish to ${input.name} failed`,
    error: error ?? undefined,
    input: JSON.stringify({
      articleId: input.article.id,
      title: input.article.title,
      vendor: input.name,
      type: input.typeCode,
    }),
    output: externalUrl ?? undefined,
    metadata: { vendorId: input.id, deliveryId: input.article.deliveryId },
  });
}
