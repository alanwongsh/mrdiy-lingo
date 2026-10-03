import { createHmac } from "crypto";

const secret = process.env.JOGET_EMBED_SECRET?.trim();
if (!secret) {
  console.error("Set JOGET_EMBED_SECRET first.");
  process.exit(1);
}

const username = process.argv[2]?.trim();
const name = process.argv[3]?.trim() || username;
if (!username) {
  console.error('Usage: node scripts/mint-embed-token.mjs <username> "Display Name"');
  process.exit(1);
}

const payload = Buffer.from(
  JSON.stringify({
    u: username,
    n: name,
    e: "",
    exp: Math.floor(Date.now() / 1000) + 300,
  })
).toString("base64url");
const sig = createHmac("sha256", secret).update(payload).digest("base64url");
process.stdout.write(`${payload}.${sig}\n`);
