/**
 * Errors from server actions lose their message in production builds; Next.js
 * replaces it with a generic notice. A digest set on the error is kept, so a
 * message meant for the person is carried there and read back on the screen.
 * Only use this for text that is safe to show, never for raw database errors.
 */
const PREFIX = "lingo:";

export class UserFacingError extends Error {
  readonly digest: string;

  constructor(message: string) {
    super(message);
    this.name = "UserFacingError";
    this.digest = `${PREFIX}${message}`;
  }
}

const GENERIC = /omitted in production builds|Server Components render/i;

/** The message to show for an error from a server action, or the fallback. */
export function errorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === "object" && "digest" in error) {
    const digest = (error as { digest?: unknown }).digest;
    if (typeof digest === "string" && digest.startsWith(PREFIX)) return digest.slice(PREFIX.length);
  }
  if (error instanceof Error && error.message && !GENERIC.test(error.message)) {
    return error.message;
  }
  // The real reason was hidden by the production build.
  return `${fallback} Reload the page and try again; your access may have changed.`;
}
