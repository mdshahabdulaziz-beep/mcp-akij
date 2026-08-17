import 'dotenv/config';
import express from 'express';
import type { Request, Response } from 'express';
import { fileURLToPath } from 'node:url';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { loadConfig } from './config.js';
import { createApiKeyMiddleware } from './auth.js';
import { createGoogleAuthClient } from './google-auth.js';
import { GoogleDriveClient } from './google-drive.js';
import { createMcpServer } from './mcp-server.js';
import { toSafeErrorMessage } from './utils/errors.js';

function buildApp() {
  const config = loadConfig();

  const authClient = createGoogleAuthClient(config.gcpKeyBase64);
  const driveClient = new GoogleDriveClient(authClient, config.googleDriveFolderId);
  const getDrive = () => driveClient;

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '4mb' }));

  app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  const apiKeyMiddleware = createApiKeyMiddleware(config.apiKeys);

  app.post('/mcp', apiKeyMiddleware, async (req: Request, res: Response) => {
    const server = createMcpServer(getDrive);
    try {
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      res.on('close', () => {
        transport.close();
        server.close();
      });
    } catch (err) {
      const { message, code } = toSafeErrorMessage(err);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: `${code}: ${message}` },
          id: null,
        });
      }
    }
  });

  app.get('/mcp', (_req: Request, res: Response) => {
    res.status(405).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed. This server only supports stateless POST /mcp requests.' },
      id: null,
    });
  });

  app.delete('/mcp', (_req: Request, res: Response) => {
    res.status(405).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed. This server does not maintain sessions.' },
      id: null,
    });
  });

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found.' } });
  });

  return app;
}

function main() {
  const config = loadConfig();
  const app = buildApp();

  app.listen(config.port, () => {
    console.log(`akij-hr-data-mcp listening on port ${config.port}`);
    console.log(`Health check: GET /health`);
    console.log(`MCP endpoint: POST /mcp`);
  });

  process.on('SIGINT', () => {
    console.log('Shutting down...');
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    console.log('Shutting down...');
    process.exit(0);
  });
}

// Only auto-start the server when run directly (not when imported by tests).
const isMain = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main();
}

export { buildApp };
