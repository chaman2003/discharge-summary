import { jsPDF } from 'jspdf';
import { fieldToDisplayText, formatTranscriptForPdf, mergeHospitalDetails } from './transcriptUtils';

function addWrapped(doc, text, x, y, maxWidth, lineHeight) {
  const lines = doc.splitTextToSize(String(text || ''), maxWidth);
  lines.forEach((line) => {
    doc.text(line, x, y);
    y += lineHeight;
  });
  return y;
}

function buildHospitalBlock(hospital) {
  return [
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
  ].filter(Boolean).join('\n');
}

function summarySections(summary, hospital) {
  const hospitalBlock = buildHospitalBlock(hospital);
  return [
    ['Hospital Details', mergeHospitalDetails(summary.hospital_details, hospitalBlock)],
    ['Master Summary', fieldToDisplayText(summary.master_summary)],
    ['Reason for Admission', fieldToDisplayText(summary.reason_for_admission)],
    ['Final Diagnosis', fieldToDisplayText(summary.final_diagnosis)],
    ['Prescription', fieldToDisplayText(summary.prescription)],
    ['Instructions', fieldToDisplayText(summary.instructions)],
    ['Condition at Discharge', fieldToDisplayText(summary.condition_at_discharge)],
    ['Follow Up', fieldToDisplayText(summary.follow_up)],
  ];
}

export function downloadTranscriptPdf(transcript, hospital) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const margin = 14;
  const maxW = doc.internal.pageSize.getWidth() - margin * 2;
  let y = margin;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('Live Transcript', margin, y);
  y += 8;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  const meta = [
    hospital.hospital_name && `Hospital: ${hospital.hospital_name}`,
    hospital.patient_name && `Patient: ${hospital.patient_name}`,
    hospital.consulting_doctor && `Consulting doctor: ${hospital.consulting_doctor}`,
    hospital.department && `Department: ${hospital.department}`,
    hospital.condition && `Diagnosis / cause: ${hospital.condition}`,
    hospital.age && `Age: ${hospital.age}`,
    hospital.blood_group && `Blood group: ${hospital.blood_group}`,
    hospital.gender && `Gender: ${hospital.gender}`,
    `Generated: ${new Date().toLocaleString()}`,
  ].filter(Boolean).join('\n');
  y = addWrapped(doc, meta, margin, y, maxW, 5);
  y += 6;
  doc.setFontSize(11);
  addWrapped(doc, formatTranscriptForPdf(transcript), margin, y, maxW, 5.5);
  const name = (hospital.patient_name || 'transcript').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-') || 'transcript';
  doc.save(`${name}-transcript.pdf`);
}

export function downloadSummaryPdf(summary, hospital) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const margin = 14;
  const maxW = doc.internal.pageSize.getWidth() - margin * 2;
  let y = margin;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('Discharge Summary', margin, y);
  y += 8;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  y = addWrapped(doc, `Generated: ${new Date().toLocaleString()}`, margin, y, maxW, 5);
  y += 4;

  summarySections(summary, hospital).forEach(([title, body]) => {
    if (!body) return;
    if (y > doc.internal.pageSize.getHeight() - 30) {
      doc.addPage();
      y = margin;
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(title, margin, y);
    y += 5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    y = addWrapped(doc, body, margin, y, maxW, 5);
    y += 4;
  });

  const name = (hospital.patient_name || 'summary').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-') || 'summary';
  doc.save(`${name}-discharge-summary.pdf`);
}

export function printSummary(summary, hospital) {
  const sections = summarySections(summary, hospital).filter(([, body]) => body);
  if (!sections.length) return;

  const html = `<!doctype html>
<html><head><title>Discharge Summary</title>
<style>
  body { font-family: Georgia, "Times New Roman", serif; color: #111; margin: 24px; line-height: 1.55; }
  h1 { font-size: 22px; margin: 0 0 6px; }
  .meta { color: #555; font-size: 12px; margin-bottom: 20px; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.05em; color: #0f766e; margin: 18px 0 6px; }
  p { margin: 0 0 10px; white-space: pre-wrap; font-size: 14px; }
  @media print { body { margin: 12mm; } }
</style></head><body>
  <h1>Discharge Summary</h1>
  <div class="meta">Generated: ${new Date().toLocaleString()}${hospital.patient_name ? ` · Patient: ${hospital.patient_name}` : ''}</div>
  ${sections.map(([title, body]) => `<h2>${title}</h2><p>${escapeHtml(body)}</p>`).join('')}
</body></html>`;

  const win = window.open('', '_blank', 'noopener,noreferrer');
  if (!win) return;
  win.document.open();
  win.document.write(html);
  win.document.close();
  win.focus();
  win.onload = () => {
    win.print();
    win.onafterprint = () => win.close();
  };
}

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
