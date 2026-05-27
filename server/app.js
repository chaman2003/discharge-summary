import dotenv from 'dotenv';
import express from 'express';
import fs from 'fs';
import http from 'http';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';

import { extractText } from './extract.js';
import { handleLiveTranscribe } from './liveTranscribe.js';
import { generateDischargeSummary } from './summarize.js';
import {
  createHistory,
  deleteHistory,
  getHistory,
  getHistoryAudioPath,
  listHistory,
  updateHistory,
} from './history.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.join(__dirname, '..');
export const DIST = path.join(ROOT, 'dist');
export const PUBLIC = path.join(ROOT, 'public');

export function loadEnv() {
  const envPath = path.join(ROOT, '.env');
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
  }
  const backendEnv = path.join(ROOT, '..', 'backend', '.env');
  if (fs.existsSync(backendEnv)) {
    dotenv.config({ path: backendEnv });
  }
}

export function getConfig() {
  return {
    port: Number(process.env.PORT || 8787),
    geminiApiKey: process.env.GEMINI_API_KEY || '',
  };
}

function hospitalHint(hospital) {
  if (!hospital) return '';
  const lines = [
    hospital.hospital_name ? `Hospital: ${hospital.hospital_name}` : '',
    hospital.patient_name ? `Patient: ${hospital.patient_name}` : '',
    hospital.consulting_doctor ? `Consulting doctor: ${hospital.consulting_doctor}` : '',
    hospital.department ? `Department: ${hospital.department}` : '',
    hospital.condition ? `Diagnosis / cause: ${hospital.condition}` : '',
    hospital.age ? `Age: ${hospital.age}` : '',
    hospital.blood_group ? `Blood group: ${hospital.blood_group}` : '',
    hospital.gender ? `Gender: ${hospital.gender}` : '',
    hospital.admission_date ? `Admission date: ${hospital.admission_date}` : '',
    hospital.discharge_date ? `Discharge date: ${hospital.discharge_date}` : '',
  ].filter(Boolean);
  return lines.join('\n');
}

function sendFile(res, filePath, contentType) {
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  if (contentType) res.type(contentType);
  res.sendFile(filePath);
}

export function createApp({ serveDist = true } = {}) {
  loadEnv();
  const { geminiApiKey } = getConfig();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

  const app = express();
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      gemini_configured: Boolean(geminiApiKey),
    });
  });

  app.post('/api/extract', upload.single('file'), async (req, res) => {
    const file = req.file;
    if (!file?.buffer?.length) {
      return res.status(400).json({ error: 'Empty file' });
    }
    try {
      const { text, warnings } = await extractText(file.originalname || 'upload.txt', file.buffer);
      return res.json({ filename: file.originalname, text, warnings });
    } catch (err) {
      return res.status(400).json({ error: err.message || 'Extract failed' });
    }
  });

  app.post('/api/summarize', async (req, res) => {
    const transcript = String(req.body?.transcript || '').trim();
    if (!transcript) {
      return res.status(400).json({ error: 'Transcript is required' });
    }
    const summary = await generateDischargeSummary({
      apiKey: geminiApiKey,
      transcript,
      uploadedContext: req.body?.uploaded_context || '',
      hospitalHint: hospitalHint(req.body?.hospital),
      hospital: req.body?.hospital || {},
    });
    return res.json({ summary });
  });

  app.get('/api/history', (_req, res) => {
    res.json({ items: listHistory() });
  });

  app.get('/api/history/:id', (req, res) => {
    const entry = getHistory(req.params.id);
    if (!entry) return res.status(404).json({ error: 'History entry not found' });
    return res.json({ entry });
  });

  app.post('/api/history', upload.single('audio'), (req, res) => {
    let payload = {};
    try {
      payload = JSON.parse(req.body?.payload || '{}');
    } catch {
      return res.status(400).json({ error: 'Invalid history payload' });
    }
    const transcript = String(payload.transcript || '').trim();
    const audioBuffer = req.file?.buffer;
    if (!transcript && !audioBuffer?.length) {
      return res.status(400).json({ error: 'Transcript or audio is required' });
    }
    const entry = createHistory({
      transcript,
      hospital: payload.hospital || {},
      summary: payload.summary || null,
      audioBuffer,
    });
    return res.status(201).json({ entry });
  });

  app.put('/api/history/:id', (req, res) => {
    const entry = updateHistory(req.params.id, {
      transcript: req.body?.transcript,
      hospital: req.body?.hospital,
      summary: req.body?.summary,
    });
    if (!entry) return res.status(404).json({ error: 'History entry not found' });
    return res.json({ entry });
  });

  app.delete('/api/history/:id', (req, res) => {
    if (!deleteHistory(req.params.id)) {
      return res.status(404).json({ error: 'History entry not found' });
    }
    return res.json({ ok: true });
  });

  app.get('/api/history/:id/audio', (req, res) => {
    const file = getHistoryAudioPath(req.params.id);
    if (!file) return res.status(404).json({ error: 'Audio not found' });
    return res.sendFile(file);
  });

  app.get('/audio-processors/:file', (req, res) => {
    sendFile(res, path.join(PUBLIC, 'audio-processors', req.params.file), 'application/javascript');
  });

  if (serveDist) {
    app.use('/assets', express.static(path.join(DIST, 'assets')));

    app.get('/', (_req, res) => {
      sendFile(res, path.join(DIST, 'index.html'), 'text/html');
    });

    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/ws') || req.path.startsWith('/audio-processors')) {
        return next();
      }
      const rel = req.path.replace(/^\//, '');
      const candidate = path.join(DIST, rel);
      if (rel && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return res.sendFile(candidate);
      }
      sendFile(res, path.join(DIST, 'index.html'), 'text/html');
    });
  }

  return app;
}

export function attachWebSocket(app, apiKey) {
  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (url.pathname === '/ws/transcribe') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        handleLiveTranscribe(ws, apiKey);
      });
      return;
    }
    socket.destroy();
  });

  return server;
}

export function listen(server, port, { label = 'Discharge Summary app' } = {}) {
  const { geminiApiKey } = getConfig();

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${port} is already in use. Stop the other process or set PORT to a free port.`);
      console.error(`Example: $env:PORT=8788; npm run dev`);
      process.exit(1);
    }
    throw err;
  });

  server.listen(port, () => {
    console.log(`${label}: http://localhost:${port}/`);
    if (!geminiApiKey) {
      console.warn('Warning: GEMINI_API_KEY is not set.');
    }
  });
}
