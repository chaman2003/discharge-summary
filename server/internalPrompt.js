export const DISCHARGE_SUMMARY_JSON_SCHEMA = {
  hospital_details: 'Patient name, consulting doctor, department, diagnosis/cause, age, blood group, gender, admission and discharge dates',
  master_summary: 'Narrative summary of the entire discharge conversation',
  reason_for_admission: 'Why the patient was admitted',
  final_diagnosis: 'Primary diagnosis or working diagnosis at discharge',
  prescription: 'Medications prescribed with dose/frequency when stated',
  instructions: 'Care instructions, activity/diet restrictions, warning signs',
  condition_at_discharge: 'Patient status at discharge',
  follow_up: 'Follow-up appointments, tests, or callbacks',
};

export function buildSummarizePrompt({ transcript, uploadedContext = '', hospitalHint = '' }) {
  let contextBlock = '';
  if (uploadedContext.trim()) {
    contextBlock =
      '\n\nREFERENCE DOCUMENT (incorporate relevant clinical facts from this attachment into the appropriate summary fields — diagnosis, medications, instructions, follow-up, etc.):\n' +
      uploadedContext.trim().slice(0, 12000);
  }

  let hintBlock = '';
  if (hospitalHint.trim()) {
    hintBlock =
      '\n\nKNOWN PATIENT CONTEXT FROM THE FORM (copy ALL of these facts into hospital_details exactly, one per line — do NOT include hospital name):\n' +
      hospitalHint.trim();
  }

  return `You are a clinical documentation assistant. Produce a structured hospital discharge summary from the transcript below.
Return ONLY valid JSON (no markdown fences) with exactly these string fields:
- hospital_details
- master_summary
- reason_for_admission
- final_diagnosis
- prescription
- instructions
- condition_at_discharge
- follow_up

Rules:
- Every field value MUST be a plain string, never a nested JSON object or array.
- Do NOT include the hospital name anywhere. The hospital letterhead is added separately.
- hospital_details is PATIENT DETAILS only: patient, consulting doctor, department, diagnosis/cause, age, gender, blood group, admission date, discharge date — one fact per line, no duplicates.
- master_summary MUST summarize the full discharge conversation/transcript as a cohesive clinical narrative (who was seen, why admitted, treatment course, advice given, follow-up).
- If a reference document is provided, merge its relevant facts into the correct fields (prescription, diagnosis, instructions, follow-up) when supported by the transcript or attachment.
- prescription MUST NOT be empty if the conversation or reference document mentions medicines, doses, continuing treatment, or standard discharge therapy for the diagnosis.
- Use clear, professional prose in each field (complete sentences, not bullet lists inside JSON strings).
- Extract clinical facts from the transcript and reference document. Use form context for patient demographics and dates.
- Do not omit clinically relevant statements from the transcript. Every distinct topic should appear in at least one summary field.
- instructions and follow_up must reflect advice given in the conversation or reference document.
- Never invent diagnoses, drugs, or dates not supported by the transcript, reference document, or form context.
${hintBlock}${contextBlock}

TRANSCRIPT:
${transcript.trim().slice(0, 12000)}
`;
}
