import { PDFParse } from 'pdf-parse';
import { z } from 'zod';
import type { GoogleDriveClient } from '../google-drive.js';
import { ValidationError, UnsupportedFileTypeError } from '../utils/errors.js';
import { LIMITS, truncateText } from '../utils/limits.js';
import { categorizeMimeType } from '../utils/mime-types.js';

export const extractPdfTextInputSchema = {
  file_id: z.string().min(1).describe('The Google Drive file ID of the PDF file.'),
};

export function makeExtractPdfTextTool(getDrive: () => GoogleDriveClient) {
  return async ({ file_id }: { file_id: string }) => {
    const { buffer, file } = await getDrive().downloadFile(file_id, LIMITS.MAX_PARSE_BYTES);

    const category = categorizeMimeType(file.mimeType, file.name);
    if (category !== 'pdf') {
      throw new UnsupportedFileTypeError(`File is not a recognized PDF file (mimeType: ${file.mimeType}).`);
    }

    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    try {
      const result = await parser.getText();
      const { text, truncated } = truncateText(result.text ?? '');

      const payload = {
        file: { id: file.id, name: file.name },
        pageCount: result.pages.length,
        truncated,
        text,
      };

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
      };
    } catch (err) {
      throw new ValidationError(`Failed to extract PDF text: ${err instanceof Error ? err.message : 'unknown error'}`);
    } finally {
      await parser.destroy();
    }
  };
}
