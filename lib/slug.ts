export function slugifyTitle(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function normalizeSlug(
  slug: string | null | undefined,
  title: string
): string {
  const cleaned = (slug ?? "").trim().toLowerCase();
  if (cleaned) {
    return cleaned
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80);
  }
  return slugifyTitle(title);
}
