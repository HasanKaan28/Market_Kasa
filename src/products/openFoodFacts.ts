type FetchLike = (
  url: string,
  init?: { signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export type NameSuggestion = { name: string } | { error: 'not-found' | 'offline' | 'timeout' };

const PRODUCT_URL = 'https://world.openfoodfacts.org/api/v2/product/';
const FIELDS = 'product_name_tr,product_name,brands,quantity';
const MAX_NAME_LENGTH = 120;

/**
 * A product name for a barcode from Open Food Facts, a public product database. Only the barcode
 * leaves the device; the answer is a suggestion the user may take or leave.
 */
export async function suggestProductName(
  barcode: string,
  { fetch = globalThis.fetch, timeoutMs = 5000 }: { fetch?: FetchLike; timeoutMs?: number } = {},
): Promise<NameSuggestion> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(
      `${PRODUCT_URL}${encodeURIComponent(barcode)}.json?fields=${FIELDS}`,
      { signal: controller.signal },
    );
    if (response.status === 404) {
      return { error: 'not-found' };
    }
    if (!response.ok) {
      return { error: 'offline' };
    }
    const name = nameFrom(await response.json());
    return name ? { name } : { error: 'not-found' };
  } catch {
    return { error: controller.signal.aborted ? 'timeout' : 'offline' };
  } finally {
    clearTimeout(timer);
  }
}

/** "Ülker Çikolatalı Gofret 36 g": the brand, the Turkish name (else any) and the quantity. */
function nameFrom(body: unknown): string | undefined {
  const product =
    typeof body === 'object' && body !== null ? (body as { product?: unknown }).product : undefined;
  if (typeof product !== 'object' || product === null) {
    return undefined;
  }
  const fields = product as Record<string, unknown>;
  const name = text(fields.product_name_tr) ?? text(fields.product_name);
  if (!name) {
    return undefined;
  }
  const brand = text(fields.brands)?.split(',')[0]?.trim();
  const quantity = text(fields.quantity);
  const lower = name.toLocaleLowerCase('tr');
  const parts = [
    brand && !lower.includes(brand.toLocaleLowerCase('tr')) ? brand : undefined,
    name,
    quantity && !lower.includes(quantity.toLocaleLowerCase('tr')) ? quantity : undefined,
  ];
  return Array.from(parts.filter(Boolean).join(' ')).slice(0, MAX_NAME_LENGTH).join('');
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}
