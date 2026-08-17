/** Central place for size / pagination / timeout limits used across the server. */

export const LIMITS = {
  /** Maximum bytes we will download for any single file (20 MB). */
  MAX_DOWNLOAD_BYTES: 20 * 1024 * 1024,
  /** Maximum bytes we will parse for text-extraction tools (10 MB). */
  MAX_PARSE_BYTES: 10 * 1024 * 1024,
  /** Maximum characters returned from any text-extraction tool. */
  MAX_TEXT_OUTPUT_CHARS: 200_000,
  /** Maximum rows returned by default from spreadsheet/CSV readers. */
  DEFAULT_ROW_LIMIT: 200,
  /** Hard ceiling on rows regardless of what the caller requests. */
  MAX_ROW_LIMIT: 5_000,
  /** Default number of rows shown in an inspect/preview response. */
  PREVIEW_ROW_COUNT: 10,
  /** Default page size for list/search operations. */
  DEFAULT_PAGE_SIZE: 50,
  /** Hard ceiling on page size for list/search operations. */
  MAX_PAGE_SIZE: 200,
  /** Timeout (ms) for any single outbound Google API call. */
  GOOGLE_API_TIMEOUT_MS: 30_000,
} as const;

export function clampLimit(requested: number | undefined, fallback: number, max: number): number {
  if (requested === undefined || Number.isNaN(requested)) return fallback;
  if (requested < 1) return fallback;
  return Math.min(requested, max);
}

export function clampOffset(requested: number | undefined): number {
  if (requested === undefined || Number.isNaN(requested) || requested < 0) return 0;
  return requested;
}

export function truncateText(text: string, maxChars: number = LIMITS.MAX_TEXT_OUTPUT_CHARS): {
  text: string;
  truncated: boolean;
} {
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: text.slice(0, maxChars), truncated: true };
}

/** Wraps a promise with a timeout, rejecting with a clear error if it takes too long. */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}
