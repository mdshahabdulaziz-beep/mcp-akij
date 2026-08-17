import { describe, it, expect } from '@jest/globals';
import type { GoogleDriveClient, DriveFileSummary } from '../src/google-drive.js';
import { makeReadCsvTool } from '../src/tools/csv.js';

function fakeFile(overrides: Partial<DriveFileSummary> = {}): DriveFileSummary {
  return {
    id: 'csv1',
    name: 'employees.csv',
    mimeType: 'text/csv',
    size: '100',
    modifiedTime: null,
    parents: ['root'],
    ...overrides,
  };
}

function fakeDriveWithBuffer(buffer: Buffer, file: DriveFileSummary): GoogleDriveClient {
  return {
    downloadFile: async () => ({ buffer, file }),
  } as unknown as GoogleDriveClient;
}

describe('read_csv', () => {
  const CSV_CONTENT = 'Name,Department,Salary\nAlice,Engineering,90000\nBob,Sales,70000\n';

  it('parses headers and structured rows', async () => {
    const drive = fakeDriveWithBuffer(Buffer.from(CSV_CONTENT), fakeFile());
    const tool = makeReadCsvTool(() => drive);

    const result = await tool({ file_id: 'csv1' });
    const payload = JSON.parse(result.content[0].text as string);

    expect(payload.headers).toEqual(['Name', 'Department', 'Salary']);
    expect(payload.totalRows).toBe(2);
    expect(payload.rows[0]).toEqual({ Name: 'Alice', Department: 'Engineering', Salary: '90000' });
  });

  it('respects limit and offset', async () => {
    const drive = fakeDriveWithBuffer(Buffer.from(CSV_CONTENT), fakeFile());
    const tool = makeReadCsvTool(() => drive);

    const result = await tool({ file_id: 'csv1', limit: 1, offset: 1 });
    const payload = JSON.parse(result.content[0].text as string);

    expect(payload.returnedRows).toBe(1);
    expect(payload.rows[0].Name).toBe('Bob');
  });

  it('rejects non-CSV files', async () => {
    const drive = fakeDriveWithBuffer(Buffer.from('not csv'), fakeFile({ mimeType: 'application/pdf', name: 'doc.pdf' }));
    const tool = makeReadCsvTool(() => drive);
    await expect(tool({ file_id: 'csv1' })).rejects.toThrow(/not a recognized CSV/);
  });
});
