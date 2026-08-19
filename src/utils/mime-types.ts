export type FileCategory = 'excel' | 'csv' | 'pdf' | 'docx' | 'txt' | 'html' | 'image' | 'google-doc' | 'google-sheet' | 'google-slide' | 'other';

const EXCEL_MIME_TYPES = new Set([
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel.sheet.macroEnabled.12',
]);

const CSV_MIME_TYPES = new Set(['text/csv', 'text/comma-separated-values']);

const PDF_MIME_TYPES = new Set(['application/pdf']);

const DOCX_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

const TXT_MIME_TYPES = new Set(['text/plain']);

const HTML_MIME_TYPES = new Set(['text/html', 'application/xhtml+xml']);

const IMAGE_MIME_PREFIX = 'image/';

const GOOGLE_DOC_MIME = 'application/vnd.google-apps.document';
const GOOGLE_SHEET_MIME = 'application/vnd.google-apps.spreadsheet';
const GOOGLE_SLIDE_MIME = 'application/vnd.google-apps.presentation';
export const GOOGLE_FOLDER_MIME = 'application/vnd.google-apps.folder';

export function categorizeMimeType(mimeType: string, fileName?: string): FileCategory {
  if (EXCEL_MIME_TYPES.has(mimeType)) return 'excel';
  if (CSV_MIME_TYPES.has(mimeType)) return 'csv';
  if (PDF_MIME_TYPES.has(mimeType)) return 'pdf';
  if (DOCX_MIME_TYPES.has(mimeType)) return 'docx';
  if (TXT_MIME_TYPES.has(mimeType)) return 'txt';
  if (HTML_MIME_TYPES.has(mimeType)) return 'html';
  if (mimeType.startsWith(IMAGE_MIME_PREFIX)) return 'image';
  if (mimeType === GOOGLE_DOC_MIME) return 'google-doc';
  if (mimeType === GOOGLE_SHEET_MIME) return 'google-sheet';
  if (mimeType === GOOGLE_SLIDE_MIME) return 'google-slide';

  // Fallback to extension-based sniffing for octet-stream / unknown mime types.
  if (fileName) {
    const ext = fileName.toLowerCase().split('.').pop() ?? '';
    if (['xlsx', 'xls', 'xlsm'].includes(ext)) return 'excel';
    if (ext === 'csv') return 'csv';
    if (ext === 'pdf') return 'pdf';
    if (ext === 'docx') return 'docx';
    if (ext === 'txt') return 'txt';
    if (ext === 'html' || ext === 'htm') return 'html';
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'tiff'].includes(ext)) return 'image';
  }
  return 'other';
}

export function isGoogleWorkspaceFile(mimeType: string): boolean {
  return mimeType.startsWith('application/vnd.google-apps.');
}
