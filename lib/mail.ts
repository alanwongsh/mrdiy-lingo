import nodemailer, { type Transporter } from "nodemailer";

let transport: Transporter | null = null;

export function mailConfigured(): boolean {
  return Boolean(
    process.env.SMTP_HOST?.trim() &&
      process.env.SMTP_USER?.trim() &&
      process.env.SMTP_PASS?.trim()
  );
}

function getTransport(): Transporter {
  if (transport) return transport;
  if (!mailConfigured()) throw new Error("SMTP is not configured.");
  const port = Number(process.env.SMTP_PORT?.trim() || 465);
  transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST!.trim(),
    port,
    // 465 is implicit TLS; 587 upgrades with STARTTLS.
    secure: port === 465,
    auth: {
      user: process.env.SMTP_USER!.trim(),
      pass: process.env.SMTP_PASS!.trim(),
    },
  });
  return transport;
}

/**
 * MAIL_FROM when it holds a full sender with an address. A bare name such as
 * "MR DIY Lingo" is ignored: Gmail would replace it with the bare account address.
 */
function mailFrom(): string {
  const value = process.env.MAIL_FROM?.trim() ?? "";
  return value.includes("@") ? value : "";
}

/** True when MAIL_FROM fixes the whole sender, so a template's sender name is ignored. */
export function mailFromOverridden(): boolean {
  return Boolean(mailFrom());
}

export async function sendMail(input: {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Sender name shown in the inbox. */
  fromName?: string;
}): Promise<void> {
  await getTransport().sendMail({
    // Gmail only sends as the signed-in account or a verified alias, so by
    // default keep that address and show the template's name in front of it.
    from: mailFrom() || {
      name: input.fromName?.trim() || "NOREPLY (MR D.I.Y Lingo)",
      address: process.env.SMTP_USER!.trim(),
    },
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: input.html,
    // Asks mail servers not to send out-of-office replies back.
    headers: { "Auto-Submitted": "auto-generated" },
  });
}
