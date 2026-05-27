# Discharge Summary (standalone app)

Self-contained React + Node app for live speech transcription, file upload, structured clinical summary, and PDF export. All server code lives in this folder (`server/`).

## Quick start

```bash
cd discharge-summary
npm install
cp .env.example .env   # add GEMINI_API_KEY
npm run build
npm start
```

Open:

```
http://localhost:8787/
```

## Development

One command runs the API, WebSocket transcription, and Vite HMR on the same port:

```bash
npm run dev
```

Open:

```
http://localhost:8787/
```

## Features

| Control | Action |
|--------|--------|
| **Record** | Mic → Gemini Live (`gemini-3.1-flash-live-preview`, v1beta) → live transcript |
| **Upload file** | Extract text from PDF / TXT / MD / DOCX |
| **Generate summary** | `gemini-2.5-flash-lite` structured JSON summary |
| **Download transcript PDF** | Speech transcript only |
| **Download summary PDF** | Structured clinical sections |

## Summary sections

- Hospital details  
- Master summary  
- Reason for admission  
- Final diagnosis  
- Prescription  
- Instructions  
- Condition at discharge  
- Follow up  

The summarization prompt is server-only (`server/internalPrompt.js`) and never sent to the browser.

## API (same origin)

| Endpoint | Purpose |
|----------|---------|
| `WS /ws/transcribe` | Live PCM transcription via Gemini Live |
| `POST /api/extract` | Upload → text |
| `POST /api/summarize` | Transcript + optional upload → JSON summary |
| `GET /api/history` | List saved sessions |
| `POST /api/history` | Save audio + transcript + hospital details |
| `GET/PUT/DELETE /api/history/:id` | Read, update, or delete a session |
| `GET /api/history/:id/audio` | Download saved recording |

Recorded sessions are stored under `data/history/` (not gitignored).

## Environment

| Variable | Default | Purpose |
|----------|---------|---------|
| `GEMINI_API_KEY` | — | Required for record + summary |
| `PORT` | `8787` | Standalone server port |

If `discharge-summary/.env` is missing, the server falls back to `../backend/.env`.  
In Docker, set variables via `discharge-summary/.env` (used by Compose) or `-e` flags — the `.env` file is **not** baked into the image.

## Docker

From this folder:

```bash
cp .env.example .env   # set GEMINI_API_KEY
docker compose up --build
```

Open:

```
http://localhost:8787/
```

History is persisted in the `discharge-history` Docker volume.

Build/run without Compose:

```bash
docker build -t discharge-summary .
docker run --rm -p 8787:8787 \
  -e GEMINI_API_KEY=your-key \
  -e PORT=8787 \
  -v discharge-history:/app/data/history \
  discharge-summary
```

Health check: `GET /api/health`

## Vercel

Deploy this folder as a Vercel project (root directory = repository root).

1. Import `https://github.com/chaman2003/discharge-summary` in Vercel.
2. Set environment variable **`GEMINI_API_KEY`** in Project → Settings → Environment Variables.
3. Deploy (build runs `npm run build`; static app served from `dist/`, API from `api/index.js`).

Open your deployment at:

```
https://your-project.vercel.app/
```

**Notes for Vercel**

| Feature | On Vercel |
|---------|-----------|
| UI, upload, summarize, PDF | Works |
| REST API (`/api/*`) | Works via serverless Express |
| History | Stored in `/tmp` (ephemeral — sessions may not persist across cold starts) |
| **Live recording (WebSocket)** | **Not supported** on Vercel serverless — use Docker/`npm start` locally or on a VPS for live transcription |

Optional: link the Git repo for automatic deploys on push to `main`.


```
discharge-summary/
  server/           # Express + WebSocket + Gemini
  data/history/     # Saved recordings + transcripts (CRUD)
  src/              # React UI
  public/           # Audio worklet
  dist/             # Vite build (created by npm run build)
```

This app is **not** mounted on the main voice-agent backend anymore.
