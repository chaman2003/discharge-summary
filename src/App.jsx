import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { extractUpload, saveHistoryEntry, summarize, updateHistoryEntry } from './api';
import HistoryPanel from './HistoryPanel';
import { HOSPITAL_NAME } from './constants';
import { downloadSummaryPdf, printSummary } from './pdf';
import { buildPatientBlock, normalizeSummaryForDisplay } from './transcriptUtils';
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

function defaultPatientDetails() {
  const today = new Date();
  const admission = new Date(today);
  admission.setDate(admission.getDate() - 7);
  return {
    hospital_name: HOSPITAL_NAME,
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
  const [hospital, setHospital] = useState(defaultPatientDetails);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [activeHistoryId, setActiveHistoryId] = useState(null);
  const [historyTick, setHistoryTick] = useState(0);
  const [manualTranscript, setManualTranscript] = useState('');
  const transcriptRef = useRef(null);

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
  const patientBlock = useMemo(() => buildPatientBlock(hospital), [hospital]);
  const displaySummary = useMemo(
    () => normalizeSummaryForDisplay(summary, patientBlock),
    [summary, patientBlock],
  );
  const hasSummary = Object.values(displaySummary).some(Boolean);
  const patientDetailsText = displaySummary.hospital_details || patientBlock;

  useEffect(() => {
    const el = transcriptRef.current;
    if (!el || !recording) return;
    el.scrollTop = el.scrollHeight;
  }, [transcript, recording]);

  const saveRecordingToHistory = useCallback(async (savedTranscript, audioBlob, summaryPayload = null) => {
    if (!savedTranscript && !audioBlob) return null;
    const entry = await saveHistoryEntry({
      audioBlob,
      transcript: savedTranscript,
      hospital: { ...hospital, hospital_name: HOSPITAL_NAME },
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
      hospital: { ...hospital, hospital_name: HOSPITAL_NAME },
    });
    const nextSummary = normalizeSummaryForDisplay({ ...EMPTY_SUMMARY, ...result }, patientBlock);
    setSummary(nextSummary);
    if (historyId) {
      await updateHistoryEntry(historyId, {
        transcript: text,
        hospital: { ...hospital, hospital_name: HOSPITAL_NAME },
        summary: nextSummary,
      });
      setHistoryTick((n) => n + 1);
    }
    return nextSummary;
  }, [activeHistoryId, hospital, patientBlock, uploadedContext]);

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
      setStatus('Summary ready.');
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
      setStatus('Reference document loaded. It will be included when the summary is generated.');
    } catch (err) {
      setStatus(err.message || 'Upload failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header-text">
          <p className="app-kicker">{HOSPITAL_NAME}</p>
          <h1>Discharge Summary</h1>
          <p>Record notes, attach a reference file, and generate a structured discharge summary.</p>
        </div>
        <div className="app-header-brand">
          <img
            src="/audio-processors/image.png"
            alt="Cortex Craft.AI"
            className="app-header-logo"
          />
        </div>
      </header>

      <section className="card">
        <div className="card-header">
          <h2><span className="step-num">1</span> Patient details</h2>
        </div>
        <div className="card-body">
          <div className="form-section">
            <h3 className="subsection-title">Patient information</h3>
            <div className="form-grid">
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
              <label className="span-full">
                Condition / diagnosis
                <input
                  value={hospital.condition}
                  onChange={(e) => setHospital({ ...hospital, condition: e.target.value })}
                  placeholder={CONDITION_PLACEHOLDER}
                />
              </label>
              <label className="compact">
                Age
                <select value={hospital.age} onChange={(e) => setHospital({ ...hospital, age: e.target.value })}>
                  {AGE_OPTIONS.map((age) => (
                    <option key={age} value={age}>{age}</option>
                  ))}
                </select>
              </label>
              <label className="compact">
                Blood group
                <select value={hospital.blood_group} onChange={(e) => setHospital({ ...hospital, blood_group: e.target.value })}>
                  {BLOOD_GROUP_OPTIONS.map((group) => (
                    <option key={group} value={group}>{group}</option>
                  ))}
                </select>
              </label>
              <label className="compact">
                Gender
                <select value={hospital.gender} onChange={(e) => setHospital({ ...hospital, gender: e.target.value })}>
                  {GENDER_OPTIONS.map((gender) => (
                    <option key={gender} value={gender}>{gender}</option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          <div className="form-section">
            <h3 className="subsection-title">Dates</h3>
            <div className="form-grid dates-grid">
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
                  setSummary(EMPTY_SUMMARY);
                  startRecord();
                }}
                disabled={busy}
              >
                Start recording
              </button>
            ) : (
              <span className="recording-note">Recording in progress — stop from the transcript section to generate the summary automatically.</span>
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
            ref={transcriptRef}
            className={`transcript${recording ? ' recording' : ''}`}
            value={transcript}
            readOnly={recording}
            onChange={(e) => {
              const value = e.target.value;
              setManualTranscript(value);
              setTranscriptText(value);
              setActiveHistoryId(null);
            }}
            placeholder="Each spoken turn appears on its own line with a timestamp (e.g. [0:05]). The summary is generated automatically when you stop recording."
          />
          {recording && (
            <div className="actions transcript-actions recording-active">
              <button
                type="button"
                className="danger stop-generate-btn"
                onClick={handleStopAndGenerateSummary}
                disabled={busy}
              >
                Stop recording and generate summary
              </button>
            </div>
          )}
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
              disabled={!hasSummary && !patientDetailsText}
            >
              Print summary
            </button>
            <button
              type="button"
              className="outline"
              onClick={() => downloadSummaryPdf(displaySummary, hospital)}
              disabled={!hasSummary && !patientDetailsText}
            >
              Download summary PDF
            </button>
          </div>
        </div>
        <div className="card-body">
          {!hasSummary && !patientDetailsText ? (
            <div className="empty-state">
              Stop recording to generate a structured discharge summary here.
            </div>
          ) : (
            <div className="summary-grid">
              <div className="summary-block">
                <h3>Patient Details</h3>
                <p className={patientDetailsText ? '' : 'empty'}>
                  {patientDetailsText || 'No patient details available.'}
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

      <HistoryPanel key={historyTick} />
    </div>
  );
}
