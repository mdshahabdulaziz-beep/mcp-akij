import { describe, it, expect, jest } from '@jest/globals';
import type { Request, Response, NextFunction } from 'express';
import { createApiKeyMiddleware } from '../src/auth.js';

function makeReq(headers: Record<string, string>): Request {
  return {
    header: (name: string) => headers[name.toLowerCase()],
  } as unknown as Request;
}

function makeRes() {
  const res: Partial<Response> & { statusCode?: number; body?: unknown } = {};
  res.status = jest.fn((code: number) => {
    res.statusCode = code;
    return res as Response;
  }) as unknown as Response['status'];
  res.json = jest.fn((body: unknown) => {
    res.body = body;
    return res as Response;
  }) as unknown as Response['json'];
  return res as Response & { statusCode?: number; body?: unknown };
}

describe('createApiKeyMiddleware', () => {
  const middleware = createApiKeyMiddleware(['valid-key-1', 'valid-key-2']);

  it('rejects requests with no API key', () => {
    const req = makeReq({});
    const res = makeRes();
    const next = jest.fn() as unknown as NextFunction;

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect((res.body as { error: { code: string } }).error.code).toBe('AUTH_ERROR');
  });

  it('rejects requests with an invalid API key via Authorization header', () => {
    const req = makeReq({ authorization: 'Bearer wrong-key' });
    const res = makeRes();
    const next = jest.fn() as unknown as NextFunction;

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it('accepts a valid key via Authorization: Bearer header', () => {
    const req = makeReq({ authorization: 'Bearer valid-key-1' });
    const res = makeRes();
    const next = jest.fn() as unknown as NextFunction;

    middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.identity?.keyId).toBeDefined();
  });

  it('accepts a valid key via X-Api-Key header', () => {
    const req = makeReq({ 'x-api-key': 'valid-key-2' });
    const res = makeRes();
    const next = jest.fn() as unknown as NextFunction;

    middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('never places the raw API key on req.identity', () => {
    const req = makeReq({ 'x-api-key': 'valid-key-1' });
    const res = makeRes();
    const next = jest.fn() as unknown as NextFunction;

    middleware(req, res, next);

    expect(JSON.stringify(req.identity)).not.toContain('valid-key-1');
  });
});
