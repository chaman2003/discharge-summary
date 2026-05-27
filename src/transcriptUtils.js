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
      hospital_name: 'Hospital',
      hospital: 'Hospital',
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

export function mergeHospitalDetails(aiDetails, formBlock) {
  const form = (formBlock || '').trim();
  const ai = fieldToDisplayText(aiDetails).trim();
  if (!form) return ai;
  if (!ai || ai === form) return form;
  const formLines = new Set(form.split('\n').map((line) => line.trim().toLowerCase()));
  const extraLines = ai
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !formLines.has(line.toLowerCase()));
  return extraLines.length ? `${form}\n${extraLines.join('\n')}` : form;
}

export function normalizeSummaryForDisplay(summary, hospitalFallbackText = '') {
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
  normalized.hospital_details = mergeHospitalDetails(normalized.hospital_details, hospitalFallbackText);
  return normalized;
}
