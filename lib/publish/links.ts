const LINK_KEYS = ["url", "link", "published_url", "publishedUrl", "permalink"];

export function isPublicHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    if (url.username || url.password) return false;
    return Boolean(url.hostname);
  } catch {
    return false;
  }
}

export function linkFromJson(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
  try {
    return findLink(JSON.parse(trimmed), 0);
  } catch {
    return null;
  }
}

function findLink(value: unknown, depth: number): string | null {
  if (!value || typeof value !== "object" || depth > 4) return null;
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 5)) {
      const found = findLink(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  const record = value as Record<string, unknown>;
  for (const key of LINK_KEYS) {
    const candidate = record[key];
    if (typeof candidate === "string" && isPublicHttpUrl(candidate)) return candidate;
  }
  if ("data" in record) return findLink(record.data, depth + 1);
  if ("result" in record) return findLink(record.result, depth + 1);
  return null;
}

/** Token id from a webhook.site catch URL such as https://webhook.site/{uuid}. */
export function webhookSiteToken(endpoint: string): string | null {
  try {
    const url = new URL(endpoint);
    if (url.hostname !== "webhook.site" && url.hostname !== "www.webhook.site") return null;
    const id = url.pathname.replace(/^\/+/, "").split("/")[0] ?? "";
    return /^[0-9a-f-]{36}$/i.test(id) ? id.toLowerCase() : null;
  } catch {
    return null;
  }
}

export function webhookSiteViewUrl(tokenId: string, requestId: string): string {
  return `https://webhook.site/#!/view/${tokenId}/${requestId}/1`;
}

export function endpointHost(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return "";
  }
}
