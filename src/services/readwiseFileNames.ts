export function normalizeSearchName(value: string): string {
  return value
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-z0-9а-я]+/gi, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizeCompactName(value: string): string {
  return normalizeSearchName(value).replace(/\s+/g, "");
}
