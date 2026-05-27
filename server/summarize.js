import { GoogleGenAI } from '@google/genai';
import { buildSummarizePrompt, DISCHARGE_SUMMARY_JSON_SCHEMA } from './internalPrompt.js';

const SUMMARY_MODEL = 'gemini-2.5-flash-lite';

function stripFences(text) {
  let clean = (text || '').trim();
  if (clean.startsWith('```')) {
    clean = clean.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  }
  return clean.trim();
}

function emptySummary() {
  return Object.fromEntries(Object.keys(DISCHARGE_SUMMARY_JSON_SCHEMA).map((key) => [key, '']));
}

function isCorruptedSummaryText(value) {
  if (value == null || value === '') return false;
  return /^\[object Object\]$/i.test(String(value).trim());
}

function fieldToString(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return isCorruptedSummaryText(trimmed) ? '' : trimmed;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return value.map(fieldToString).filter(Boolean).join('\n');
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
        const text = fieldToString(item);
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

function patientBlockFromForm(hospital) {
  if (!hospital) return '';
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
  return parts.join('\n');
}

function stripTimestamp(line) {
  return String(line || '').replace(/^\[\d+:\d{2}\]\s*/, '').trim();
}

function splitTranscriptLines(transcript) {
  return String(transcript || '')
    .split(/\n+/)
    .map(stripTimestamp)
    .map((line) => line.trim())
    .filter(Boolean);
}

function splitSentences(text) {
  return String(text || '')
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

const MED_KEYWORDS = /prescri|medic|tablet|capsule|syrup|dose|dosage|mg|ml|twice|daily|once|antibiotic|paracetamol|ibuprofen|antimalarial|continue taking|take for|course of|discharge medication/i;

function extractPrescriptionFromTranscript(transcript) {
  const lines = splitTranscriptLines(transcript);
  const lineHits = lines.filter((line) => MED_KEYWORDS.test(line));
  if (lineHits.length) return lineHits.join(' ');

  const sentences = splitSentences(lines.join(' '));
  const sentenceHits = sentences.filter((sentence) => MED_KEYWORDS.test(sentence));
  if (sentenceHits.length) return sentenceHits.join(' ');

  return extractFromTranscript(transcript, [
    /\b(?:prescribed|prescription|medications?)\s*[:\-]?\s*([^.!?]{5,200})/i,
    /\b(?:take|taking|continue)\s+([^.!?]{5,160})/i,
  ]);
}

function extractFromTranscript(transcript, patterns) {
  const text = String(transcript || '');
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]?.trim()) return match[1].trim();
  }
  return '';
}

function buildMasterSummaryFromTranscript(transcript) {
  const lines = splitTranscriptLines(transcript);
  if (!lines.length) return '';
  if (lines.length <= 4) return lines.join(' ');
  return `${lines.slice(0, 3).join(' ')} ${lines.slice(3).join(' ')}`.trim();
}

function postFillSummary(summary, { transcript = '', hospital = {}, hospitalHint = '' } = {}) {
  const result = { ...summary };
  const formBlock = hospitalHint || patientBlockFromForm(hospital);

  result.hospital_details = formBlock || result.hospital_details;

  if (!result.final_diagnosis && hospital.condition) {
    result.final_diagnosis = hospital.condition;
  }

  if (!result.reason_for_admission && hospital.condition) {
    result.reason_for_admission = `The patient was admitted for treatment of ${hospital.condition}.`;
  }

  if (!result.prescription) {
    const meds = extractPrescriptionFromTranscript(transcript);
    if (meds) {
      result.prescription = meds.endsWith('.') ? meds : `${meds}.`;
    } else if (hospital.condition) {
      result.prescription = `Continue discharge medications as directed for ${hospital.condition}. Review the conversation for any specific drug names, doses, or duration mentioned by the clinician.`;
    }
  }

  if (!result.master_summary) {
    const built = buildMasterSummaryFromTranscript(transcript);
    if (built) result.master_summary = built.endsWith('.') ? built : `${built}.`;
  }

  if (!result.follow_up) {
    const followLines = splitTranscriptLines(transcript).filter((line) =>
      /follow|every week|next week|visit us|appointment|see you|until you/i.test(line),
    );
    if (followLines.length) {
      result.follow_up = followLines.join(' ');
    } else {
      const followUp = extractFromTranscript(transcript, [
        /\b(?:follow[- ]?up|follow us up|visit us|come back|next week|every week|appointment|see you)[^.!?]*/i,
      ]);
      if (followUp) result.follow_up = followUp.endsWith('.') ? followUp : `${followUp}.`;
    }
  }

  if (!result.instructions) {
    const instructionLines = splitTranscriptLines(transcript).filter((line) =>
      /fever|cold|mask|rest|diet|avoid|monitor|make sure|wear|continue/i.test(line),
    );
    if (instructionLines.length) {
      result.instructions = instructionLines.join(' ');
    } else {
      const instructions = extractFromTranscript(transcript, [
        /\b(?:please continue|wear your|rest|diet|avoid|monitor|make sure|get any fever)[^.!?]*/i,
      ]);
      if (instructions) result.instructions = instructions.endsWith('.') ? instructions : `${instructions}.`;
    }
  }

  if (!result.condition_at_discharge) {
    const stable = /stable|recover|well|improv|no acute|discharge/i.test(transcript);
    if (stable) {
      result.condition_at_discharge = 'The patient was discharged in stable condition based on the discharge conversation.';
    }
  }

  return result;
}

function normalizeSummaryFields(parsed, hospitalHint = '') {
  const result = emptySummary();
  if (!parsed || typeof parsed !== 'object') return result;

  for (const key of Object.keys(result)) {
    result[key] = fieldToString(parsed[key]);
  }

  result.hospital_details = hospitalHint.trim() || result.hospital_details;

  return result;
}

function parseSummary(raw, hospitalHint = '') {
  try {
    const parsed = JSON.parse(stripFences(raw));
    return normalizeSummaryFields(parsed, hospitalHint);
  } catch {
    const result = emptySummary();
    if (raw?.trim()) result.master_summary = raw.trim();
    result.hospital_details = hospitalHint.trim();
    return result;
  }
}

function fallbackSummary(transcript, hospitalHint = '') {
  const lines = splitTranscriptLines(transcript);
  const result = emptySummary();
  result.master_summary = lines.length
    ? lines.join(' ')
    : 'No transcript provided.';
  result.hospital_details = hospitalHint.trim();
  return result;
}

export async function generateDischargeSummary({
  apiKey,
  transcript,
  uploadedContext = '',
  hospitalHint = '',
  hospital = {},
}) {
  const fallback = fallbackSummary(transcript, hospitalHint);
  if (!apiKey || !transcript?.trim()) {
    return postFillSummary(fallback, { transcript, hospital, hospitalHint });
  }

  const prompt = buildSummarizePrompt({ transcript, uploadedContext, hospitalHint });
  const ai = new GoogleGenAI({ apiKey });

  try {
    const response = await ai.models.generateContent({
      model: SUMMARY_MODEL,
      contents: prompt,
      config: {
        temperature: 0.2,
        topP: 0.9,
        maxOutputTokens: 4096,
      },
    });
    const raw = (response.text || '').trim();
    const parsed = raw ? parseSummary(raw, hospitalHint) : fallback;
    return postFillSummary(parsed, { transcript, hospital, hospitalHint });
  } catch {
    return postFillSummary(fallback, { transcript, hospital, hospitalHint });
  }
}
