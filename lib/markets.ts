export const MARKETS = [
  { code: "MY", name: "Malaysia" },
  { code: "SG", name: "Singapore" },
  { code: "TH", name: "Thailand" },
  { code: "ID", name: "Indonesia" },
  { code: "PH", name: "Philippines" },
  { code: "BN", name: "Brunei" },
  { code: "KH", name: "Cambodia" },
  { code: "LA", name: "Laos" },
  { code: "VN", name: "Vietnam" },
  { code: "IN", name: "India" },
  { code: "TR", name: "Turkey" },
  { code: "ES", name: "Spain" },
] as const;

export function normalizeMarket(value: string | null | undefined): string | null {
  const code = (value ?? "").trim().toUpperCase();
  if (!code) return null;
  return code.slice(0, 8);
}

export function marketName(code: string | null | undefined): string {
  const key = (code ?? "").trim().toUpperCase();
  return MARKETS.find((market) => market.code === key)?.name ?? key;
}
