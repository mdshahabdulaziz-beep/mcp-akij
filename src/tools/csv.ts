import { parse } from 'csv-parse/sync';
import { z } from 'zod';
import type { GoogleDriveClient } from '../google-drive.js';
import { ValidationError, UnsupportedFileTypeError } from '../utils/errors.js';
import { LIMITS, clampLimit, clampOffset } from '../utils/limits.js';
import { categorizeMimeType } from '../utils/mime-types.js';

export const readCsvInputSchema = {
  file_id: z.string().min(1).describe('The Google Drive file ID of the CSV file.'),
  limit: z.number().int().positive().optional().describe(`Max rows to return (default ${LIMITS.DEFAULT_ROW_LIMIT}, max ${LIMITS.MAX_ROW_LIMIT}).`),
  offset: z.number().int().nonnegative().optional().describe('Number of data rows to skip before returning results (default 0).'),
};

export function makeReadCsvTool(getDrive: () => GoogleDriveClient) {
  return async (args: { file_id: string; limit?: number; offset?: number }) => {
    const { buffer, file } = await getDrive().downloadFile(args.file_id, LIMITS.MAX_PARSE_BYTES);

    const category = categorizeMimeType(file.mimeType, file.name);
    if (category !== 'csv') {
      throw new UnsupportedFileTypeError(`File is not a recognized CSV file (mimeType: ${file.mimeType}).`);
    }

    let records: string[][];
    try {
      records = parse(buffer, {
        skip_empty_lines: true,
        relax_column_count: true,
        bom: true,
      }) as string[][];
    } catch (err) {
      throw new ValidationError(`Failed to parse CSV file: ${err instanceof Error ? err.message : 'unknown error'}`);
    }

    const headers = records[0] ?? [];
    const dataRows = records.slice(1);

    const limit = clampLimit(args.limit, LIMITS.DEFAULT_ROW_LIMIT, LIMITS.MAX_ROW_LIMIT);
    const offset = clampOffset(args.offset);
    const page = dataRows.slice(offset, offset + limit);

    const structuredRows = page.map((row) =>
      Object.fromEntries(headers.map((h, idx) => [h || `column_${idx + 1}`, row[idx] ?? null])),
    );

    const payload = {
      file: { id: file.id, name: file.name },
      headers,
      totalRows: dataRows.length,
      returnedRows: page.length,
      offset,
      limit,
      preview: page.slice(0, LIMITS.PREVIEW_ROW_COUNT),
      rows: structuredRows,
    };

    return {
      content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
    };
  };
}
