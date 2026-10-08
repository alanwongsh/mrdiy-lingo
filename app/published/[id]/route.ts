import { getPublicationRedirect } from "@/lib/publish/redirect";

export const dynamic = "force-dynamic";

const PAGES: Record<string, { title: string; message: string }> = {
  missing: {
    title: "Link not found",
    message: "This published link does not exist.",
  },
  pending: {
    title: "Not published yet",
    message: "This article has not been published yet.",
  },
  failed: {
    title: "Publish failed",
    message: "This article could not be published to the vendor.",
  },
  nolink: {
    title: "No public link",
    message: "The vendor accepted the article and did not return a public link.",
  },
};

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const result = await getPublicationRedirect(id);
  if (result.kind === "redirect") {
    const url = new URL(result.url);
    if (url.hash) {
      return htmlResponse("Opening published page", "Continue to the published page.", 200, url.toString());
    }
    return new Response(null, {
      status: 302,
      headers: {
        Location: url.toString(),
        "Cache-Control": "no-store",
      },
    });
  }
  const page = PAGES[result.kind] ?? PAGES.missing;
  const status = result.kind === "missing" ? 404 : 200;
  return htmlResponse(page.title, page.message, status);
}

function htmlResponse(title: string, message: string, status: number, redirectUrl?: string) {
  const script = redirectUrl
    ? `<script>location.replace(${JSON.stringify(redirectUrl).replace(/</g, "\\u003c")})</script>`
    : "";
  const body = redirectUrl
    ? `<p><a href="${escapeHtml(redirectUrl)}">Continue</a></p>`
    : `<p>${escapeHtml(message)}</p>`;
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    ${script}
  </head>
  <body style="margin:0;font-family:sans-serif;background:#f8fafc;color:#0f172a;">
    <main style="max-width:32rem;margin:4rem auto;padding:0 1.25rem;">
      <h1 style="font-size:1.25rem;">${escapeHtml(title)}</h1>
      ${body}
    </main>
  </body>
</html>`;
  return new Response(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
