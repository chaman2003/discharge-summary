const API = '/api';

export async function extractUpload(file) {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${API}/extract`, { method: 'POST', body: form });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

export async function summarize({ transcript, uploadedContext, hospital }) {
  const res = await fetch(`${API}/summarize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      transcript,
      uploaded_context: uploadedContext || '',
      hospital: hospital || {},
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data.summary;
}

export function transcribeWebSocketUrl() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws/transcribe`;
}

export async function fetchHistoryList() {
  const res = await fetch(`${API}/history`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data.items || [];
}

export async function fetchHistoryEntry(id) {
  const res = await fetch(`${API}/history/${encodeURIComponent(id)}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data.entry;
}

export async function saveHistoryEntry({ audioBlob, transcript, hospital, summary }) {
  const form = new FormData();
  if (audioBlob) {
    form.append('audio', audioBlob, 'recording.webm');
  }
  form.append('payload', JSON.stringify({ transcript, hospital, summary: summary || null }));
  const res = await fetch(`${API}/history`, { method: 'POST', body: form });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data.entry;
}

export async function updateHistoryEntry(id, patch) {
  const res = await fetch(`${API}/history/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data.entry;
}

export async function deleteHistoryEntry(id) {
  const res = await fetch(`${API}/history/${encodeURIComponent(id)}`, { method: 'DELETE' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

export function historyAudioUrl(id) {
  return `${API}/history/${encodeURIComponent(id)}/audio`;
}
