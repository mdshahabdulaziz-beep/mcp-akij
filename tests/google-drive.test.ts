import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const filesGet = jest.fn();
const filesList = jest.fn();
const filesExport = jest.fn();

jest.unstable_mockModule('googleapis', () => ({
  google: {
    drive: jest.fn(() => ({
      files: {
        get: filesGet,
        list: filesList,
        export: filesExport,
      },
    })),
  },
}));

const { GoogleDriveClient } = await import('../src/google-drive.js');

const ROOT_FOLDER = 'root-folder-id';
const fakeAuth = {} as never;

describe('GoogleDriveClient', () => {
  beforeEach(() => {
    filesGet.mockReset();
    filesList.mockReset();
    filesExport.mockReset();
  });

  it('lists files directly inside the configured root folder', async () => {
    filesList.mockResolvedValueOnce({
      data: {
        files: [
          { id: 'f1', name: 'a.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size: '100', modifiedTime: '2026-01-01T00:00:00Z', parents: [ROOT_FOLDER] },
        ],
        nextPageToken: null,
      },
    });

    const client = new GoogleDriveClient(fakeAuth, ROOT_FOLDER);
    const result = await client.listFiles({ pageSize: 50 });

    expect(result.files).toHaveLength(1);
    expect(result.files[0].id).toBe('f1');
    expect(filesList).toHaveBeenCalledWith(
      expect.objectContaining({ q: expect.stringContaining(ROOT_FOLDER) }),
    );
  });

  it('allows access to a file directly inside the root folder', async () => {
    filesGet.mockResolvedValueOnce({
      data: { id: 'f1', name: 'a.txt', mimeType: 'text/plain', size: '10', modifiedTime: null, parents: [ROOT_FOLDER] },
    });

    const client = new GoogleDriveClient(fakeAuth, ROOT_FOLDER);
    const meta = await client.getMetadata('f1');
    expect(meta.id).toBe('f1');
  });

  it('rejects access to a file outside the configured folder tree', async () => {
    filesGet.mockResolvedValueOnce({
      data: { id: 'outside1', name: 'secret.txt', mimeType: 'text/plain', size: '10', modifiedTime: null, parents: ['some-other-folder'] },
    });
    // Ancestry walk: fetching the parent folder, which has no parents (reached the top without finding root).
    filesGet.mockResolvedValueOnce({
      data: { id: 'some-other-folder', name: 'Other Folder', mimeType: 'application/vnd.google-apps.folder', size: null, modifiedTime: null, parents: [] },
    });

    const client = new GoogleDriveClient(fakeAuth, ROOT_FOLDER);
    await expect(client.getMetadata('outside1')).rejects.toThrow(/outside the configured repository/);
  });

  it('allows access to a file nested in a subfolder of the root', async () => {
    filesGet.mockResolvedValueOnce({
      data: { id: 'nested1', name: 'deep.txt', mimeType: 'text/plain', size: '5', modifiedTime: null, parents: ['subfolder1'] },
    });
    filesGet.mockResolvedValueOnce({
      data: { id: 'subfolder1', name: 'Sub', mimeType: 'application/vnd.google-apps.folder', size: null, modifiedTime: null, parents: [ROOT_FOLDER] },
    });

    const client = new GoogleDriveClient(fakeAuth, ROOT_FOLDER);
    const meta = await client.getMetadata('nested1');
    expect(meta.id).toBe('nested1');
  });

  it('translates a 404 from the Drive API into a NotFoundError', async () => {
    filesGet.mockRejectedValueOnce({ code: 404 });
    const client = new GoogleDriveClient(fakeAuth, ROOT_FOLDER);
    await expect(client.getMetadata('missing')).rejects.toThrow(/not found/i);
  });

  it('enforces the max byte size when downloading a file', async () => {
    filesGet.mockResolvedValueOnce({
      data: { id: 'big1', name: 'big.csv', mimeType: 'text/csv', size: '99999999', modifiedTime: null, parents: [ROOT_FOLDER] },
    });

    const client = new GoogleDriveClient(fakeAuth, ROOT_FOLDER);
    await expect(client.downloadFile('big1', 1000)).rejects.toThrow(/exceeds/i);
  });

  it('downloads file content within limits', async () => {
    filesGet.mockResolvedValueOnce({
      data: { id: 'small1', name: 'small.csv', mimeType: 'text/csv', size: '5', modifiedTime: null, parents: [ROOT_FOLDER] },
    });
    const buf = Buffer.from('a,b\n1,2');
    filesGet.mockResolvedValueOnce({ data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) });

    const client = new GoogleDriveClient(fakeAuth, ROOT_FOLDER);
    const { buffer, file } = await client.downloadFile('small1', 1000);
    expect(file.id).toBe('small1');
    expect(buffer.toString('utf-8')).toContain('a,b');
  });
});
