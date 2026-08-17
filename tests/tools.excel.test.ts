import { describe, it, expect } from '@jest/globals';
import ExcelJS from 'exceljs';
import type { GoogleDriveClient, DriveFileSummary } from '../src/google-drive.js';
import { makeInspectExcelTool, makeReadExcelSheetTool } from '../src/tools/excel.js';

async function buildSampleWorkbookBuffer(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Employees');
  sheet.addRow(['Name', 'Department', 'Salary']);
  sheet.addRow(['Alice', 'Engineering', 90000]);
  sheet.addRow(['Bob', 'Sales', 70000]);
  sheet.addRow(['Carol', 'HR', 65000]);
  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

function fakeFile(overrides: Partial<DriveFileSummary> = {}): DriveFileSummary {
  return {
    id: 'excel1',
    name: 'employees.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    size: '1000',
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

describe('inspect_excel', () => {
  it('returns worksheet names, headers, row/column counts and a preview', async () => {
    const buffer = await buildSampleWorkbookBuffer();
    const drive = fakeDriveWithBuffer(buffer, fakeFile());
    const tool = makeInspectExcelTool(() => drive);

    const result = await tool({ file_id: 'excel1' });
    const payload = JSON.parse(result.content[0].text as string);

    expect(payload.worksheetNames).toEqual(['Employees']);
    expect(payload.worksheets[0].headers).toEqual(['Name', 'Department', 'Salary']);
    expect(payload.worksheets[0].rowCount).toBe(3);
    expect(payload.worksheets[0].columnCount).toBe(3);
    expect(payload.worksheets[0].preview).toHaveLength(3);
  });

  it('rejects non-Excel files', async () => {
    const drive = fakeDriveWithBuffer(Buffer.from('hello'), fakeFile({ mimeType: 'text/plain', name: 'notes.txt' }));
    const tool = makeInspectExcelTool(() => drive);
    await expect(tool({ file_id: 'excel1' })).rejects.toThrow(/not a recognized Excel/);
  });
});

describe('read_excel_sheet', () => {
  it('returns structured rows with pagination', async () => {
    const buffer = await buildSampleWorkbookBuffer();
    const drive = fakeDriveWithBuffer(buffer, fakeFile());
    const tool = makeReadExcelSheetTool(() => drive);

    const result = await tool({ file_id: 'excel1', sheet_name: 'Employees', limit: 2, offset: 0 });
    const payload = JSON.parse(result.content[0].text as string);

    expect(payload.headers).toEqual(['Name', 'Department', 'Salary']);
    expect(payload.totalRows).toBe(3);
    expect(payload.returnedRows).toBe(2);
    expect(payload.rows[0][0]).toBe('Alice');
  });

  it('applies offset correctly', async () => {
    const buffer = await buildSampleWorkbookBuffer();
    const drive = fakeDriveWithBuffer(buffer, fakeFile());
    const tool = makeReadExcelSheetTool(() => drive);

    const result = await tool({ file_id: 'excel1', sheet_name: 'Employees', offset: 2 });
    const payload = JSON.parse(result.content[0].text as string);
    expect(payload.rows).toHaveLength(1);
    expect(payload.rows[0][0]).toBe('Carol');
  });

  it('throws a validation error for an unknown sheet name', async () => {
    const buffer = await buildSampleWorkbookBuffer();
    const drive = fakeDriveWithBuffer(buffer, fakeFile());
    const tool = makeReadExcelSheetTool(() => drive);

    await expect(tool({ file_id: 'excel1', sheet_name: 'DoesNotExist' })).rejects.toThrow(/not found/i);
  });
});
