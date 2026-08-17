import { describe, it, expect } from '@jest/globals';
import type { GoogleDriveClient, DriveFileSummary } from '../src/google-drive.js';
import { makeExtractDocxTextTool } from '../src/tools/docx.js';
import { buildMinimalDocx } from './fixtures/docx.js';

function fakeFile(overrides: Partial<DriveFileSummary> = {}): DriveFileSummary {
  return {
    id: 'docx1',
    name: 'policy.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
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

describe('extract_docx_text', () => {
  it('extracts text from a valid DOCX', async () => {
    const docx = await buildMinimalDocx('Hello Test DOCX');
    const drive = fakeDriveWithBuffer(docx, fakeFile());
    const tool = makeExtractDocxTextTool(() => drive);

    const result = await tool({ file_id: 'docx1' });
    const payload = JSON.parse(result.content[0].text as string);

    expect(payload.text).toContain('Hello Test DOCX');
  });

  it('rejects non-DOCX files', async () => {
    const drive = fakeDriveWithBuffer(Buffer.from('not a docx'), fakeFile({ mimeType: 'text/plain', name: 'notes.txt' }));
    const tool = makeExtractDocxTextTool(() => drive);
    await expect(tool({ file_id: 'docx1' })).rejects.toThrow(/not a recognized DOCX/);
  });
});
