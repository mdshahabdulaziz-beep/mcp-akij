import { z } from 'zod';
import type { GoogleDriveClient, DriveFileSummary } from '../google-drive.js';
import { LIMITS, clampLimit } from '../utils/limits.js';
import { categorizeMimeType } from '../utils/mime-types.js';

export const searchFilesInputSchema = {
  query: z.string().min(1).describe('Text to search for in file names and content within the configured repository.'),
  limit: z.number().int().positive().optional().describe(`Max number of results per page (default ${LIMITS.DEFAULT_PAGE_SIZE}, max ${LIMITS.MAX_PAGE_SIZE}).`),
  page_token: z.string().optional().describe('Pagination token returned by a previous call.'),
};

export const searchRepositoryInputSchema = {
  query: z.string().min(1).describe('Text to search for across the entire configured repository.'),
  limit: z.number().int().positive().optional().describe('Max number of matching files to return (default 50, max 200).'),
};

function summarize(file: DriveFileSummary) {
  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    category: categorizeMimeType(file.mimeType, file.name),
    size: file.size,
    modifiedTime: file.modifiedTime,
  };
}

export function makeSearchFilesTool(getDrive: () => GoogleDriveClient) {
  return async (args: { query: string; limit?: number; page_token?: string }) => {
    const pageSize = clampLimit(args.limit, LIMITS.DEFAULT_PAGE_SIZE, LIMITS.MAX_PAGE_SIZE);
    const { files, nextPageToken } = await getDrive().searchFiles(args.query, {
      pageSize,
      pageToken: args.page_token,
    });

    const payload = {
      query: args.query,
      files: files.map(summarize),
      count: files.length,
      nextPageToken,
    };

    return {
      content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
    };
  };
}

/**
 * search_repository differs from search_files by walking the full folder tree
 * (search_files only searches the Drive API's own index, which for shared/service-account
 * contexts can miss nested subfolders depending on corpora settings) and matching
 * case-insensitively against file names client-side as a fallback, guaranteeing results
 * are always confined to files actually present under the configured root.
 */
export function makeSearchRepositoryTool(getDrive: () => GoogleDriveClient) {
  return async (args: { query: string; limit?: number }) => {
    const limit = clampLimit(args.limit, 50, 200);
    const drive = getDrive();

    const [apiResults, allFiles] = await Promise.all([
      drive.searchFiles(args.query, { pageSize: limit }),
      drive.listAllFilesRecursive(2000),
    ]);

    const lowerQuery = args.query.toLowerCase();
    const nameMatches = allFiles.filter((f) => f.name.toLowerCase().includes(lowerQuery));

    const merged = new Map<string, DriveFileSummary>();
    for (const f of apiResults.files) merged.set(f.id, f);
    for (const f of nameMatches) merged.set(f.id, f);

    const results = Array.from(merged.values()).slice(0, limit);

    const payload = {
      query: args.query,
      matchCount: results.length,
      files: results.map(summarize),
      note: 'Metadata and file listings only; no file content is inferred or fabricated.',
    };

    return {
      content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
    };
  };
}
