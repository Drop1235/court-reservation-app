export function normalizeName(raw: string): string {
  return raw
    .normalize('NFKC') // normalize width and compatibility chars
    .replace(/\u3000/g, ' ') // full-width space to half-width
    .replace(/\s+/g, ' ') // collapse multiple spaces
    .trim()
}

export function normalizeNames(names: string[]): string[] {
  return names.map((n) => (typeof n === 'string' ? normalizeName(n) : '')).filter(Boolean)
}
