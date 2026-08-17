import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { GoogleDriveClient } from './google-drive.js';
import { LIMITS, clampLimit } from './utils/limits.js';
import { toSafeErrorMessage } from './utils/errors.js';

import {
  listFilesInputSchema,
  getFileMetadataInputSchema,
  getFileContentInputSchema,
  listSupportedFilesInputSchema,
  makeListFilesTool,
  makeGetFileMetadataTool,
  makeGetFileContentTool,
  makeListSupportedFilesTool,
} from './tools/files.js';
import {
  searchFilesInputSchema,
  searchRepositoryInputSchema,
  makeSearchFilesTool,
  makeSearchRepositoryTool,
} from './tools/search.js';
import { inspectExcelInputSchema, readExcelSheetInputSchema, makeInspectExcelTool, makeReadExcelSheetTool } from './tools/excel.js';
import { readCsvInputSchema, makeReadCsvTool } from './tools/csv.js';
import { extractPdfTextInputSchema, makeExtractPdfTextTool } from './tools/pdf.js';
import { extractDocxTextInputSchema, makeExtractDocxTextTool } from './tools/docx.js';

type ToolContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string };

type ToolHandler<Args> = (args: Args) => Promise<{ content: ToolContentBlock[] }>;

/**
 * Wraps a tool handler so thrown AppErrors (and unexpected errors) become MCP
 * tool-error results instead of uncaught exceptions, and so nothing about the
 * underlying failure (stack traces, credential material, raw upstream bodies) leaks out.
 */
function wrap<Args>(handler: ToolHandler<Args>) {
  return async (args: Args) => {
    try {
      return await handler(args);
    } catch (err) {
      const { message, code } = toSafeErrorMessage(err);
      return {
        isError: true,
        content: [{ type: 'text' as const, text: JSON.stringify({ error: { code, message } }, null, 2) }],
      };
    }
  };
}

export function createMcpServer(getDrive: () => GoogleDriveClient): McpServer {
  const server = new McpServer(
    { name: 'akij-hr-data-mcp', version: '1.0.0' },
    {
      capabilities: { tools: {} },
      instructions:
        'Read-only access to the AKIJ HR DATA Google Drive repository. All operations are restricted to the ' +
        'configured folder tree. Use list_supported_files or search_repository to discover files, then the ' +
        'type-specific tools (inspect_excel, read_excel_sheet, read_csv, extract_pdf_text, extract_docx_text) ' +
        'to read their contents. Never fabricate file content that was not actually retrieved.',
    },
  );

  server.registerTool(
    'list_files',
    {
      title: 'List Files',
      description: 'List files directly inside the configured Drive repository folder, with pagination.',
      inputSchema: listFilesInputSchema,
    },
    wrap(makeListFilesTool(getDrive)),
  );

  server.registerTool(
    'search_files',
    {
      title: 'Search Files',
      description: 'Search for files by name/content within the configured Drive repository.',
      inputSchema: searchFilesInputSchema,
    },
    wrap(makeSearchFilesTool(getDrive)),
  );

  server.registerTool(
    'get_file_metadata',
    {
      title: 'Get File Metadata',
      description: 'Get metadata for a single file. Verifies the file belongs to the configured repository before returning anything.',
      inputSchema: getFileMetadataInputSchema,
    },
    wrap(makeGetFileMetadataTool(getDrive)),
  );

  server.registerTool(
    'get_file_content',
    {
      title: 'Get File Content',
      description:
        'Retrieve content for a supported file (TXT, CSV, images, Google Docs/Sheets/Slides). For Excel/PDF/DOCX, use the dedicated extraction tools. Size-limited.',
      inputSchema: getFileContentInputSchema,
    },
    wrap(makeGetFileContentTool(getDrive)),
  );

  server.registerTool(
    'list_supported_files',
    {
      title: 'List Supported Files',
      description: 'Recursively list all files in the repository, grouped by category: Excel, CSV, PDF, DOCX, TXT, Images, Other.',
      inputSchema: listSupportedFilesInputSchema,
    },
    wrap(makeListSupportedFilesTool(getDrive)),
  );

  server.registerTool(
    'inspect_excel',
    {
      title: 'Inspect Excel Workbook',
      description:
        'Inspect an Excel workbook (.xlsx or .xls): worksheet names, headers, row/column counts, and a limited preview per sheet. Does not return the full workbook.',
      inputSchema: inspectExcelInputSchema,
    },
    wrap(makeInspectExcelTool(getDrive)),
  );

  server.registerTool(
    'read_excel_sheet',
    {
      title: 'Read Excel Sheet',
      description: 'Read structured rows from a specific worksheet, with optional A1 range, limit, and offset.',
      inputSchema: readExcelSheetInputSchema,
    },
    wrap(makeReadExcelSheetTool(getDrive)),
  );

  server.registerTool(
    'read_csv',
    {
      title: 'Read CSV',
      description: 'Read a CSV file: headers, row count, a limited preview, and structured rows (paginated).',
      inputSchema: readCsvInputSchema,
    },
    wrap(makeReadCsvTool(getDrive)),
  );

  server.registerTool(
    'extract_pdf_text',
    {
      title: 'Extract PDF Text',
      description: 'Extract readable text from a PDF file, with sensible output limits.',
      inputSchema: extractPdfTextInputSchema,
    },
    wrap(makeExtractPdfTextTool(getDrive)),
  );

  server.registerTool(
    'extract_docx_text',
    {
      title: 'Extract DOCX Text',
      description: 'Extract readable text from a DOCX file, with sensible output limits.',
      inputSchema: extractDocxTextInputSchema,
    },
    wrap(makeExtractDocxTextTool(getDrive)),
  );

  server.registerTool(
    'search_repository',
    {
      title: 'Search Repository',
      description: 'Search the entire repository (recursively) and return matching files with useful metadata. Never fabricates content.',
      inputSchema: searchRepositoryInputSchema,
    },
    wrap(makeSearchRepositoryTool(getDrive)),
  );

  return server;
}

// Re-exported for potential reuse/tests.
export { LIMITS, clampLimit, z };
