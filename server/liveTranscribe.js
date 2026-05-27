import { GoogleGenAI, Modality } from '@google/genai';

export const LIVE_MODEL = 'gemini-3.1-flash-live-preview';

function sendJson(ws, payload) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function capitalizeFirst(text) {
  if (!text) return '';
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function normalizeLine(text) {
  let clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  clean = capitalizeFirst(clean);
  if (!/[.!?]$/.test(clean)) clean += '.';
  return clean;
}

function formatTimestamp(totalSeconds) {
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function stripTimestamp(line) {
  return String(line || '').replace(/^\[\d+:\d{2}\]\s*/, '').trim();
}

function splitToSentenceLines(text) {
  return String(text || '')
    .split(/(?<=[.!?])\s+/)
    .map((part) => normalizeLine(part))
    .filter(Boolean);
}

function createTranscriptBuffer() {
  const lines = [];
  let currentPartial = '';
  let sessionStart = Date.now();
  let lastTurnBase = '';

  const committedText = () => lines.join('\n');

  const priorPlainText = () =>
    lines
      .map(stripTimestamp)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

  const emitPayload = (ws, { final = false } = {}) => {
    sendJson(ws, {
      type: 'transcript',
      committed: committedText(),
      partial: currentPartial,
      final,
    });
  };

  const pushLine = (text, atSeconds) => {
    const line = normalizeLine(text);
    if (!line) return;
    const stamped = `[${formatTimestamp(atSeconds)}] ${line}`;
    const lastPlain = stripTimestamp(lines[lines.length - 1] || '');
    if (lastPlain === line) return;
    lines.push(stamped);
  };

  const setPartial = (ws, text) => {
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    if (!clean) {
      emitPayload(ws, { final: false });
      return;
    }

    const prior = priorPlainText();
    if (!prior) {
      currentPartial = clean;
      lastTurnBase = '';
    } else if (clean.startsWith(prior)) {
      currentPartial = clean.slice(prior.length).trim() || clean;
      lastTurnBase = prior;
    } else if (prior.startsWith(clean)) {
      // ignore regressive partial
    } else {
      currentPartial = clean;
      lastTurnBase = prior;
    }

    emitPayload(ws, { final: false });
  };

  const commitTurn = (ws) => {
    const elapsed = Math.floor((Date.now() - sessionStart) / 1000);
    const toCommit = currentPartial.trim();
    if (toCommit) {
      const sentences = splitToSentenceLines(toCommit);
      if (sentences.length > 1) {
        sentences.forEach((sentence, index) => {
          pushLine(sentence, elapsed + index);
        });
      } else {
        pushLine(toCommit, elapsed);
      }
    }
    currentPartial = '';
    lastTurnBase = priorPlainText();
    emitPayload(ws, { final: true });
  };

  const finalize = (ws) => {
    if (currentPartial.trim()) {
      commitTurn(ws);
      return;
    }
    if (lines.length === 0 && lastTurnBase) {
      const elapsed = Math.floor((Date.now() - sessionStart) / 1000);
      splitToSentenceLines(lastTurnBase).forEach((sentence, index) => {
        pushLine(sentence, elapsed + index);
      });
    }
    emitPayload(ws, { final: true });
  };

  const resetSession = () => {
    lines.length = 0;
    currentPartial = '';
    lastTurnBase = '';
    sessionStart = Date.now();
  };

  return { setPartial, commitTurn, finalize, resetSession, committedText };
}

export async function handleLiveTranscribe(ws, apiKey) {
  if (!apiKey) {
    sendJson(ws, { type: 'error', error: 'GEMINI_API_KEY is not configured' });
    ws.close();
    return;
  }

  const ai = new GoogleGenAI({ apiKey, apiVersion: 'v1beta' });
  let session = null;
  let closed = false;
  const pendingAudio = [];
  const transcriptBuffer = createTranscriptBuffer();

  const config = {
    responseModalities: [Modality.AUDIO],
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    speechConfig: {
      voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
    },
    realtimeInputConfig: { turnCoverage: 'TURN_INCLUDES_ONLY_ACTIVITY' },
    systemInstruction: {
      parts: [{ text: 'Listen to the user and transcribe their speech accurately. Do not speak unless asked.' }],
    },
  };

  const sendAudio = (chunk) => {
    session.sendRealtimeInput({
      audio: {
        data: chunk.toString('base64'),
        mimeType: 'audio/pcm;rate=16000',
      },
    });
  };

  const flushAudio = () => {
    if (!session || closed) return;
    while (pendingAudio.length) {
      sendAudio(pendingAudio.shift());
    }
  };

  const cleanup = () => {
    if (closed) return;
    closed = true;
    try {
      session?.close();
    } catch {}
  };

  ws.on('message', (data, isBinary) => {
    if (closed) return;

    if (isBinary) {
      const chunk = Buffer.from(data);
      if (session) sendAudio(chunk);
      else pendingAudio.push(chunk);
      return;
    }

    try {
      const payload = JSON.parse(data.toString());
      if (payload.type === 'stop') {
        transcriptBuffer.finalize(ws);
        cleanup();
        ws.close();
      }
    } catch {}
  });

  ws.on('close', cleanup);
  ws.on('error', cleanup);

  try {
    session = await ai.live.connect({
      model: LIVE_MODEL,
      config,
      callbacks: {
        onopen: () => {
          flushAudio();
          sendJson(ws, { type: 'status', status: 'connected' });
        },
        onmessage: (message) => {
          const content = message?.serverContent;
          if (!content) return;

          const text = content.inputTranscription?.text?.trim();
          if (text) {
            transcriptBuffer.setPartial(ws, text);
            if (content.turnComplete) {
              transcriptBuffer.commitTurn(ws);
              sendJson(ws, { type: 'turn_complete' });
            }
          } else if (content.turnComplete) {
            transcriptBuffer.commitTurn(ws);
            sendJson(ws, { type: 'turn_complete' });
          }
        },
        onerror: (error) => {
          console.error('Gemini Live error:', error?.message || error);
          sendJson(ws, { type: 'error', error: error?.message || String(error) });
        },
        onclose: (event) => {
          if (event?.reason) {
            console.warn('Gemini Live closed:', event.reason);
          }
          if (!closed && event?.reason && !event.reason.includes('complete')) {
            sendJson(ws, { type: 'error', error: event.reason });
          }
          cleanup();
        },
      },
    });
  } catch (err) {
    console.error('Live transcribe session failed:', err);
    sendJson(ws, { type: 'error', error: err?.message || String(err) });
    ws.close();
  }
}
