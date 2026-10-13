import { randomBytes } from "crypto";

/**
 * A UUIDv7 (RFC 9562): 48 bits of Unix milliseconds, then random bits, so ids sort by creation
 * time. Matches the uuidv7() default the database uses for primary keys.
 */
export function uuidv7(): string {
  const bytes = randomBytes(16);
  let ms = Date.now();
  for (let i = 5; i >= 0; i -= 1) {
    bytes[i] = ms % 256;
    ms = Math.floor(ms / 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
