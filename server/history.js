import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const HISTORY_DIR = process.env.VERCEL
  ? path.join('/tmp', 'discharge-summary-history')
  : path.join(__dirname, '..', 'data', 'history');

function ensureHistoryDir() {
  fs.mkdirSync(HISTORY_DIR, { recursive: true });
}

function entryDir(id) {
  return path.join(HISTORY_DIR, id);
}

function metaPath(id) {
  return path.join(entryDir(id), 'meta.json');
}

function audioPath(id) {
  return path.join(entryDir(id), 'recording.webm');
}

function readMeta(id) {
  const file = metaPath(id);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}

function writeMeta(id, meta) {
  ensureHistoryDir();
  fs.mkdirSync(entryDir(id), { recursive: true });
  fs.writeFileSync(metaPath(id), JSON.stringify(meta, null, 2), 'utf-8');
}

export function listHistory() {
  ensureHistoryDir();
  const entries = fs
    .readdirSync(HISTORY_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => readMeta(d.name))
    .filter(Boolean)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  return entries.map((entry) => ({
    id: entry.id,
    created_at: entry.created_at,
    updated_at: entry.updated_at,
    patient_name: entry.hospital?.patient_name || '',
    hospital_name: entry.hospital?.hospital_name || '',
    condition: entry.hospital?.condition || '',
    transcript_preview: (entry.transcript || '').slice(0, 160),
    has_summary: !!entry.summary && Object.values(entry.summary).some(Boolean),
    has_audio: fs.existsSync(audioPath(entry.id)),
  }));
}

export function getHistory(id) {
  const meta = readMeta(id);
  if (!meta) return null;
  return {
    ...meta,
    has_audio: fs.existsSync(audioPath(id)),
  };
}

export function createHistory({ transcript, hospital, summary, audioBuffer }) {
  ensureHistoryDir();
  const id = randomUUID();
  const now = new Date().toISOString();
  const meta = {
    id,
    created_at: now,
    updated_at: now,
    transcript: transcript || '',
    hospital: hospital || {},
    summary: summary || null,
  };
  writeMeta(id, meta);
  if (audioBuffer?.length) {
    fs.writeFileSync(audioPath(id), audioBuffer);
  }
  return getHistory(id);
}

export function updateHistory(id, patch) {
  const meta = readMeta(id);
  if (!meta) return null;
  if (patch.transcript !== undefined) meta.transcript = patch.transcript;
  if (patch.hospital !== undefined) meta.hospital = patch.hospital;
  if (patch.summary !== undefined) meta.summary = patch.summary;
  meta.updated_at = new Date().toISOString();
  writeMeta(id, meta);
  return getHistory(id);
}

export function deleteHistory(id) {
  const dir = entryDir(id);
  if (!fs.existsSync(dir)) return false;
  fs.rmSync(dir, { recursive: true, force: true });
  return true;
}

export function getHistoryAudioPath(id) {
  const file = audioPath(id);
  return fs.existsSync(file) ? file : null;
}
