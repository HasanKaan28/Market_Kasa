const FOLDED: Record<string, string> = { ı: 'i', ç: 'c', ğ: 'g', ö: 'o', ş: 's', ü: 'u' };

/**
 * Trimmed, lower-cased with Turkish rules and folded to plain Latin letters, so "SİMİT",
 * "LIPTON ICE TEA" and "Çay" are found by "simit", "lipton ice" and "cay".
 */
export function normalizeForSearch(text: string): string {
  return text
    .trim()
    .toLocaleLowerCase('tr')
    .replace(/[ıçğöşü]/g, (letter) => FOLDED[letter] ?? letter);
}
