import { useCallback, useMemo, useState } from 'react';
import { extractUpload, saveHistoryEntry, summarize, updateHistoryEntry } from './api';
import HistoryPanel from './HistoryPanel';
import { downloadSummaryPdf, downloadTranscriptPdf, printSummary } from './pdf';
import { normalizeSummaryForDisplay } from './transcriptUtils';
import { useLiveTranscript } from './useLiveTranscript';

const EMPTY_SUMMARY = {
  hospital_details: '',
  master_summary: '',
  reason_for_admission: '',
  final_diagnosis: '',
  prescription: '',
  instructions: '',
  condition_at_discharge: '',
  follow_up: '',
};

const SUMMARY_FIELDS = [
  { key: 'master_summary', label: 'Master Summary (Conversation)' },
  { key: 'reason_for_admission', label: 'Reason for Admission' },
  { key: 'final_diagnosis', label: 'Final Diagnosis' },
  { key: 'prescription', label: 'Prescription' },
  { key: 'instructions', label: 'Instructions' },
  { key: 'condition_at_discharge', label: 'Condition at Discharge' },
  { key: 'follow_up', label: 'Follow Up' },
];

const AGE_OPTIONS = Array.from({ length: 100 }, (_, i) => String(i + 1));
const GENDER_OPTIONS = ['Male', 'Female', 'Other'];
const BLOOD_GROUP_OPTIONS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const CONDITION_PLACEHOLDER = 'e.g. Appendicitis, Jaundice, Pneumonia';

function formatDateInput(date) {
  return date.toISOString().slice(0, 10);
}

function defaultHospitalDetails() {
  const today = new Date();
  const admission = new Date(today);
  admission.setDate(admission.getDate() - 7);
  return {
    hospital_name: 'Smile Care Hospital',
    patient_name: 'Kumar',
    consulting_doctor: 'Dr. Priya Sharma',
    department: 'General Medicine',
    condition: 'Malaria',
    age: '58',
    blood_group: 'B+',
    gender: 'Male',
    admission_date: formatDateInput(admission),
    discharge_date: formatDateInput(today),
  };
}

function hospitalBlockFromForm(hospital) {
  const parts = [
    hospital.hospital_name && `Hospital: ${hospital.hospital_name}`,
    hospital.patient_name && `Patient: ${hospital.patient_name}`,
    hospital.consulting_doctor && `Consulting doctor: ${hospital.consulting_doctor}`,
    hospital.department && `Department: ${hospital.department}`,
    hospital.condition && `Diagnosis / cause: ${hospital.condition}`,
    hospital.age && `Age: ${hospital.age}`,
    hospital.blood_group && `Blood group: ${hospital.blood_group}`,
    hospital.gender && `Gender: ${hospital.gender}`,
    hospital.admission_date && `Admission: ${hospital.admission_date}`,
    hospital.discharge_date && `Discharge: ${hospital.discharge_date}`,
  ].filter(Boolean);
  return parts.join('\n');
}

function StatusAlert({ message, error }) {
  if (!message) return null;
  return (
    <div className={`alert ${error ? 'error' : 'info'}`} role="status">
      {message}
    </div>
  );
}

export default function App() {
  const [uploadedContext, setUploadedContext] = useState('');
  const [uploadName, setUploadName] = useState('');
  const [summary, setSummary] = useState(EMPTY_SUMMARY);
  const [hospital, setHospital] = useState(defaultHospitalDetails);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [activeHistoryId, setActiveHistoryId] = useState(null);
  const [historyTick, setHistoryTick] = useState(0);
  const [manualTranscript, setManualTranscript] = useState('');

  const {
    recording,
    error: recordError,
    transcript: liveTranscript,
    start: startRecord,
    stop: stopRecord,
    resetTranscript,
    setTranscriptText,
  } = useLiveTranscript();

  const transcript = recording ? liveTranscript : (manualTranscript || liveTranscript);
  const hospitalBlock = useMemo(() => hospitalBlockFromForm(hospital), [hospital]);
  const displaySummary = useMemo(
    () => normalizeSummaryForDisplay(summary, hospitalBlock),
    [summary, hospitalBlock],
  );
  const hasSummary = Object.values(displaySummary).some(Boolean);
  const hospitalDetailsText = displaySummary.hospital_details || hospitalBlock;

  const saveRecordingToHistory = useCallback(async (savedTranscript, audioBlob, summaryPayload = null) => {
    if (!savedTranscript && !audioBlob) return null;
    const entry = await saveHistoryEntry({
      audioBlob,
      transcript: savedTranscript,
      hospital,
      summary: summaryPayload,
    });
    setActiveHistoryId(entry.id);
    setHistoryTick((n) => n + 1);
    return entry;
  }, [hospital]);

  const runSummarize = useCallback(async (text, historyId = activeHistoryId) => {
    const result = await summarize({
      transcript: text,
      uploadedContext,
      hospital,
    });
    const nextSummary = normalizeSummaryForDisplay({ ...EMPTY_SUMMARY, ...result }, hospitalBlock);
    setSummary(nextSummary);
    if (historyId) {
      await updateHistoryEntry(historyId, {
        transcript: text,
        hospital,
        summary: nextSummary,
      });
      setHistoryTick((n) => n + 1);
    }
    return nextSummary;
  }, [activeHistoryId, hospital, hospitalBlock, uploadedContext]);

  const handleStopRecord = async () => {
    setBusy(true);
    setStatus('Saving recording…');
    try {
      const result = await stopRecord();
      const audioBlob = result?.audioBlob || null;
      const savedTranscript = (result?.transcript || transcript).trim();
      setManualTranscript(savedTranscript);
      setTranscriptText(savedTranscript);
      if (!savedTranscript && !audioBlob) {
        setStatus('Recording stopped.');
        return;
      }
      await saveRecordingToHistory(savedTranscript, audioBlob, hasSummary ? displaySummary : null);
      setStatus('Recording saved to history.');
    } catch (err) {
      setStatus(err.message || 'Could not save recording');
    } finally {
      setBusy(false);
    }
  };

  const handleStopAndGenerateSummary = async () => {
    setBusy(true);
    setStatus('Stopping recording and generating summary…');
    try {
      let text = transcript.trim();
      let audioBlob = null;

      if (recording) {
        const result = await stopRecord();
        audioBlob = result?.audioBlob || null;
        text = (result?.transcript || text).trim();
        setManualTranscript(text);
        setTranscriptText(text);
      }

      if (!text) {
        setStatus('No transcript to summarize.');
        return;
      }

      let historyId = activeHistoryId;
      if (audioBlob || !historyId) {
        const entry = await saveRecordingToHistory(text, audioBlob, null);
        historyId = entry?.id || historyId;
      }

      setStatus('Generating structured summary…');
      await runSummarize(text, historyId);
      setStatus('Summary ready. Download PDFs below.');
    } catch (err) {
      setStatus(err.message || 'Could not stop and generate summary');
    } finally {
      setBusy(false);
    }
  };

  const onUpload = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBusy(true);
    setStatus(`Extracting text from ${file.name}…`);
    try {
      const data = await extractUpload(file);
      setUploadedContext(data.text || '');
      setUploadName(data.filename || file.name);
      setStatus('Reference document loaded. It will be included when you generate the summary.');
    } catch (err) {
      setStatus(err.message || 'Upload failed');
    } finally {
      setBusy(false);
    }
  };

  const onGenerateSummary = async () => {
    if (!transcript.trim()) {
      setStatus('Record or type a transcript first.');
      return;
    }
    setBusy(true);
    setStatus('Generating structured summary…');
    try {
      await runSummarize(transcript.trim());
      setStatus('Summary ready. Download PDFs below.');
    } catch (err) {
      setStatus(err.message || 'Summary failed');
    } finally {
      setBusy(false);
    }
  };

  const loadHistoryEntry = useCallback(async (entry) => {
    const text = entry.transcript || '';
    const hospitalData = { ...defaultHospitalDetails(), ...(entry.hospital || {}) };
    const block = hospitalBlockFromForm(hospitalData);
    const normalized = normalizeSummaryForDisplay({ ...EMPTY_SUMMARY, ...(entry.summary || {}) }, block);

    setManualTranscript(text);
    setTranscriptText(text);
    setHospital(hospitalData);
    setSummary(normalized);
    setActiveHistoryId(entry.id);
    setStatus('Loaded saved session from history.');

    if (entry.summary && entry.id) {
      const rawHadCorruption = Object.values(entry.summary).some(
        (value) => typeof value === 'string' && /^\[object Object\]$/i.test(value.trim()),
      );
      if (rawHadCorruption) {
        try {
          await updateHistoryEntry(entry.id, { summary: normalized });
          setHistoryTick((n) => n + 1);
        } catch {}
      }
    }
  }, [setTranscriptText]);

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header-text">
          <h1>Discharge Summary</h1>
          <p>Record clinical notes, optionally attach a reference document, and generate a structured discharge summary.</p>
        </div>
        <span className="app-badge">Clinical notes</span>
      </header>

      <section className="card">
        <div className="card-header">
          <h2><span className="step-num">1</span> Hospital details</h2>
        </div>
        <div className="card-body">
          <p className="subsection-title">Facility &amp; patient</p>
          <div className="grid two">
            <label>
              Hospital name
              <input value={hospital.hospital_name} onChange={(e) => setHospital({ ...hospital, hospital_name: e.target.value })} />
            </label>
            <label>
              Patient name
              <input value={hospital.patient_name} onChange={(e) => setHospital({ ...hospital, patient_name: e.target.value })} />
            </label>
            <label>
              Consulting doctor
              <input value={hospital.consulting_doctor} onChange={(e) => setHospital({ ...hospital, consulting_doctor: e.target.value })} />
            </label>
            <label>
              Department
              <input value={hospital.department} onChange={(e) => setHospital({ ...hospital, department: e.target.value })} />
            </label>
            <label>
              Condition / diagnosis
              <input
                value={hospital.condition}
                onChange={(e) => setHospital({ ...hospital, condition: e.target.value })}
                placeholder={CONDITION_PLACEHOLDER}
              />
            </label>
            <label>
              Age
              <select value={hospital.age} onChange={(e) => setHospital({ ...hospital, age: e.target.value })}>
                {AGE_OPTIONS.map((age) => (
                  <option key={age} value={age}>{age}</option>
                ))}
              </select>
            </label>
            <label>
              Blood group
              <select value={hospital.blood_group} onChange={(e) => setHospital({ ...hospital, blood_group: e.target.value })}>
                {BLOOD_GROUP_OPTIONS.map((group) => (
                  <option key={group} value={group}>{group}</option>
                ))}
              </select>
            </label>
            <label>
              Gender
              <select value={hospital.gender} onChange={(e) => setHospital({ ...hospital, gender: e.target.value })}>
                {GENDER_OPTIONS.map((gender) => (
                  <option key={gender} value={gender}>{gender}</option>
                ))}
              </select>
            </label>
          </div>

          <p className="subsection-title">Dates</p>
          <div className="grid two">
            <label>
              Admission date
              <input type="date" value={hospital.admission_date} onChange={(e) => setHospital({ ...hospital, admission_date: e.target.value })} />
            </label>
            <label>
              Discharge date
              <input type="date" value={hospital.discharge_date} onChange={(e) => setHospital({ ...hospital, discharge_date: e.target.value })} />
            </label>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-header">
          <h2><span className="step-num">2</span> Capture</h2>
        </div>
        <div className="card-body">
          <div className="actions compact">
            {!recording ? (
              <button
                type="button"
                className="primary"
                onClick={() => {
                  resetTranscript();
                  setManualTranscript('');
                  startRecord();
                }}
                disabled={busy}
              >
                Start recording
              </button>
            ) : (
              <span className="recording-note">Recording in progress — use the transcript section to stop and generate.</span>
            )}
            <label className="file-btn">
              Upload reference (PDF, TXT, MD)
              <input type="file" accept=".pdf,.txt,.md,.docx" onChange={onUpload} disabled={busy} hidden />
            </label>
          </div>
          {uploadName && <span className="upload-chip">Reference: {uploadName}</span>}
          <StatusAlert message={recordError || status} error={!!recordError} />
        </div>
      </section>

      <section className="card transcript-card">
        <div className="card-header">
          <h2>
            <span className="step-num">3</span>
            Transcript
            {recording && <span className="pill live">Live</span>}
          </h2>
          <button
            type="button"
            className="ghost"
            onClick={() => {
              resetTranscript();
              setManualTranscript('');
              setActiveHistoryId(null);
            }}
            disabled={!transcript.trim() || recording}
          >
            Clear
          </button>
        </div>
        <div className="card-body">
          <textarea
            className="transcript"
            value={transcript}
            readOnly={recording}
            onChange={(e) => {
              const value = e.target.value;
              setManualTranscript(value);
              setTranscriptText(value);
              setActiveHistoryId(null);
            }}
            placeholder="Each spoken turn appears on its own line with a timestamp (e.g. [0:05]). You can edit before generating a summary."
          />
          <div className={`actions transcript-actions${recording ? ' recording-active' : ''}`}>
            {recording ? (
              <button
                type="button"
                className="danger stop-generate-btn"
                onClick={handleStopAndGenerateSummary}
                disabled={busy}
              >
                Stop recording and generate summary
              </button>
            ) : (
              <button type="button" className="primary" onClick={onGenerateSummary} disabled={busy || !transcript.trim()}>
                Generate summary
              </button>
            )}
            <button type="button" className="outline" onClick={() => downloadTranscriptPdf(transcript, hospital)} disabled={!transcript.trim()}>
              Download transcript PDF
            </button>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-header">
          <h2><span className="step-num">4</span> Summary</h2>
          <div className="header-actions">
            <button
              type="button"
              className="outline"
              onClick={() => printSummary(displaySummary, hospital)}
              disabled={!hasSummary && !hospitalDetailsText}
            >
              Print summary
            </button>
            <button
              type="button"
              className="outline"
              onClick={() => downloadSummaryPdf(displaySummary, hospital)}
              disabled={!hasSummary && !hospitalDetailsText}
            >
              Download summary PDF
            </button>
          </div>
        </div>
        <div className="card-body">
          {!hasSummary && !hospitalDetailsText ? (
            <div className="empty-state">
              Generate a summary from your transcript to see structured clinical sections here.
            </div>
          ) : (
            <div className="summary-grid">
              <div className="summary-block">
                <h3>Hospital Details</h3>
                <p className={hospitalDetailsText ? '' : 'empty'}>
                  {hospitalDetailsText || 'No hospital details available.'}
                </p>
              </div>

              {SUMMARY_FIELDS.map(({ key, label }) => {
                const text = displaySummary[key];
                return (
                  <div className="summary-block" key={key}>
                    <h3>{label}</h3>
                    <p className={text ? '' : 'empty'}>{text || 'Not generated yet.'}</p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      <HistoryPanel key={historyTick} onLoadEntry={loadHistoryEntry} />
    </div>
  );
}
