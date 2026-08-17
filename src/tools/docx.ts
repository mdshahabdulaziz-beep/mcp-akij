import mammoth from 'mammoth';
import { z } from 'zod';
import type { GoogleDriveClient } from '../google-drive.js';
import { ValidationError, UnsupportedFileTypeError } from '../utils/errors.js';
import { LIMITS, truncateText } from '../utils/limits.js';
import { categorizeMimeType } from '../utils/mime-types.js';

export const extractDocxTextInputSchema = {
  file_id: z.string().min(1).describe('The Google Drive file ID of the DOCX file.'),
};

export function makeExtractDocxTextTool(getDrive: () => GoogleDriveClient) {
  return async ({ file_id }: { file_id: string }) => {
    const { buffer, file } = await getDrive().downloadFile(file_id, LIMITS.MAX_PARSE_BYTES);

    const category = categorizeMimeType(file.mimeType, file.name);
    if (category !== 'docx') {
      throw new UnsupportedFileTypeError(`File is not a recognized DOCX file (mimeType: ${file.mimeType}).`);
    }

    let extracted: { value: string };
    try {
      extracted = await mammoth.extractRawText({ buffer });
    } catch (err) {
      throw new ValidationError(`Failed to extract DOCX text: ${err instanceof Error ? err.message : 'unknown error'}`);
    }

    const { text, truncated } = truncateText(extracted.value ?? '');

    const payload = {
      file: { id: file.id, name: file.name },
      truncated,
      text,
    };

    return {
      content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
    };
  };
}
