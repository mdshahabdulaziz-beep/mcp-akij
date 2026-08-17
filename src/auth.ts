import type { Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';

export interface AuthenticatedIdentity {
  /** Opaque identifier for the caller, derived from (not equal to) the API key. Safe to log. */
  keyId: string;
}

declare module 'express-serve-static-core' {
  interface Request {
    identity?: AuthenticatedIdentity;
  }
}

function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function deriveKeyId(apiKey: string): string {
  return crypto.createHash('sha256').update(apiKey).digest('hex').slice(0, 12);
}

function extractApiKey(req: Request): string | null {
  const authHeader = req.header('authorization');
  if (authHeader) {
    const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
    if (match) return match[1].trim();
  }
  const headerKey = req.header('x-api-key');
  if (headerKey) return headerKey.trim();
  return null;
}

/**
 * Express middleware enforcing API-key authentication. Valid keys are matched with a
 * timing-safe comparison; the key itself is never logged, only its derived keyId.
 *
 * Deliberately structured around a single `AuthenticatedIdentity` shape so that a future
 * per-user-key, OAuth, or role-based authorization layer can populate `req.identity` with
 * richer claims (userId, roles, scopes) without changing call sites downstream.
 */
export function createApiKeyMiddleware(validApiKeys: readonly string[]) {
  return function apiKeyMiddleware(req: Request, res: Response, next: NextFunction): void {
    const provided = extractApiKey(req);

    if (!provided) {
      res.status(401).json({
        error: {
          code: 'AUTH_ERROR',
          message: 'Missing API key. Provide it via the Authorization: Bearer <key> header or X-Api-Key header.',
        },
      });
      return;
    }

    const isValid = validApiKeys.some((key) => timingSafeEqual(provided, key));
    if (!isValid) {
      res.status(401).json({
        error: {
          code: 'AUTH_ERROR',
          message: 'Invalid API key.',
        },
      });
      return;
    }

    req.identity = { keyId: deriveKeyId(provided) };
    next();
  };
}
