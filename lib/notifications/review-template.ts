// The review email: sender name, subject and an HTML body a superadmin can
// edit. Pure functions, so the editor previews exactly what the outbox sends.

export const REVIEW_EMAIL_KIND = "ARTICLE_REVIEW";

export type ReviewTemplate = {
  sender_name: string;
  subject: string;
  body: string;
};

export type ReviewTemplateField = keyof ReviewTemplate;

export const REVIEW_TEMPLATE_FIELDS: {
  key: ReviewTemplateField;
  label: string;
  hint: string;
  maxLength: number;
  html?: boolean;
}[] = [
  {
    key: "sender_name",
    label: "Sender name",
    hint: "Name shown as the sender in the inbox. The address stays the SMTP account's.",
    maxLength: 200,
  },
  { key: "subject", label: "Subject", hint: "The email subject line.", maxLength: 500 },
  {
    key: "body",
    label: "Body (HTML)",
    hint: "Full HTML of the email. Use tables and inline styles; many mail apps ignore <style> blocks and scripts. A plain-text copy is made from it.",
    maxLength: 100_000,
    html: true,
  },
];

const DEFAULT_BODY = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
</head>
<body style="margin:0;padding:0;background:#f6f7f9;">
<!-- Inbox preview text -->
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">{{submitter_name}} submitted an article for your approval in {{application_name}}.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f6f7f9;">
  <tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
      <tr><td style="height:6px;background:#ffc20e;font-size:0;line-height:0;">&nbsp;</td></tr>
      <tr><td style="font-family:Arial,Helvetica,sans-serif;padding:22px 32px 0;font-size:16px;font-weight:bold;color:#111827;">
        MR DIY <span style="color:#c2410c;">Lingo</span>
      </td></tr>
      <tr><td style="font-family:Arial,Helvetica,sans-serif;padding:24px 32px 32px;">
        <span style="display:inline-block;padding:4px 10px;border-radius:999px;background:#fff4cc;color:#8a6400;font-size:12px;font-weight:bold;letter-spacing:0.3px;">REVIEW NEEDED</span>
        <h1 style="margin:16px 0 8px;font-size:22px;line-height:30px;color:#111827;">{{article_title}}</h1>
        <p style="margin:0 0 20px;font-size:15px;line-height:22px;color:#4b5563;">
          An article is waiting for your approval in <strong style="color:#111827;">{{application_name}}</strong>.
        </p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid #e5e7eb;border-bottom:1px solid #e5e7eb;">
          <tr>
            <td style="font-family:Arial,Helvetica,sans-serif;padding:16px 0 6px;width:120px;font-size:13px;color:#6b7280;">Application</td>
            <td style="font-family:Arial,Helvetica,sans-serif;padding:16px 0 6px;font-size:14px;color:#111827;font-weight:bold;">{{application_name}}</td>
          </tr>
          <tr>
            <td style="font-family:Arial,Helvetica,sans-serif;padding:6px 0 16px;width:120px;font-size:13px;color:#6b7280;">Submitted by</td>
            <td style="font-family:Arial,Helvetica,sans-serif;padding:6px 0 16px;font-size:14px;color:#111827;font-weight:bold;">{{submitter_name}}</td>
          </tr>
        </table>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 8px;">
          <tr><td style="border-radius:8px;background:#c2410c;">
            <a href="{{article_url}}" style="font-family:Arial,Helvetica,sans-serif;display:inline-block;padding:13px 28px;font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:8px;">Review article</a>
          </td></tr>
        </table>
        <p style="margin:12px 0 0;font-size:12px;line-height:18px;color:#6b7280;">
          Button not working? Paste this link into your browser:<br>
          <a href="{{article_url}}" style="color:#c2410c;word-break:break-all;">{{article_url}}</a>
        </p>
      </td></tr>
      <tr><td style="font-family:Arial,Helvetica,sans-serif;padding:20px 32px;background:#fafafa;border-top:1px solid #e5e7eb;font-size:12px;line-height:18px;color:#6b7280;">
        This is an automated message from MR DIY Lingo. Please do not reply to this email; replies are not monitored.
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>
`;

export const DEFAULT_REVIEW_TEMPLATE: ReviewTemplate = {
  sender_name: "NOREPLY (MR D.I.Y Lingo)",
  subject: "Review needed: {{article_title}}",
  body: DEFAULT_BODY,
};

export type ReviewVariables = {
  article_title: string;
  application_name: string;
  submitter_name: string;
  article_url: string;
};

export const REVIEW_VARIABLES: {
  key: keyof ReviewVariables;
  description: string;
  sample: string;
}[] = [
  { key: "article_title", description: "Title of the article", sample: "mr diy keeps prices steady with 'Harga Tetap Sama'" },
  { key: "application_name", description: "Application the article belongs to", sample: "MR DIY Press" },
  {
    key: "submitter_name",
    description: "Who sent it to review, or \"A team member\" when unknown",
    sample: "Alan Wong",
  },
  {
    key: "article_url",
    description: "Link to the article, empty when APP_BASE_URL is not set",
    sample: "https://lingo.example.com/applications/123/articles/456",
  },
];

export const SAMPLE_REVIEW_VARIABLES = Object.fromEntries(
  REVIEW_VARIABLES.map((variable) => [variable.key, variable.sample])
) as ReviewVariables;

const VARIABLE = /\{\{\s*([a-z_]+)\s*\}\}/g;

/** Variable names used in the text that the review email does not know. */
export function unknownVariables(text: string): string[] {
  const known = new Set<string>(REVIEW_VARIABLES.map((variable) => variable.key));
  return [...new Set([...text.matchAll(VARIABLE)].map((match) => match[1]))].filter(
    (name) => !known.has(name)
  );
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

/** Fills {{variables}}; values are escaped when the text is HTML. */
export function fillTemplate(text: string, variables: ReviewVariables, html = false): string {
  return text.replace(VARIABLE, (whole, name: string) => {
    if (!(name in variables)) return whole;
    const value = variables[name as keyof ReviewVariables];
    return html ? escapeHtml(value) : value;
  });
}

/** Saved fields over the defaults; a blank field keeps the default. */
export function resolveReviewTemplate(
  saved: Partial<Record<ReviewTemplateField, string | null>> | null
): ReviewTemplate {
  const template = { ...DEFAULT_REVIEW_TEMPLATE };
  for (const { key } of REVIEW_TEMPLATE_FIELDS) {
    const value = saved?.[key]?.trim();
    if (value) template[key] = value;
  }
  return template;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Readable plain-text copy of the HTML, for mail apps that do not show HTML. */
export function htmlToText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(head|style|script|title)[\s\S]*?<\/\1>/gi, "")
    .replace(/<div[^>]*display\s*:\s*none[^>]*>[\s\S]*?<\/div>/gi, "")
    .replace(/<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, label: string) => {
      const text = label.replace(/<[^>]+>/g, "").trim();
      return !href || text === href ? text : `${text} (${href})`;
    })
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr|table)>/gi, "\n")
    .replace(/<\/td>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#\d+|[a-z]+);/gi, (whole, code: string) =>
      code.startsWith("#") ? String.fromCharCode(Number(code.slice(1))) : (ENTITIES[code.toLowerCase()] ?? whole)
    )
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function renderReviewEmail(template: ReviewTemplate, variables: ReviewVariables) {
  const oneLine = (value: string) => fillTemplate(value, variables).replace(/\s+/g, " ").trim();
  const html = fillTemplate(template.body, variables, true);
  return {
    fromName: oneLine(template.sender_name),
    subject: oneLine(template.subject),
    text: htmlToText(html),
    html,
  };
}
