import { HOSPITAL_NAME } from './constants';

function capitalizeFirst(text) {
  if (!text) return '';
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function formatTimestamp(totalSeconds) {
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export function stripTimestamp(line) {
  return String(line || '').replace(/^\[\d+:\d{2}\]\s*/, '').trim();
}

export function normalizeLine(text) {
  let clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  clean = capitalizeFirst(clean);
  if (!/[.!?]$/.test(clean)) clean += '.';
  return clean;
}

/** @deprecated use normalizeLine */
export function normalizeSentence(text) {
  return normalizeLine(text);
}

export function linesFromText(text) {
  return String(text || '')
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function textFromLines(lines) {
  return (lines || []).filter(Boolean).join('\n');
}

export function appendLine(committedText, nextLine, recordStartMs = 0) {
  const line = normalizeLine(stripTimestamp(nextLine));
  if (!line) return (committedText || '').trim();

  const lines = linesFromText(committedText);
  const lastPlain = stripTimestamp(lines[lines.length - 1] || '');
  if (lastPlain === line) return textFromLines(lines);

  const elapsed = recordStartMs
    ? Math.floor((Date.now() - recordStartMs) / 1000)
    : 0;
  const stamped = `[${formatTimestamp(elapsed)}] ${line}`;
  lines.push(stamped);
  return textFromLines(lines);
}

/** @deprecated use appendLine */
export function appendSentence(committed, next) {
  return appendLine(committed, next);
}

export function buildLiveTranscript(committed, partial) {
  const left = (committed || '').trim();
  const right = (partial || '').replace(/\s+/g, ' ').trim();
  if (!left) return right;
  if (!right) return left;
  return `${left}\n${right}`;
}

export function finalizeTranscript(committed, partial, recordStartMs = 0) {
  return appendLine(committed, partial, recordStartMs);
}

export function splitTranscriptParagraphs(text) {
  const clean = String(text || '').trim();
  if (!clean) return [];
  const byNewline = linesFromText(clean).map(stripTimestamp);
  if (byNewline.length > 1) return byNewline;
  return clean
    .split(/(?<=[.!?])\s+/)
    .map((part) => stripTimestamp(part.trim()))
    .filter(Boolean);
}

export function formatTranscriptForPdf(text) {
  const paragraphs = splitTranscriptParagraphs(text);
  if (!paragraphs.length) return 'No transcript recorded.';
  const lines = linesFromText(text);
  if (lines.length > 1 && lines.some((line) => /^\[\d+:\d{2}\]/.test(line))) {
    return lines.join('\n\n');
  }
  return paragraphs.join('\n\n');
}

export function isCorruptedSummaryText(value) {
  if (value == null || value === '') return false;
  const text = String(value).trim();
  return /^(\[object Object\])+$/i.test(text) || text === '[object Object]';
}

export function fieldToDisplayText(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return isCorruptedSummaryText(trimmed) ? '' : trimmed;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return value.map(fieldToDisplayText).filter(Boolean).join('\n');
  }
  if (typeof value === 'object') {
    const labels = {
      patient_name: 'Patient',
      patient: 'Patient',
      consulting_doctor: 'Consulting doctor',
      doctor: 'Consulting doctor',
      department: 'Department',
      condition: 'Diagnosis / cause',
      diagnosis: 'Diagnosis / cause',
      age: 'Age',
      gender: 'Gender',
      blood_group: 'Blood group',
      admission_date: 'Admission',
      admission: 'Admission',
      discharge_date: 'Discharge',
      discharge: 'Discharge',
    };
    return Object.entries(value)
      .map(([key, item]) => {
        if (/hospital/i.test(key)) return '';
        const text = fieldToDisplayText(item);
        if (!text) return '';
        const label = labels[key] || key.replace(/_/g, ' ');
        return `${label}: ${text}`;
      })
      .filter(Boolean)
      .join('\n');
  }
  const asString = String(value).trim();
  return isCorruptedSummaryText(asString) ? '' : asString;
}

function lineKey(line) {
  return String(line || '').split(':')[0]?.trim().toLowerCase() || '';
}

function isHospitalLine(line) {
  const key = lineKey(line);
  return key === 'hospital' || key === 'hospital name';
}

export function dedupePatientLines(text) {
  const seen = new Set();
  return String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !isHospitalLine(line))
    .filter((line) => {
      const key = lineKey(line);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join('\n');
}

export function buildPatientBlock(hospital = {}) {
  const parts = [
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
  return dedupePatientLines(parts.join('\n'));
}

/** @deprecated use buildPatientBlock */
export function buildHospitalBlock(hospital) {
  return buildPatientBlock(hospital);
}

export function mergePatientDetails(aiDetails, formBlock) {
  const form = dedupePatientLines(formBlock || '');
  const ai = dedupePatientLines(fieldToDisplayText(aiDetails));
  if (!form) return ai;
  if (!ai) return form;

  const formKeys = new Set(form.split('\n').map(lineKey));
  const extraLines = ai
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !formKeys.has(lineKey(line)));
  return extraLines.length ? dedupePatientLines(`${form}\n${extraLines.join('\n')}`) : form;
}

/** @deprecated use mergePatientDetails */
export function mergeHospitalDetails(aiDetails, formBlock) {
  return mergePatientDetails(aiDetails, formBlock);
}

export function normalizeSummaryForDisplay(summary, patientFallbackText = '') {
  const keys = [
    'hospital_details',
    'master_summary',
    'reason_for_admission',
    'final_diagnosis',
    'prescription',
    'instructions',
    'condition_at_discharge',
    'follow_up',
  ];
  const normalized = {};
  for (const key of keys) {
    normalized[key] = fieldToDisplayText(summary?.[key]);
  }
  normalized.hospital_details = mergePatientDetails(normalized.hospital_details, patientFallbackText);
  return normalized;
}

export { HOSPITAL_NAME };
