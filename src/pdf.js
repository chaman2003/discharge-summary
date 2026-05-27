import { jsPDF } from 'jspdf';
import {
  buildPatientBlock,
  fieldToDisplayText,
  formatTranscriptForPdf,
  mergePatientDetails,
} from './transcriptUtils';
import { HOSPITAL_FOOTER, HOSPITAL_NAME } from './constants';

const MARGIN = 16;
const HEADER_BOTTOM = 28;
const FOOTER_TOP = 278;

function addWrapped(doc, text, x, y, maxWidth, lineHeight) {
  const lines = doc.splitTextToSize(String(text || ''), maxWidth);
  lines.forEach((line) => {
    doc.text(line, x, y);
    y += lineHeight;
  });
  return y;
}

function drawHeader(doc, title) {
  const pageWidth = doc.internal.pageSize.getWidth();
  doc.setFillColor(15, 118, 110);
  doc.rect(0, 0, pageWidth, 6, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(15, 23, 42);
  doc.text(HOSPITAL_NAME, MARGIN, 16);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(100, 116, 139);
  doc.text(title, pageWidth - MARGIN, 16, { align: 'right' });
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.4);
  doc.line(MARGIN, 20, pageWidth - MARGIN, 20);
  doc.setTextColor(15, 23, 42);
}

function applyFooters(doc) {
  const totalPages = doc.internal.getNumberOfPages();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  for (let page = 1; page <= totalPages; page += 1) {
    doc.setPage(page);
    doc.setDrawColor(226, 232, 240);
    doc.line(MARGIN, FOOTER_TOP, pageWidth - MARGIN, FOOTER_TOP);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(HOSPITAL_FOOTER, MARGIN, pageHeight - 10);
    doc.text(`Page ${page} of ${totalPages}`, pageWidth - MARGIN, pageHeight - 10, { align: 'right' });
  }
}

function ensureSpace(doc, y, needed = 20) {
  if (y <= FOOTER_TOP - needed) return y;
  doc.addPage();
  drawHeader(doc, doc.__pdfTitle || 'Document');
  return HEADER_BOTTOM;
}

function patientMetaBlock(hospital) {
  return buildPatientBlock(hospital);
}

function summarySections(summary, hospital) {
  const patientBlock = patientMetaBlock(hospital);
  return [
    ['Patient Details', mergePatientDetails(summary.hospital_details, patientBlock)],
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
  doc.__pdfTitle = 'Discharge Summary';
  const maxW = doc.internal.pageSize.getWidth() - MARGIN * 2;
  drawHeader(doc, 'Discharge Summary');

  let y = HEADER_BOTTOM;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  y = addWrapped(doc, `Generated: ${new Date().toLocaleString()}`, MARGIN, y, maxW, 4.5);
  y += 6;
  doc.setTextColor(15, 23, 42);

  summarySections(summary, hospital).forEach(([title, body]) => {
    if (!body) return;
    y = ensureSpace(doc, y, 24);
    doc.setFillColor(236, 253, 245);
    doc.roundedRect(MARGIN, y - 4, maxW, 8, 1, 1, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(15, 118, 110);
    doc.text(title.toUpperCase(), MARGIN + 2, y + 1.5);
    y += 8;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(15, 23, 42);
    y = addWrapped(doc, body, MARGIN, y, maxW, 5);
    y += 6;
  });

  applyFooters(doc);
  return doc;
}

function buildTranscriptDoc(transcript, hospital) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  doc.__pdfTitle = 'Clinical Transcript';
  const maxW = doc.internal.pageSize.getWidth() - MARGIN * 2;
  drawHeader(doc, 'Clinical Transcript');

  let y = HEADER_BOTTOM;
  const meta = [
    ...patientMetaBlock(hospital).split('\n').filter(Boolean),
    `Generated: ${new Date().toLocaleString()}`,
  ].join('\n');

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  y = addWrapped(doc, meta, MARGIN, y, maxW, 4.5);
  y += 8;
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('Transcript', MARGIN, y);
  y += 6;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);

  const body = formatTranscriptForPdf(transcript);
  const paragraphs = body.split('\n\n');
  paragraphs.forEach((paragraph) => {
    y = ensureSpace(doc, y, 16);
    y = addWrapped(doc, paragraph, MARGIN, y, maxW, 5.2);
    y += 4;
  });

  applyFooters(doc);
  return doc;
}

export function downloadTranscriptPdf(transcript, hospital) {
  const doc = buildTranscriptDoc(transcript, hospital);
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
