import { useCallback, useEffect, useState } from 'react';
import {
  deleteHistoryEntry,
  fetchHistoryEntry,
  fetchHistoryList,
  historyAudioUrl,
} from './api';
import { downloadSummaryPdf, downloadTranscriptPdf } from './pdf';

function formatWhen(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export default function HistoryPanel({ onLoadEntry }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setItems(await fetchHistoryList());
    } catch (err) {
      setError(err.message || 'Could not load history');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleOpen = async (id) => {
    setBusyId(id);
    try {
      const entry = await fetchHistoryEntry(id);
      onLoadEntry(entry);
    } catch (err) {
      setError(err.message || 'Could not open entry');
    } finally {
      setBusyId('');
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this saved session?')) return;
    setBusyId(id);
    try {
      await deleteHistoryEntry(id);
      await refresh();
    } catch (err) {
      setError(err.message || 'Delete failed');
    } finally {
      setBusyId('');
    }
  };

  const handleDownloadTranscript = async (id) => {
    setBusyId(id);
    try {
      const entry = await fetchHistoryEntry(id);
      downloadTranscriptPdf(entry.transcript || '', entry.hospital || {});
    } catch (err) {
      setError(err.message || 'Download failed');
    } finally {
      setBusyId('');
    }
  };

  const handleDownloadSummary = async (id) => {
    setBusyId(id);
    try {
      const entry = await fetchHistoryEntry(id);
      downloadSummaryPdf(entry.summary || {}, entry.hospital || {});
    } catch (err) {
      setError(err.message || 'Download failed');
    } finally {
      setBusyId('');
    }
  };

  return (
    <section className="card">
      <div className="card-header">
        <h2><span className="step-num">5</span> History</h2>
        <button type="button" className="ghost" onClick={refresh} disabled={loading}>
          Refresh
        </button>
      </div>
      <div className="card-body">
        {error && <div className="alert error" role="alert">{error}</div>}
        {loading ? (
          <p className="muted">Loading saved sessions…</p>
        ) : !items.length ? (
          <div className="empty-state">
            Recorded sessions appear here automatically after you stop recording.
          </div>
        ) : (
          <div className="history-list">
            {items.map((item) => (
              <article className="history-item" key={item.id}>
                <div className="history-item-head">
                  <div>
                    <strong>{item.patient_name || 'Unknown patient'}</strong>
                    <span className="history-meta">
                      {item.condition || 'No diagnosis'} · {formatWhen(item.created_at)}
                    </span>
                  </div>
                  {item.has_audio && (
                    <audio controls preload="none" src={historyAudioUrl(item.id)} className="history-audio" />
                  )}
                </div>
                <p className="history-preview">{item.transcript_preview || 'No transcript saved.'}</p>
                <div className="actions history-actions">
                  <button type="button" className="primary" disabled={busyId === item.id} onClick={() => handleOpen(item.id)}>
                    Open
                  </button>
                  <button type="button" className="outline" disabled={busyId === item.id} onClick={() => handleDownloadTranscript(item.id)}>
                    Transcript PDF
                  </button>
                  <button
                    type="button"
                    className="outline"
                    disabled={busyId === item.id || !item.has_summary}
                    onClick={() => handleDownloadSummary(item.id)}
                  >
                    Summary PDF
                  </button>
                  <a className="outline link-btn" href={historyAudioUrl(item.id)} download={`${item.patient_name || 'recording'}.webm`}>
                    Download audio
                  </a>
                  <button type="button" className="ghost" disabled={busyId === item.id} onClick={() => handleDelete(item.id)}>
                    Delete
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
