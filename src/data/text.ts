/** Trimmed and lower-cased with Turkish rules, so "SİMİT" matches "simit" and "YILMAZ" matches "yılmaz". */
export function normalizeForSearch(text: string): string {
  return text.trim().toLocaleLowerCase('tr');
}
