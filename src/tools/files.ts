import { z } from 'zod';
import type { GoogleDriveClient, DriveFileSummary } from '../google-drive.js';
import { UnsupportedFileTypeError } from '../utils/errors.js';
import { LIMITS, clampLimit, truncateText } from '../utils/limits.js';
import { categorizeMimeType, type FileCategory } from '../utils/mime-types.js';

export const listFilesInputSchema = {
  limit: z.number().int().positive().optional().describe(`Max number of files to return per page (default ${LIMITS.DEFAULT_PAGE_SIZE}, max ${LIMITS.MAX_PAGE_SIZE}).`),
  page_token: z.string().optional().describe('Pagination token returned by a previous call, used to fetch the next page.'),
};

export const getFileMetadataInputSchema = {
  file_id: z.string().min(1).describe('The Google Drive file ID.'),
};

export const getFileContentInputSchema = {
  file_id: z.string().min(1).describe('The Google Drive file ID.'),
};

export const listSupportedFilesInputSchema = {
  limit: z.number().int().positive().optional().describe('Max number of files to scan when grouping (default 1000).'),
};

function summarize(file: DriveFileSummary) {
  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    size: file.size,
    modifiedTime: file.modifiedTime,
  };
}

export function makeListFilesTool(getDrive: () => GoogleDriveClient) {
  return async (args: { limit?: number; page_token?: string }) => {
    const pageSize = clampLimit(args.limit, LIMITS.DEFAULT_PAGE_SIZE, LIMITS.MAX_PAGE_SIZE);
    const { files, nextPageToken } = await getDrive().listFiles({ pageSize, pageToken: args.page_token });

    const payload = {
      files: files.map(summarize),
      count: files.length,
      nextPageToken,
    };

    return {
      content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
    };
  };
}

export function makeGetFileMetadataTool(getDrive: () => GoogleDriveClient) {
  return async ({ file_id }: { file_id: string }) => {
    const file = await getDrive().getMetadata(file_id);
    const payload = {
      ...summarize(file),
      category: categorizeMimeType(file.mimeType, file.name),
      parents: file.parents,
    };
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
    };
  };
}

const GOOGLE_EXPORT_MIME: Partial<Record<FileCategory, string>> = {
  'google-doc': 'text/plain',
  'google-slide': 'text/plain',
  'google-sheet': 'text/csv',
};

export function makeGetFileContentTool(getDrive: () => GoogleDriveClient) {
  return async ({ file_id }: { file_id: string }) => {
    const drive = getDrive();
    const meta = await drive.getMetadata(file_id);
    const category = categorizeMimeType(meta.mimeType, meta.name);

    if (category === 'txt' || category === 'csv') {
      const { buffer, file } = await drive.downloadFile(file_id, LIMITS.MAX_PARSE_BYTES);
      const { text, truncated } = truncateText(buffer.toString('utf-8'));
      const payload = { file: summarize(file), category, truncated, content: text };
      return { content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }] };
    }

    if (category === 'image') {
      const { buffer, file } = await drive.downloadFile(file_id, 8 * 1024 * 1024);
      return {
        content: [
          { type: 'text' as const, text: JSON.stringify({ file: summarize(file), category }, null, 2) },
          { type: 'image' as const, data: buffer.toString('base64'), mimeType: file.mimeType },
        ],
      };
    }

    const exportMime = GOOGLE_EXPORT_MIME[category];
    if (exportMime) {
      const { buffer, file } = await drive.exportFile(file_id, exportMime);
      const { text, truncated } = truncateText(buffer.toString('utf-8'));
      const payload = { file: summarize(file), category, exportedAs: exportMime, truncated, content: text };
      return { content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }] };
    }

    if (category === 'excel' || category === 'pdf' || category === 'docx') {
      const toolName = category === 'excel' ? 'inspect_excel / read_excel_sheet' : category === 'pdf' ? 'extract_pdf_text' : 'extract_docx_text';
      const payload = {
        file: summarize(meta),
        category,
        message: `This file type requires structured extraction. Use the ${toolName} tool instead of get_file_content.`,
      };
      return { content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }] };
    }

    throw new UnsupportedFileTypeError(
      `get_file_content does not support files of type "${meta.mimeType}". Category: ${category}.`,
    );
  };
}

export function makeListSupportedFilesTool(getDrive: () => GoogleDriveClient) {
  return async (args: { limit?: number }) => {
    const maxResults = clampLimit(args.limit, 1000, 5000);
    const files = await getDrive().listAllFilesRecursive(maxResults);

    const groups: Record<FileCategory, ReturnType<typeof summarize>[]> = {
      excel: [],
      csv: [],
      pdf: [],
      docx: [],
      txt: [],
      image: [],
      'google-doc': [],
      'google-sheet': [],
      'google-slide': [],
      other: [],
    };

    for (const file of files) {
      const category = categorizeMimeType(file.mimeType, file.name);
      groups[category].push(summarize(file));
    }

    const payload = {
      totalScanned: files.length,
      groups: {
        Excel: groups.excel,
        CSV: groups.csv,
        PDF: groups.pdf,
        DOCX: groups.docx,
        TXT: groups.txt,
        Images: groups.image,
        GoogleDocs: groups['google-doc'],
        GoogleSheets: groups['google-sheet'],
        GoogleSlides: groups['google-slide'],
        Other: groups.other,
      },
      counts: Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, v.length])),
    };

    return {
      content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
    };
  };
}
