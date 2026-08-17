import ExcelJS from 'exceljs';
import * as XLSX from 'xlsx';
import { z } from 'zod';
import type { GoogleDriveClient } from '../google-drive.js';
import { ValidationError, UnsupportedFileTypeError } from '../utils/errors.js';
import { LIMITS, clampLimit, clampOffset } from '../utils/limits.js';
import { categorizeMimeType } from '../utils/mime-types.js';

export const inspectExcelInputSchema = {
  file_id: z.string().min(1).describe('The Google Drive file ID of the Excel workbook (.xlsx or .xls).'),
};

export const readExcelSheetInputSchema = {
  file_id: z.string().min(1).describe('The Google Drive file ID of the Excel workbook.'),
  sheet_name: z.string().min(1).describe('The worksheet name to read.'),
  range: z
    .string()
    .optional()
    .describe('Optional A1-style cell range to read, e.g. "A1:E20". If omitted, uses offset/limit over all columns.'),
  limit: z.number().int().positive().optional().describe(`Max rows to return (default ${LIMITS.DEFAULT_ROW_LIMIT}, max ${LIMITS.MAX_ROW_LIMIT}).`),
  offset: z.number().int().nonnegative().optional().describe('Number of data rows to skip before returning results (default 0).'),
};

interface ParsedSheet {
  name: string;
  headers: string[];
  rows: unknown[][];
  rowCount: number;
  columnCount: number;
}

interface ParsedWorkbook {
  sheetNames: string[];
  sheets: Map<string, ParsedSheet>;
  isLegacyXls: boolean;
}

function normalizeCellValue(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') {
    if ('result' in (v as Record<string, unknown>)) return (v as { result: unknown }).result ?? null;
    if ('richText' in (v as Record<string, unknown>)) {
      return (v as { richText: { text: string }[] }).richText.map((r) => r.text).join('');
    }
    if ('text' in (v as Record<string, unknown>)) return (v as { text: unknown }).text ?? null;
  }
  return v;
}

async function parseWorkbook(buffer: Buffer, fileName: string, mimeType: string): Promise<ParsedWorkbook> {
  const category = categorizeMimeType(mimeType, fileName);
  if (category !== 'excel') {
    throw new UnsupportedFileTypeError(`File is not a recognized Excel file (mimeType: ${mimeType}).`);
  }

  const isLegacyXls = mimeType === 'application/vnd.ms-excel' || fileName.toLowerCase().endsWith('.xls');

  if (isLegacyXls) {
    // ExcelJS cannot parse the legacy binary .xls (BIFF) format; fall back to SheetJS.
    let wb: XLSX.WorkBook;
    try {
      wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    } catch {
      throw new ValidationError('Failed to parse legacy .xls workbook. The file may be corrupt or unsupported.');
    }
    const sheets = new Map<string, ParsedSheet>();
    for (const sheetName of wb.SheetNames) {
      const ws = wb.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false, defval: null }) as unknown[][];
      const headers = (rows[0] ?? []).map((h) => (h === null || h === undefined ? '' : String(h)));
      const dataRows = rows.slice(1);
      const columnCount = headers.length || Math.max(0, ...dataRows.map((r) => r.length));
      sheets.set(sheetName, { name: sheetName, headers, rows: dataRows, rowCount: dataRows.length, columnCount });
    }
    return { sheetNames: wb.SheetNames, sheets, isLegacyXls: true };
  }

  const workbook = new ExcelJS.Workbook();
  try {
    // exceljs's own .d.ts declares `interface Buffer extends ArrayBuffer {}` at its top,
    // which merges into (and corrupts) the global Buffer type, making it structurally
    // incompatible with the real Node Buffer even though they're identical at runtime.
    await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  } catch {
    throw new ValidationError('Failed to parse .xlsx workbook. The file may be corrupt or unsupported.');
  }

  const sheets = new Map<string, ParsedSheet>();
  const sheetNames: string[] = [];
  workbook.eachSheet((worksheet) => {
    sheetNames.push(worksheet.name);
    const allRows: unknown[][] = [];
    worksheet.eachRow({ includeEmpty: false }, (row) => {
      const values = (row.values as unknown[]).slice(1); // ExcelJS row.values is 1-indexed with a leading empty slot
      allRows.push(values.map((v) => normalizeCellValue(v)));
    });
    const headers = (allRows[0] ?? []).map((h) => (h === null || h === undefined ? '' : String(h)));
    const dataRows = allRows.slice(1);
    const columnCount = worksheet.columnCount || headers.length;
    sheets.set(worksheet.name, {
      name: worksheet.name,
      headers,
      rows: dataRows,
      rowCount: dataRows.length,
      columnCount,
    });
  });

  return { sheetNames, sheets, isLegacyXls: false };
}

export function makeInspectExcelTool(getDrive: () => GoogleDriveClient) {
  return async ({ file_id }: { file_id: string }) => {
    const { buffer, file } = await getDrive().downloadFile(file_id, LIMITS.MAX_PARSE_BYTES);
    const workbook = await parseWorkbook(buffer, file.name, file.mimeType);

    const sheetSummaries = workbook.sheetNames.map((name) => {
      const sheet = workbook.sheets.get(name)!;
      return {
        name,
        headers: sheet.headers,
        rowCount: sheet.rowCount,
        columnCount: sheet.columnCount,
        preview: sheet.rows.slice(0, LIMITS.PREVIEW_ROW_COUNT),
      };
    });

    const payload = {
      file: { id: file.id, name: file.name, mimeType: file.mimeType },
      format: workbook.isLegacyXls ? 'xls' : 'xlsx',
      worksheetCount: workbook.sheetNames.length,
      worksheetNames: workbook.sheetNames,
      worksheets: sheetSummaries,
    };

    return {
      content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
    };
  };
}

function parseA1Range(range: string): { startRow: number; endRow: number; startCol: number; endCol: number } | null {
  const match = /^([A-Za-z]+)(\d+):([A-Za-z]+)(\d+)$/.exec(range.trim());
  if (!match) return null;
  const colToIndex = (col: string) =>
    col
      .toUpperCase()
      .split('')
      .reduce((acc, ch) => acc * 26 + (ch.charCodeAt(0) - 64), 0) - 1;
  const [, colA, rowA, colB, rowB] = match;
  return {
    startCol: colToIndex(colA),
    endCol: colToIndex(colB),
    startRow: Number.parseInt(rowA, 10) - 1,
    endRow: Number.parseInt(rowB, 10) - 1,
  };
}

export function makeReadExcelSheetTool(getDrive: () => GoogleDriveClient) {
  return async (args: { file_id: string; sheet_name: string; range?: string; limit?: number; offset?: number }) => {
    const { buffer, file } = await getDrive().downloadFile(args.file_id, LIMITS.MAX_PARSE_BYTES);
    const workbook = await parseWorkbook(buffer, file.name, file.mimeType);

    const sheet = workbook.sheets.get(args.sheet_name);
    if (!sheet) {
      throw new ValidationError(
        `Worksheet "${args.sheet_name}" was not found. Available worksheets: ${workbook.sheetNames.join(', ')}`,
      );
    }

    let rows = sheet.rows;
    let headers = sheet.headers;

    if (args.range) {
      const parsed = parseA1Range(args.range);
      if (!parsed) {
        throw new ValidationError(`Invalid range "${args.range}". Expected A1-style range like "A1:E20".`);
      }
      const allRows = [headers, ...rows];
      const sliced = allRows
        .slice(parsed.startRow, parsed.endRow + 1)
        .map((row) => row.slice(parsed.startCol, parsed.endCol + 1));
      headers = (sliced[0] ?? []).map((h) => (h === null || h === undefined ? '' : String(h)));
      rows = sliced.slice(1);
    }

    const limit = clampLimit(args.limit, LIMITS.DEFAULT_ROW_LIMIT, LIMITS.MAX_ROW_LIMIT);
    const offset = clampOffset(args.offset);
    const page = rows.slice(offset, offset + limit);

    const payload = {
      file: { id: file.id, name: file.name },
      sheet: args.sheet_name,
      headers,
      totalRows: rows.length,
      returnedRows: page.length,
      offset,
      limit,
      rows: page,
    };

    return {
      content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
    };
  };
}
