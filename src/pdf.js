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

function buildSummaryDoc(summary, hospital) {
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

  return doc;
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
  const doc = buildSummaryDoc(summary, hospital);
  const name = (hospital.patient_name || 'summary').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-') || 'summary';
  doc.save(`${name}-discharge-summary.pdf`);
}

export function printSummary(summary, hospital) {
  const doc = buildSummaryDoc(summary, hospital);
  const hasContent = summarySections(summary, hospital).some(([, body]) => body);
  if (!hasContent) return;

  doc.autoPrint();
  const url = doc.output('bloburl');
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.title = 'Discharge summary print preview';
  iframe.src = url;
  document.body.appendChild(iframe);

  const cleanup = () => {
    iframe.remove();
    if (typeof url === 'string' && url.startsWith('blob:')) {
      URL.revokeObjectURL(url);
    }
  };

  iframe.onload = () => {
    window.setTimeout(() => {
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
      } finally {
        window.setTimeout(cleanup, 1000);
      }
    }, 300);
  };
}
