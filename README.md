# akij-hr-data-mcp

A production-ready, **read-only**, remote **Model Context Protocol (MCP)** server that exposes a single Google Drive folder — the **AKIJ HR DATA** repository — to MCP-compatible clients over modern **Streamable HTTP** transport.

It is a **general-purpose** Drive MCP: it handles XLSX, XLS, CSV, PDF, DOCX, TXT, images, and native Google Docs/Sheets/Slides files — not an Excel-only tool.

---

## 1. What this project does

- Connects to Google Drive using a **service account** (no user OAuth flow, no browser login).
- Restricts every operation to one configured folder (`GOOGLE_DRIVE_FOLDER_ID`) and its subfolders. Files outside that tree are never returned, even if the service account could technically see them.
- Exposes 11 MCP tools for discovering and reading files (list, search, metadata, content, and format-specific extraction for Excel/CSV/PDF/DOCX).
- Runs as a standard Node/Express HTTP server with a single `POST /mcp` endpoint (Streamable HTTP transport) and a `GET /health` endpoint, deployable to Render (or any Node host) so it keeps running when your PC is off.
- Enforces API-key authentication on every MCP request.
- Is strictly **read-only** — there is no code path that can upload, edit, delete, rename, move, or share a Drive file, or change permissions.

## 2. Architecture

```
Google Drive (AKIJ HR DATA folder)
        ↓ Drive API v3 (read-only scope)
Google Service Account (GCP_KEY_BASE64)
        ↓
GoogleDriveClient (src/google-drive.ts) — enforces folder-tree scope
        ↓
MCP Server (src/mcp-server.ts) — 11 tools, Zod-validated inputs
        ↓
Express app (src/index.ts) — API-key auth, Streamable HTTP transport
        ↓ POST /mcp  (stateless, one transport per request)
        ↓
Render (always-on host)
        ↓ HTTPS
Remote MCP Clients (Claude, other MCP-compatible clients)
```

The server is **stateless**: each `POST /mcp` request gets its own `McpServer` + `StreamableHTTPServerTransport` instance (`sessionIdGenerator: undefined`), so there's no session affinity requirement and it scales horizontally on Render without sticky sessions.

### Project structure

```
src/
  index.ts            Express app: /health, /mcp, startup
  config.ts           Environment variable loading/validation
  auth.ts             API-key authentication middleware
  google-auth.ts      Decodes GCP_KEY_BASE64 → JWT auth client
  google-drive.ts      Drive API client with folder-scope enforcement
  mcp-server.ts        McpServer wiring: registers all 11 tools

  tools/
    files.ts           list_files, get_file_metadata, get_file_content, list_supported_files
    search.ts           search_files, search_repository
    excel.ts            inspect_excel, read_excel_sheet
    csv.ts               read_csv
    pdf.ts               extract_pdf_text
    docx.ts              extract_docx_text

  utils/
    errors.ts            Typed AppError hierarchy + safe error serialization
    limits.ts            Size/row/timeout/pagination limits
    mime-types.ts         MIME → file-category classification

tests/                  Jest test suite (46 tests, 10 suites)
.env.example
.gitignore
render.yaml             Render Blueprint (optional one-click deploy)
README.md
package.json
tsconfig.json
jest.config.cjs
```

## 3. Prerequisites

- Node.js 20+ and npm
- A Google Cloud project with the **Google Drive API** enabled
- A **Google service account** with **Viewer** access shared on the AKIJ HR DATA Drive folder
- A GitHub account (for deploying to Render from a repo)
- A Render account

## 4. Installation

```bash
npm install
```

## 5. Environment variables

| Variable                  | Required | Description                                                                 |
|----------------------------|----------|-------------------------------------------------------------------------------|
| `PORT`                     | no (default `10000`) | Port the HTTP server listens on. Render sets this automatically.  |
| `GOOGLE_DRIVE_FOLDER_ID`   | yes      | The Drive folder ID this MCP is restricted to.                               |
| `GCP_KEY_BASE64`           | yes      | Base64-encoded service-account JSON key.                                     |
| `API_KEYS`                 | yes      | Comma-separated list of valid API keys for `POST /mcp`.                      |

See [`.env.example`](.env.example) for the template (no real secrets are committed).

## 6. Google Cloud setup

1. Go to [console.cloud.google.com](https://console.cloud.google.com/) and select/create a project.
2. **APIs & Services → Library** → enable **Google Drive API**.
3. **APIs & Services → Credentials → Create Credentials → Service Account**.
4. Give it a name (e.g. `akij-hr-data-mcp`), no project-level IAM role is needed.
5. Open the new service account → **Keys → Add Key → Create new key → JSON**. This downloads a `gcp-key.json` file — **do not commit this file**.
6. Note the service account's email address (looks like `akij-hr-data-mcp@your-project.iam.gserviceaccount.com`).

## 7. Google Drive permissions

1. Open the **AKIJ HR DATA** folder in Google Drive (folder ID `1oxYLPcC9MPVuxsbeP0kGgYhLmkxt0w2o`).
2. Click **Share**, paste the service account's email, and grant **Viewer** access.
3. Do **not** grant Editor/Owner — this server never writes to Drive, so Viewer is sufficient and safer.

## 8. Local setup

```bash
npm install
cp .env.example .env
# fill in GOOGLE_DRIVE_FOLDER_ID, GCP_KEY_BASE64, API_KEYS in .env
npm run dev
```

`npm run dev` runs the TypeScript server directly with `tsx watch` (no build step needed for local iteration).

## 9. Generating `GCP_KEY_BASE64`

You should never paste the raw service-account JSON into chat, source code, or `.env.example`. Generate the base64 value locally from your downloaded `gcp-key.json` and put it only in your local `.env` (gitignored) or in Render's environment variable settings.

**PowerShell:**

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("$HOME\Downloads\gcp-key.json")) | Set-Clipboard
```

This reads the key file and copies the base64 string directly to your clipboard — paste it as the value of `GCP_KEY_BASE64` in `.env` (locally) or in the Render dashboard (for deployment). Adjust the path if `gcp-key.json` isn't in your Downloads folder.

If you'd rather print it to the terminal instead of the clipboard:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("$HOME\Downloads\gcp-key.json"))
```

## 10. Local testing

Start the server:

```bash
npm run dev
```

Check health:

```bash
curl http://localhost:10000/health
```

Call an MCP tool (example: `list_files`) with `curl`, using the `initialize` → `tools/call` sequence, or point any Streamable-HTTP-capable MCP client at `http://localhost:10000/mcp` with header `X-Api-Key: <one of your API_KEYS>`.

## 11. Building

```bash
npm run build
```

Compiles `src/` (TypeScript, NodeNext ESM) to `dist/`. Run `npm run typecheck` to type-check without emitting files.

Run the test suite:

```bash
npm test
```

This runs Jest in-band (46 tests across 10 suites: config, auth, Google auth, Drive folder-scope enforcement, all 11 tools, and the `/health`/`/mcp` HTTP endpoints).

## 12. GitHub setup

```bash
git init
git add .
git commit -m "Initial commit: akij-hr-data-mcp"
git branch -M main
git remote add origin https://github.com/<your-username>/akij-hr-data-mcp.git
git push -u origin main
```

`.env`, `gcp-key.json`, `*.pem`, and `*.key` are already gitignored — verify with `git status` before committing that nothing secret is staged.

## 13. Render deployment

1. Go to [render.com](https://render.com) → **New → Web Service**.
2. Connect your GitHub repo (`akij-hr-data-mcp`).
3. Render will detect `render.yaml` (Blueprint) automatically, or configure manually:
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `npm start`
   - **Health Check Path:** `/health`
4. Add the environment variables (section 14) in the Render dashboard — **never** commit them.
5. Deploy. Render builds, starts the service, and keeps it running independent of your PC.

## 14. Render environment variables

Set these in **Render → your service → Environment**:

```
PORT=10000
GOOGLE_DRIVE_FOLDER_ID=1oxYLPcC9MPVuxsbeP0kGgYhLmkxt0w2o
GCP_KEY_BASE64=<paste the base64 string from step 9>
API_KEYS=<comma-separated production keys, e.g. key-abc123,key-def456>
```

Generate strong random API keys, e.g.:

```powershell
[Convert]::ToBase64String([Guid]::NewGuid().ToByteArray()) -replace '[+/=]',''
```

## 15. Health endpoint

```
GET /health
```

```json
{ "status": "ok", "timestamp": "2026-08-17T12:00:00.000Z" }
```

No authentication required; exposes no secrets or internal state.

## 16. MCP endpoint

```
POST /mcp
```

- Implements the MCP **Streamable HTTP** transport (`@modelcontextprotocol/sdk` `StreamableHTTPServerTransport`), stateless (`sessionIdGenerator: undefined`) — no SSE-only fallback.
- Requires authentication: `Authorization: Bearer <API_KEY>` or `X-Api-Key: <API_KEY>` header.
- `GET /mcp` and `DELETE /mcp` return `405` — this server doesn't maintain sessions or support the optional SSE stream.

## 17. Connecting the remote MCP to clients

Once deployed, your MCP endpoint is:

```
https://<your-render-service>.onrender.com/mcp
```

For MCP clients that support remote/HTTP servers, add a server entry with:
- **URL:** `https://<your-render-service>.onrender.com/mcp`
- **Transport:** Streamable HTTP
- **Headers:** `X-Api-Key: <one of your API_KEYS>` (or `Authorization: Bearer <API_KEY>`)

Example generic client config:

```json
{
  "mcpServers": {
    "akij-hr-data": {
      "url": "https://<your-render-service>.onrender.com/mcp",
      "headers": {
        "X-Api-Key": "<API_KEY>"
      }
    }
  }
}
```

## 18. Security

- **Read-only**: no upload/delete/edit/rename/move/share/permission tool exists in this codebase.
- **Folder-scoped**: `GoogleDriveClient.assertFileInScope` walks each file's `parents` chain up to the configured root before any metadata or content is returned; files outside the tree raise a `ForbiddenError`.
- **API-key auth**: every `POST /mcp` request is checked against `API_KEYS` with a timing-safe comparison (`crypto.timingSafeEqual`). Missing/invalid keys get `401`.
- **Credentials never logged or returned**: the decoded service-account JSON stays inside `google-auth.ts`; no tool, log line, or error message can surface it. Error responses are passed through `toSafeErrorMessage`, which strips stack traces and raw upstream error bodies.
- **Size/output limits**: downloads are capped (`LIMITS.MAX_DOWNLOAD_BYTES` / `MAX_PARSE_BYTES`), text extraction is truncated (`MAX_TEXT_OUTPUT_CHARS`), rows are paginated (`DEFAULT_ROW_LIMIT`/`MAX_ROW_LIMIT`), and every outbound Google API call has a timeout (`GOOGLE_API_TIMEOUT_MS`).
- **Extensible auth**: `req.identity` is a small, stable shape (`{ keyId }`) designed so a future per-user-key, OAuth, or role-based authorization layer can attach richer claims without changing every call site.
- **Known dependency advisory**: the `xlsx` (SheetJS) package used for legacy `.xls` parsing has a published high-severity advisory (prototype pollution / ReDoS). It's used only for internal, access-controlled files from your own Drive folder (not arbitrary internet uploads) and files are size-capped before parsing. Run `npm audit` periodically and consider replacing it if a patched release becomes available.

### Security checklist

- [ ] `gcp-key.json` never committed to git
- [ ] `.env` never committed to git
- [ ] `API_KEYS` set to strong, random values in Render (not the local dev value)
- [ ] Service account has **Viewer only** on the Drive folder
- [ ] `GOOGLE_DRIVE_FOLDER_ID` matches the intended repository folder
- [ ] Render environment variables set directly in the dashboard, never in `render.yaml`'s committed values

## 19. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Server exits immediately with a `ConfigError` | Missing/invalid env var | Check the exact variable named in the error message against section 5 |
| `GCP_KEY_BASE64 is not valid base64` | Wrong file encoded, or copy/paste truncated the string | Regenerate with the PowerShell command in section 9 |
| `403 Forbidden` from Drive API | Service account not shared on the folder, or shared with the wrong email | Re-check section 7; confirm the `client_email` in your key matches |
| `File ... is outside the configured repository folder` | You passed a `file_id` that isn't inside `GOOGLE_DRIVE_FOLDER_ID`'s tree | Use `list_supported_files` or `search_repository` to get valid IDs |
| `401` on every `/mcp` call | Missing/incorrect API key | Send `X-Api-Key` or `Authorization: Bearer <key>` matching one entry in `API_KEYS` |
| `FILE_TOO_LARGE` error | File exceeds the configured byte limit | This is intentional; large files are rejected rather than loaded fully into memory (see `src/utils/limits.ts`) |
| Render service sleeps / cold-starts slowly | Free/starter Render plans idle after inactivity | Upgrade the Render plan, or accept the cold-start delay on the first request |
| Tests hang for minutes locally | `ts-jest` type-checking full `googleapis` types under parallel workers | Already mitigated: `npm test` runs Jest with `--runInBand`; don't remove that flag |

---

## Remaining manual steps (only you can do these)

1. **Generate `GCP_KEY_BASE64`** from your downloaded `gcp-key.json` (section 9) and put it in your local `.env` for testing.
2. **Share the AKIJ HR DATA Drive folder** with your service account's email as Viewer (section 7).
3. **Run locally** (`npm run dev`) and confirm `GET /health` and a real `list_files` call work against your real Drive folder.
4. **Push to GitHub** (section 12).
5. **Create the Render Web Service**, connect the repo, and set the four environment variables in the Render dashboard (sections 13–14) — Render will build and deploy automatically.
6. **Generate production `API_KEYS`** (different from any local dev key) and store them securely for your MCP clients.
7. **Connect your MCP client** to `https://<your-render-service>.onrender.com/mcp` (section 17).
