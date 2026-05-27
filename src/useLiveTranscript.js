import { useCallback, useMemo, useRef, useState } from 'react';
import { transcribeWebSocketUrl } from './api';
import { buildLiveTranscript, finalizeTranscript } from './transcriptUtils';

const WORKLET_URL = `${import.meta.env.BASE_URL}audio-processors/capture.worklet.js`;

function pickRecorderMimeType() {
  const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
  return types.find((type) => MediaRecorder.isTypeSupported(type)) || '';
}

function toPcm16(float32Array) {
  const pcm = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i++) {
    const sample = Math.max(-1, Math.min(1, float32Array[i]));
    pcm[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return pcm.buffer;
}

function downsample(buffer, sampleRate, outputSampleRate) {
  if (sampleRate <= outputSampleRate) return buffer;
  const ratio = sampleRate / outputSampleRate;
  const result = new Float32Array(Math.round(buffer.length / ratio));
  for (let i = 0; i < result.length; i++) {
    const start = Math.round(i * ratio);
    const end = Math.round((i + 1) * ratio);
    let sum = 0;
    for (let j = start; j < end; j++) sum += buffer[j] || 0;
    result[i] = sum / Math.max(1, end - start);
  }
  return result;
}

function trimTranscriptText(text) {
  return String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
}

export function useLiveTranscript() {
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState('');
  const [committed, setCommitted] = useState('');
  const [partial, setPartial] = useState('');
  const sessionRef = useRef(null);
  const committedRef = useRef('');
  const partialRef = useRef('');
  const recordStartRef = useRef(0);

  const transcript = useMemo(
    () => buildLiveTranscript(committed, partial),
    [committed, partial],
  );

  const resetTranscript = useCallback(() => {
    committedRef.current = '';
    partialRef.current = '';
    setCommitted('');
    setPartial('');
  }, []);

  const syncFromServer = useCallback((serverCommitted, serverPartial) => {
    const nextCommitted = trimTranscriptText(serverCommitted);
    const nextPartial = String(serverPartial || '').replace(/\s+/g, ' ').trim();
    committedRef.current = nextCommitted;
    partialRef.current = nextPartial;
    setCommitted(nextCommitted);
    setPartial(nextPartial);
  }, []);

  const commitPartialLocally = useCallback(() => {
    if (!partialRef.current.trim()) return committedRef.current;
    const merged = finalizeTranscript(committedRef.current, partialRef.current, recordStartRef.current);
    committedRef.current = merged;
    partialRef.current = '';
    setCommitted(merged);
    setPartial('');
    return merged;
  }, []);

  const applyTranscriptPayload = useCallback((data) => {
    if (data.committed !== undefined || data.partial !== undefined) {
      syncFromServer(data.committed ?? committedRef.current, data.partial ?? '');
      return;
    }

    const clean = String(data.text || '').replace(/\s+/g, ' ').trim();
    if (!clean && !data.final) return;

    if (data.final) {
      const merged = finalizeTranscript(
        committedRef.current,
        clean || partialRef.current,
        recordStartRef.current,
      );
      committedRef.current = merged;
      partialRef.current = '';
      setCommitted(merged);
      setPartial('');
      return;
    }

    partialRef.current = clean;
    setPartial(clean);
  }, [syncFromServer]);

  const stop = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return Promise.resolve(null);

    return new Promise((resolve) => {
      const finish = (audioBlob) => {
        const finalText = commitPartialLocally();
        try {
          if (session.ws?.readyState === WebSocket.OPEN) {
            session.ws.send(JSON.stringify({ type: 'stop' }));
          }
        } catch {}
        const ws = session.ws;
        setTimeout(() => {
          try {
            ws?.close();
          } catch {}
        }, 150);
        try {
          session.mediaStream?.getTracks?.().forEach((t) => t.stop());
        } catch {}
        try {
          session.captureContext?.close?.();
        } catch {}
        sessionRef.current = null;
        setRecording(false);
        resolve({ audioBlob: audioBlob || null, transcript: committedRef.current || finalText });
      };

      if (session.recorder && session.recorder.state !== 'inactive') {
        session.recorder.onstop = () => {
          const type = session.recorder.mimeType || 'audio/webm';
          const blob = session.chunks?.length ? new Blob(session.chunks, { type }) : null;
          finish(blob);
        };
        try {
          session.recorder.stop();
        } catch {
          finish(null);
        }
        return;
      }

      finish(null);
    });
  }, [commitPartialLocally]);

  const start = useCallback(async () => {
    setError('');
    await stop();
    resetTranscript();
    recordStartRef.current = Date.now();

    const ws = new WebSocket(transcribeWebSocketUrl());
    ws.binaryType = 'arraybuffer';

    await new Promise((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error('WebSocket connection failed'));
    });

    const session = { ws, liveReady: false, chunks: [] };
    sessionRef.current = session;

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'status' && data.status === 'connected') {
          session.liveReady = true;
          setRecording(true);
        } else if (data.type === 'transcript') {
          applyTranscriptPayload(data);
        } else if (data.type === 'error') {
          setError(data.error || 'Transcription error');
          void stop();
        }
      } catch {}
    };

    ws.onclose = () => {
      if (sessionRef.current === session) {
        sessionRef.current = null;
        setRecording(false);
      }
    };

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      session.mediaStream = stream;

      const mimeType = pickRecorderMimeType();
      if (mimeType) {
        session.recorder = new MediaRecorder(stream, { mimeType });
        session.recorder.ondataavailable = (event) => {
          if (event.data?.size) session.chunks.push(event.data);
        };
        session.recorder.start(250);
      }

      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioCtx();
      session.captureContext = ctx;
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }
      await ctx.audioWorklet.addModule(WORKLET_URL);
      const source = ctx.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(ctx, 'audio-capture-processor');
      const mute = ctx.createGain();
      mute.gain.value = 0;
      node.port.onmessage = (event) => {
        if (event.data?.type !== 'audio' || ws.readyState !== WebSocket.OPEN || !session.liveReady) return;
        ws.send(toPcm16(downsample(event.data.data, ctx.sampleRate, 16000)));
      };
      source.connect(node);
      node.connect(mute);
      mute.connect(ctx.destination);
    } catch (err) {
      await stop();
      setError(err?.name === 'NotAllowedError' ? 'Microphone access denied.' : err?.message || 'Mic setup failed');
    }
  }, [applyTranscriptPayload, resetTranscript, stop]);

  const setTranscriptText = useCallback((text) => {
    const clean = trimTranscriptText(text);
    committedRef.current = clean;
    partialRef.current = '';
    setCommitted(clean);
    setPartial('');
  }, []);

  return {
    recording,
    error,
    transcript,
    start,
    stop,
    resetTranscript,
    setTranscriptText,
  };
}
