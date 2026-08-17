import { describe, it, expect } from '@jest/globals';
import { createGoogleAuthClient } from '../src/google-auth.js';

function base64Encode(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64');
}

const FAKE_PRIVATE_KEY =
  '-----BEGIN PRIVATE KEY-----\nMIIFAKEKEYDATA\n-----END PRIVATE KEY-----\n';

describe('createGoogleAuthClient', () => {
  it('throws ConfigError on invalid base64', () => {
    expect(() => createGoogleAuthClient('not-valid-base64-!!!@@@***')).toThrow(/base64/i);
  });

  it('throws ConfigError when decoded content is not valid JSON', () => {
    const encoded = Buffer.from('this is not json').toString('base64');
    expect(() => createGoogleAuthClient(encoded)).toThrow(/JSON/i);
  });

  it('throws ConfigError when required service account fields are missing', () => {
    const encoded = base64Encode({ type: 'service_account' });
    expect(() => createGoogleAuthClient(encoded)).toThrow(/service account/i);
  });

  it('throws ConfigError when type is not service_account', () => {
    const encoded = base64Encode({
      type: 'authorized_user',
      client_email: 'a@b.com',
      private_key: FAKE_PRIVATE_KEY,
    });
    expect(() => createGoogleAuthClient(encoded)).toThrow(/service account/i);
  });

  it('creates a JWT client for a valid service account key', () => {
    const encoded = base64Encode({
      type: 'service_account',
      project_id: 'test-project',
      client_email: 'test@test-project.iam.gserviceaccount.com',
      private_key: FAKE_PRIVATE_KEY,
    });

    const client = createGoogleAuthClient(encoded);
    expect(client).toBeDefined();
    expect(client.email).toBe('test@test-project.iam.gserviceaccount.com');
    expect(client.scopes).toEqual(['https://www.googleapis.com/auth/drive.readonly']);
  });
});
