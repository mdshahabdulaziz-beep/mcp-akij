import { describe, it, expect } from '@jest/globals';
import type { GoogleDriveClient, DriveFileSummary } from '../src/google-drive.js';
import { makeListFilesTool, makeGetFileMetadataTool, makeListSupportedFilesTool } from '../src/tools/files.js';
import { makeSearchRepositoryTool } from '../src/tools/search.js';

function file(id: string, name: string, mimeType: string): DriveFileSummary {
  return { id, name, mimeType, size: '10', modifiedTime: '2026-01-01T00:00:00Z', parents: ['root'] };
}

const SAMPLE_FILES = [
  file('1', 'payroll.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
  file('2', 'headcount.csv', 'text/csv'),
  file('3', 'policy.pdf', 'application/pdf'),
  file('4', 'offer_letter.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
  file('5', 'notes.txt', 'text/plain'),
  file('6', 'photo.jpg', 'image/jpeg'),
  file('7', 'mystery.bin', 'application/octet-stream'),
];

describe('list_files', () => {
  it('returns summarized files and pagination token', async () => {
    const drive = {
      listFiles: async () => ({ files: SAMPLE_FILES.slice(0, 2), nextPageToken: 'abc' }),
    } as unknown as GoogleDriveClient;

    const tool = makeListFilesTool(() => drive);
    const result = await tool({});
    const payload = JSON.parse(result.content[0].text as string);

    expect(payload.count).toBe(2);
    expect(payload.nextPageToken).toBe('abc');
    expect(payload.files[0]).not.toHaveProperty('parents');
  });
});

describe('get_file_metadata', () => {
  it('returns metadata with category and rejects out-of-scope files via the drive client', async () => {
    const drive = {
      getMetadata: async (id: string) => {
        if (id !== '1') throw new Error('Forbidden: outside repository');
        return SAMPLE_FILES[0];
      },
    } as unknown as GoogleDriveClient;

    const tool = makeGetFileMetadataTool(() => drive);
    const result = await tool({ file_id: '1' });
    const payload = JSON.parse(result.content[0].text as string);
    expect(payload.category).toBe('excel');

    await expect(tool({ file_id: 'outside' })).rejects.toThrow(/Forbidden/);
  });
});

describe('list_supported_files', () => {
  it('groups files into the correct categories', async () => {
    const drive = {
      listAllFilesRecursive: async () => SAMPLE_FILES,
    } as unknown as GoogleDriveClient;

    const tool = makeListSupportedFilesTool(() => drive);
    const result = await tool({});
    const payload = JSON.parse(result.content[0].text as string);

    expect(payload.groups.Excel).toHaveLength(1);
    expect(payload.groups.CSV).toHaveLength(1);
    expect(payload.groups.PDF).toHaveLength(1);
    expect(payload.groups.DOCX).toHaveLength(1);
    expect(payload.groups.TXT).toHaveLength(1);
    expect(payload.groups.Images).toHaveLength(1);
    expect(payload.groups.Other).toHaveLength(1);
    expect(payload.totalScanned).toBe(7);
  });
});

describe('search_repository', () => {
  it('merges API search results with recursive name matches, deduplicated, and never fabricates content', async () => {
    const drive = {
      searchFiles: async () => ({ files: [SAMPLE_FILES[0]], nextPageToken: null }),
      listAllFilesRecursive: async () => SAMPLE_FILES,
    } as unknown as GoogleDriveClient;

    const tool = makeSearchRepositoryTool(() => drive);
    const result = await tool({ query: 'payroll' });
    const payload = JSON.parse(result.content[0].text as string);

    expect(payload.matchCount).toBe(1);
    expect(payload.files[0].id).toBe('1');
    expect(payload.note).toMatch(/no file content is inferred/i);
  });
});
