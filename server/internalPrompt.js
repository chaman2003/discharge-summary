export const DISCHARGE_SUMMARY_JSON_SCHEMA = {
  hospital_details: 'Hospital name, patient name, consulting doctor, department, diagnosis/cause, age, blood group, gender, dates, ward/unit if mentioned',
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
      '\n\nREFERENCE DOCUMENT (use only facts that appear here or in the transcript):\n' +
      uploadedContext.trim().slice(0, 12000);
  }

  let hintBlock = '';
  if (hospitalHint.trim()) {
    hintBlock =
      '\n\nKNOWN HOSPITAL / PATIENT CONTEXT FROM THE FORM (copy ALL of these facts into hospital_details exactly, one per line):\n' +
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
- hospital_details MUST repeat every form field provided (hospital, patient, doctor, department, diagnosis, age, gender, blood group, admission date, discharge date), one per line.
- master_summary MUST summarize the full discharge conversation/transcript as a cohesive clinical narrative (who was seen, why admitted, treatment course, advice given, follow-up).
- prescription MUST NOT be empty if the conversation mentions medicines, doses, continuing treatment, or standard discharge therapy for the diagnosis. Quote or paraphrase any medications discussed. If only general treatment is implied, state the discharge medication plan in prose.
- Use clear, professional prose in each field (complete sentences, not bullet lists inside JSON strings).
- Extract clinical facts from the transcript and reference document. Use form context for demographic/hospital metadata.
- Do not omit clinically relevant statements from the transcript. Every distinct topic in the conversation should appear in at least one summary field.
- instructions and follow_up must reflect advice given in the conversation (e.g. weekly follow-up, fever monitoring, mask use).
- Never invent diagnoses, drugs, or dates not supported by the transcript, reference document, or form context.
${hintBlock}${contextBlock}

TRANSCRIPT:
${transcript.trim().slice(0, 12000)}
`;
}
