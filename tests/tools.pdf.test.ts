import { describe, it, expect } from '@jest/globals';
import type { GoogleDriveClient, DriveFileSummary } from '../src/google-drive.js';
import { makeExtractPdfTextTool } from '../src/tools/pdf.js';
import { buildMinimalPdf } from './fixtures/pdf.js';

function fakeFile(overrides: Partial<DriveFileSummary> = {}): DriveFileSummary {
  return {
    id: 'pdf1',
    name: 'report.pdf',
    mimeType: 'application/pdf',
    size: '500',
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

describe('extract_pdf_text', () => {
  it('extracts text from a valid PDF', async () => {
    const pdf = buildMinimalPdf('Hello Test PDF');
    const drive = fakeDriveWithBuffer(pdf, fakeFile());
    const tool = makeExtractPdfTextTool(() => drive);

    const result = await tool({ file_id: 'pdf1' });
    const payload = JSON.parse(result.content[0].text as string);

    expect(payload.pageCount).toBe(1);
    expect(payload.text).toContain('Hello Test PDF');
  });

  it('rejects non-PDF files', async () => {
    const drive = fakeDriveWithBuffer(Buffer.from('not a pdf'), fakeFile({ mimeType: 'text/plain', name: 'notes.txt' }));
    const tool = makeExtractPdfTextTool(() => drive);
    await expect(tool({ file_id: 'pdf1' })).rejects.toThrow(/not a recognized PDF/);
  });

  it('throws a validation error for a corrupt PDF', async () => {
    const drive = fakeDriveWithBuffer(Buffer.from('%PDF-1.4 not really a pdf'), fakeFile());
    const tool = makeExtractPdfTextTool(() => drive);
    await expect(tool({ file_id: 'pdf1' })).rejects.toThrow();
  });
});
