import { ConfigError } from './utils/errors.js';

export interface AppConfig {
  port: number;
  googleDriveFolderId: string;
  gcpKeyBase64: string;
  apiKeys: string[];
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new ConfigError(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

let cachedConfig: AppConfig | undefined;

/**
 * Loads and validates configuration from environment variables.
 * Throws a ConfigError describing exactly which variable is missing/invalid.
 * Result is cached after the first successful load.
 */
export function loadConfig(): AppConfig {
  if (cachedConfig) return cachedConfig;

  const portRaw = process.env.PORT ?? '10000';
  const port = Number.parseInt(portRaw, 10);
  if (Number.isNaN(port) || port <= 0 || port > 65535) {
    throw new ConfigError(`Invalid PORT value: "${portRaw}". Must be a valid port number.`);
  }

  const googleDriveFolderId = requireEnv('GOOGLE_DRIVE_FOLDER_ID');
  const gcpKeyBase64 = requireEnv('GCP_KEY_BASE64');

  const apiKeysRaw = requireEnv('API_KEYS');
  const apiKeys = apiKeysRaw
    .split(',')
    .map((key) => key.trim())
    .filter((key) => key.length > 0);

  if (apiKeys.length === 0) {
    throw new ConfigError('API_KEYS must contain at least one non-empty API key.');
  }

  cachedConfig = {
    port,
    googleDriveFolderId,
    gcpKeyBase64,
    apiKeys,
  };

  return cachedConfig;
}

/** Resets the cached config. Intended for use in tests only. */
export function resetConfigCache(): void {
  cachedConfig = undefined;
}
