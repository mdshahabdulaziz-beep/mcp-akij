import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import type { Express } from 'express';

const ORIGINAL_ENV = { ...process.env };

function base64Encode(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64');
}

let app: Express;

beforeAll(async () => {
  process.env.PORT = '10000';
  process.env.GOOGLE_DRIVE_FOLDER_ID = '1oxYLPcC9MPVuxsbeP0kGgYhLmkxt0w2o';
  process.env.API_KEYS = 'test-key-1,test-key-2';
  process.env.GCP_KEY_BASE64 = base64Encode({
    type: 'service_account',
    project_id: 'test-project',
    client_email: 'test@test-project.iam.gserviceaccount.com',
    private_key: '-----BEGIN PRIVATE KEY-----\nMIIFAKEKEYDATA\n-----END PRIVATE KEY-----\n',
  });

  const { resetConfigCache } = await import('../src/config.js');
  resetConfigCache();
  const { buildApp } = await import('../src/index.js');
  app = buildApp();
});

afterAll(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('GET /health', () => {
  it('returns status ok with a timestamp and no secrets', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(typeof res.body.timestamp).toBe('string');
    expect(JSON.stringify(res.body)).not.toMatch(/private_key|GCP_KEY|test-key/);
  });
});

describe('POST /mcp authentication', () => {
  it('rejects requests with no API key', async () => {
    const res = await request(app).post('/mcp').send({});
    expect(res.status).toBe(401);
  });

  it('rejects requests with an invalid API key', async () => {
    const res = await request(app).post('/mcp').set('x-api-key', 'wrong').send({});
    expect(res.status).toBe(401);
  });
});

describe('GET /mcp', () => {
  it('returns 405 method not allowed (no SSE-only fallback)', async () => {
    const res = await request(app).get('/mcp');
    expect(res.status).toBe(405);
  });
});

describe('unknown routes', () => {
  it('returns 404', async () => {
    const res = await request(app).get('/does-not-exist');
    expect(res.status).toBe(404);
  });
});
