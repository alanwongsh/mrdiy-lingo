import {
  isPublicHttpUrl,
  linkFromJson,
  webhookSiteToken,
  webhookSiteViewUrl,
} from "@/lib/publish/links";
import { PublishIntegration, type PublishArticle } from "@/lib/publish/integrations/integration";

/**
 * Example integration. Its credentials and the provider payload live here,
 * not in a shared webhook shape.
 *
 * title → title
 * html  → content
 */
export class WebhookSiteIntegration extends PublishIntegration {
  readonly code = "webhook_site";
  readonly name = "Mock";
  readonly description = "Mock provider. Posts the article to a webhook.site URL so the payload can be inspected.";
  readonly credentials = [
    {
      key: "url",
      label: "Webhook URL",
      input: "url" as const,
      required: true,
      help: "The unique URL from webhook.site.",
    },
    {
      key: "apiKey",
      label: "API key",
      input: "secret" as const,
      required: false,
      help: "Only when the URL belongs to a webhook.site account. It is not sent on the article post.",
    },
  ];
  readonly mapping = [
    { from: "title" as const, to: "title" },
    { from: "html" as const, to: "content" },
    { from: "summary" as const, to: "summary" },
    { from: "languageCode" as const, to: "language" },
  ];

  async publish(input: { config: Record<string, string>; article: PublishArticle }) {
    const url = input.config.url ?? "";
    const apiKey = input.config.apiKey ?? "";
    const token = webhookSiteToken(url);
    const deliveryId = input.article.deliveryId;
    if (token) {
      const existing = await findRequest(token, apiKey, deliveryId);
      if (existing) return { externalUrl: existing };
    }

    const response = await fetch(url, {
      method: "POST",
      redirect: "follow",
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/plain, */*",
        "X-Lingo-Delivery": deliveryId,
      },
      body: JSON.stringify(this.applyMapping(input.article)),
    });
    const text = (await response.text()).slice(0, 8_000);
    if (!response.ok) throw new Error(`webhook.site returned HTTP ${response.status}.`);

    const capturedInBody = viewFromWebhookBody(text, token);
    if (capturedInBody) return { externalUrl: capturedInBody };
    const fromBody = linkFromJson(text);
    if (fromBody && !isWebhookCatchUrl(fromBody)) return { externalUrl: fromBody };
    if (!token) return { externalUrl: null };

    const captured = await findRequest(token, apiKey, deliveryId, 3);
    if (!captured) {
      throw new Error("webhook.site accepted the article, but the captured request could not be found.");
    }
    return { externalUrl: captured };
  }
}

async function findRequest(token: string, apiKey: string, deliveryId: string, attempts = 1) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) await pause(400);
    const requests = await listRequests(token, apiKey);
    const match = requests.find((request) => includesDelivery(request, deliveryId));
    if (match?.uuid && /^[0-9a-f-]{36}$/i.test(match.uuid)) {
      const view = webhookSiteViewUrl(token, match.uuid);
      return isPublicHttpUrl(view) ? view : null;
    }
  }
  return null;
}

type CapturedRequest = {
  uuid?: string;
  content?: string;
  headers?: Record<string, string | string[]>;
};

async function listRequests(token: string, apiKey: string) {
  const endpoint = `https://webhook.site/token/${token}/requests?sorting=newest&per_page=50`;
  const headers = apiKey.trim() ? { "Api-Key": apiKey.trim() } : undefined;
  let response = await fetch(endpoint, {
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
    headers,
  });
  if (!response.ok && apiKey.trim()) {
    response = await fetch(endpoint, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
  }
  if (!response.ok) return [];
  const json = (await response.json()) as { data?: CapturedRequest[] };
  return Array.isArray(json.data) ? json.data : [];
}

function includesDelivery(request: CapturedRequest, deliveryId: string) {
  if (typeof request.content === "string" && request.content.includes(deliveryId)) return true;
  for (const [name, value] of Object.entries(request.headers ?? {})) {
    if (name.toLowerCase() !== "x-lingo-delivery") continue;
    if (Array.isArray(value)) return value.some((item) => item === deliveryId);
    return value === deliveryId;
  }
  return false;
}

function viewFromWebhookBody(text: string, fallbackToken: string | null) {
  try {
    const json = JSON.parse(text) as { uuid?: string; token_id?: string };
    const requestId = json.uuid ?? "";
    const tokenId = json.token_id || fallbackToken || "";
    if (!/^[0-9a-f-]{36}$/i.test(requestId) || !/^[0-9a-f-]{36}$/i.test(tokenId)) return null;
    const view = webhookSiteViewUrl(tokenId, requestId);
    return isPublicHttpUrl(view) ? view : null;
  } catch {
    return null;
  }
}

function isWebhookCatchUrl(value: string) {
  return webhookSiteToken(value) !== null && !value.includes("#");
}

function pause(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
