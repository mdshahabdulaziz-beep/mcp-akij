import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { loadConfig, resetConfigCache } from '../src/config.js';

const ENV_KEYS = ['PORT', 'GOOGLE_DRIVE_FOLDER_ID', 'GCP_KEY_BASE64', 'API_KEYS'];

describe('config', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    for (const key of ENV_KEYS) delete process.env[key];
    resetConfigCache();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    resetConfigCache();
  });

  it('throws ConfigError when GOOGLE_DRIVE_FOLDER_ID is missing', () => {
    process.env.GCP_KEY_BASE64 = 'abc';
    process.env.API_KEYS = 'key1';
    expect(() => loadConfig()).toThrow(/GOOGLE_DRIVE_FOLDER_ID/);
  });

  it('throws ConfigError when GCP_KEY_BASE64 is missing', () => {
    process.env.GOOGLE_DRIVE_FOLDER_ID = 'folder123';
    process.env.API_KEYS = 'key1';
    expect(() => loadConfig()).toThrow(/GCP_KEY_BASE64/);
  });

  it('throws ConfigError when API_KEYS is missing', () => {
    process.env.GOOGLE_DRIVE_FOLDER_ID = 'folder123';
    process.env.GCP_KEY_BASE64 = 'abc';
    expect(() => loadConfig()).toThrow(/API_KEYS/);
  });

  it('throws ConfigError on invalid PORT', () => {
    process.env.PORT = 'not-a-number';
    process.env.GOOGLE_DRIVE_FOLDER_ID = 'folder123';
    process.env.GCP_KEY_BASE64 = 'abc';
    process.env.API_KEYS = 'key1';
    expect(() => loadConfig()).toThrow(/PORT/);
  });

  it('parses a comma-separated API_KEYS list and trims whitespace', () => {
    process.env.PORT = '10000';
    process.env.GOOGLE_DRIVE_FOLDER_ID = 'folder123';
    process.env.GCP_KEY_BASE64 = 'abc';
    process.env.API_KEYS = ' key1 , key2,key3 ';
    const config = loadConfig();
    expect(config.apiKeys).toEqual(['key1', 'key2', 'key3']);
    expect(config.port).toBe(10000);
    expect(config.googleDriveFolderId).toBe('folder123');
  });

  it('defaults PORT to 10000 when not set', () => {
    process.env.GOOGLE_DRIVE_FOLDER_ID = 'folder123';
    process.env.GCP_KEY_BASE64 = 'abc';
    process.env.API_KEYS = 'key1';
    expect(loadConfig().port).toBe(10000);
  });

  it('caches the config after first successful load', () => {
    process.env.GOOGLE_DRIVE_FOLDER_ID = 'folder123';
    process.env.GCP_KEY_BASE64 = 'abc';
    process.env.API_KEYS = 'key1';
    const first = loadConfig();
    process.env.GOOGLE_DRIVE_FOLDER_ID = 'changed';
    const second = loadConfig();
    expect(second).toBe(first);
    expect(second.googleDriveFolderId).toBe('folder123');
  });
});
