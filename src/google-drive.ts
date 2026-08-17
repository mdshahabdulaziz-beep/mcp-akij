import { google, drive_v3 } from 'googleapis';
import type { JWT } from 'google-auth-library';
import { ForbiddenError, NotFoundError, UpstreamApiError, FileTooLargeError } from './utils/errors.js';
import { LIMITS, withTimeout } from './utils/limits.js';
import { GOOGLE_FOLDER_MIME } from './utils/mime-types.js';

export interface DriveFileSummary {
  id: string;
  name: string;
  mimeType: string;
  size: string | null;
  modifiedTime: string | null;
  parents: string[];
}

const FILE_FIELDS = 'id, name, mimeType, size, modifiedTime, parents';
const LIST_FIELDS = `nextPageToken, files(${FILE_FIELDS})`;

/**
 * Thin wrapper around the Google Drive API that enforces every operation stays
 * scoped to a single configured root folder. No method in this class allows
 * escaping that folder, and none of the write endpoints (create/update/delete/
 * permissions) are ever called.
 */
export class GoogleDriveClient {
  private readonly drive: drive_v3.Drive;
  private readonly rootFolderId: string;
  /** Cache of file ids known to live inside the root folder tree, to avoid repeated ancestry walks. */
  private readonly membershipCache = new Map<string, boolean>();

  constructor(authClient: JWT, rootFolderId: string) {
    this.drive = google.drive({ version: 'v3', auth: authClient });
    this.rootFolderId = rootFolderId;
    this.membershipCache.set(rootFolderId, true);
  }

  /**
   * Verifies that a file belongs to the configured folder tree (the root folder
   * itself, or any descendant subfolder). Walks the `parents` chain up to the root,
   * with a depth cap to avoid pathological cycles.
   */
  async assertFileInScope(fileId: string): Promise<DriveFileSummary> {
    const file = await this.getRawMetadata(fileId);
    const inScope = await this.isWithinRoot(file);
    if (!inScope) {
      throw new ForbiddenError(
        `File ${fileId} is outside the configured repository folder and cannot be accessed.`,
      );
    }
    return file;
  }

  private async isWithinRoot(file: DriveFileSummary): Promise<boolean> {
    const cached = this.membershipCache.get(file.id);
    if (cached !== undefined) return cached;

    let current: DriveFileSummary | null = file;
    const visited = new Set<string>();
    const MAX_DEPTH = 32;

    for (let depth = 0; depth < MAX_DEPTH && current; depth += 1) {
      if (visited.has(current.id)) break;
      visited.add(current.id);

      const parents = current.parents ?? [];
      if (parents.includes(this.rootFolderId)) {
        this.membershipCache.set(file.id, true);
        return true;
      }

      const cachedParent = parents.find((p) => this.membershipCache.get(p) === true);
      if (cachedParent) {
        this.membershipCache.set(file.id, true);
        return true;
      }

      if (parents.length === 0) break;

      try {
        current = await this.getRawMetadata(parents[0]);
      } catch {
        current = null;
      }
    }

    this.membershipCache.set(file.id, false);
    return false;
  }

  private async getRawMetadata(fileId: string): Promise<DriveFileSummary> {
    try {
      const res = await withTimeout(
        this.drive.files.get({ fileId, fields: FILE_FIELDS, supportsAllDrives: true }),
        LIMITS.GOOGLE_API_TIMEOUT_MS,
        `Drive files.get(${fileId})`,
      );
      return normalizeFile(res.data);
    } catch (err) {
      throw translateGoogleError(err, fileId);
    }
  }

  /** Lists files directly inside the configured root folder (non-recursive), paginated. */
  async listFiles(opts: { pageSize: number; pageToken?: string }): Promise<{
    files: DriveFileSummary[];
    nextPageToken: string | null;
  }> {
    try {
      const res = await withTimeout(
        this.drive.files.list({
          q: `'${this.rootFolderId}' in parents and trashed = false`,
          fields: LIST_FIELDS,
          pageSize: opts.pageSize,
          pageToken: opts.pageToken,
          supportsAllDrives: true,
          includeItemsFromAllDrives: true,
        }),
        LIMITS.GOOGLE_API_TIMEOUT_MS,
        'Drive files.list',
      );
      const files = (res.data.files ?? []).map(normalizeFile);
      files.forEach((f) => this.membershipCache.set(f.id, true));
      return { files, nextPageToken: res.data.nextPageToken ?? null };
    } catch (err) {
      throw translateGoogleError(err);
    }
  }

  /** Recursively lists every file under the root folder (used by search/grouping tools). Bounded by maxResults. */
  async listAllFilesRecursive(maxResults = 1000): Promise<DriveFileSummary[]> {
    const results: DriveFileSummary[] = [];
    const queue: string[] = [this.rootFolderId];
    const seenFolders = new Set<string>();

    while (queue.length > 0 && results.length < maxResults) {
      const folderId = queue.shift()!;
      if (seenFolders.has(folderId)) continue;
      seenFolders.add(folderId);

      let pageToken: string | undefined;
      do {
        const res = await withTimeout(
          this.drive.files.list({
            q: `'${folderId}' in parents and trashed = false`,
            fields: LIST_FIELDS,
            pageSize: 200,
            pageToken,
            supportsAllDrives: true,
            includeItemsFromAllDrives: true,
          }),
          LIMITS.GOOGLE_API_TIMEOUT_MS,
          'Drive files.list (recursive)',
        ).catch((err) => {
          throw translateGoogleError(err);
        });

        for (const raw of res.data.files ?? []) {
          const file = normalizeFile(raw);
          this.membershipCache.set(file.id, true);
          if (file.mimeType === GOOGLE_FOLDER_MIME) {
            queue.push(file.id);
          } else {
            results.push(file);
          }
          if (results.length >= maxResults) break;
        }
        pageToken = res.data.nextPageToken ?? undefined;
      } while (pageToken && results.length < maxResults);
    }

    return results;
  }

  /** Searches by name within the configured folder tree. */
  async searchFiles(query: string, opts: { pageSize: number; pageToken?: string }): Promise<{
    files: DriveFileSummary[];
    nextPageToken: string | null;
  }> {
    const sanitized = query.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    try {
      const res = await withTimeout(
        this.drive.files.list({
          q: `'${this.rootFolderId}' in parents and trashed = false and (name contains '${sanitized}' or fullText contains '${sanitized}')`,
          fields: LIST_FIELDS,
          pageSize: opts.pageSize,
          pageToken: opts.pageToken,
          supportsAllDrives: true,
          includeItemsFromAllDrives: true,
        }),
        LIMITS.GOOGLE_API_TIMEOUT_MS,
        'Drive files.list (search)',
      );
      const files = (res.data.files ?? []).map(normalizeFile);
      files.forEach((f) => this.membershipCache.set(f.id, true));
      return { files, nextPageToken: res.data.nextPageToken ?? null };
    } catch (err) {
      throw translateGoogleError(err);
    }
  }

  async getMetadata(fileId: string): Promise<DriveFileSummary> {
    return this.assertFileInScope(fileId);
  }

  /** Downloads binary/text file content, enforcing the folder scope and a max byte size. */
  async downloadFile(fileId: string, maxBytes = LIMITS.MAX_DOWNLOAD_BYTES): Promise<{ buffer: Buffer; file: DriveFileSummary }> {
    const file = await this.assertFileInScope(fileId);

    if (file.size && Number.parseInt(file.size, 10) > maxBytes) {
      throw new FileTooLargeError(
        `File ${fileId} is ${file.size} bytes, which exceeds the ${maxBytes} byte limit for this operation.`,
      );
    }

    try {
      const res = await withTimeout(
        this.drive.files.get(
          { fileId, alt: 'media', supportsAllDrives: true },
          { responseType: 'arraybuffer' },
        ),
        LIMITS.GOOGLE_API_TIMEOUT_MS,
        `Drive files.get(alt=media, ${fileId})`,
      );
      const buffer = Buffer.from(res.data as ArrayBuffer);
      if (buffer.byteLength > maxBytes) {
        throw new FileTooLargeError(
          `File ${fileId} downloaded content exceeds the ${maxBytes} byte limit.`,
        );
      }
      return { buffer, file };
    } catch (err) {
      if (err instanceof FileTooLargeError) throw err;
      throw translateGoogleError(err, fileId);
    }
  }

  /** Exports a native Google Workspace file (Docs/Sheets/Slides) to a portable format. */
  async exportFile(fileId: string, mimeType: string): Promise<{ buffer: Buffer; file: DriveFileSummary }> {
    const file = await this.assertFileInScope(fileId);
    try {
      const res = await withTimeout(
        this.drive.files.export({ fileId, mimeType }, { responseType: 'arraybuffer' }),
        LIMITS.GOOGLE_API_TIMEOUT_MS,
        `Drive files.export(${fileId})`,
      );
      return { buffer: Buffer.from(res.data as ArrayBuffer), file };
    } catch (err) {
      throw translateGoogleError(err, fileId);
    }
  }
}

function normalizeFile(raw: drive_v3.Schema$File): DriveFileSummary {
  return {
    id: raw.id ?? '',
    name: raw.name ?? '(unnamed)',
    mimeType: raw.mimeType ?? 'application/octet-stream',
    size: raw.size ?? null,
    modifiedTime: raw.modifiedTime ?? null,
    parents: raw.parents ?? [],
  };
}

function translateGoogleError(err: unknown, fileId?: string): Error {
  const anyErr = err as { code?: number; response?: { status?: number } };
  const status = anyErr?.code ?? anyErr?.response?.status;

  if (status === 404) {
    return new NotFoundError(fileId ? `File ${fileId} was not found.` : 'Requested Drive resource was not found.');
  }
  if (status === 403) {
    return new ForbiddenError('The service account does not have permission to access this Drive resource.');
  }
  if (status === 429) {
    return new UpstreamApiError('Google Drive API rate limit exceeded. Please retry shortly.');
  }
  if (err instanceof Error && err.message.includes('timed out')) {
    return new UpstreamApiError(err.message);
  }
  return new UpstreamApiError('Google Drive API request failed.');
}
