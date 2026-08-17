import { google } from 'googleapis';
import type { JWT } from 'google-auth-library';
import { ConfigError } from './utils/errors.js';

const DRIVE_READONLY_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';

interface ServiceAccountKey {
  type: string;
  project_id: string;
  private_key: string;
  client_email: string;
  [key: string]: unknown;
}

/**
 * Decodes GCP_KEY_BASE64, parses the service-account JSON, and builds a JWT client
 * scoped to read-only Drive access. The raw key material never leaves this module:
 * it is not logged, returned, or attached to any response object.
 */
export function createGoogleAuthClient(gcpKeyBase64: string): JWT {
  let decoded: string;
  try {
    decoded = Buffer.from(gcpKeyBase64, 'base64').toString('utf-8');
  } catch {
    throw new ConfigError('GCP_KEY_BASE64 is not valid base64.');
  }

  let key: ServiceAccountKey;
  try {
    key = JSON.parse(decoded) as ServiceAccountKey;
  } catch {
    throw new ConfigError('GCP_KEY_BASE64 does not decode to valid JSON.');
  }

  if (key.type !== 'service_account' || !key.private_key || !key.client_email) {
    throw new ConfigError(
      'GCP_KEY_BASE64 does not contain a valid service account key (expected type, private_key, client_email fields).',
    );
  }

  const auth = new google.auth.JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: [DRIVE_READONLY_SCOPE],
  });

  return auth;
}
