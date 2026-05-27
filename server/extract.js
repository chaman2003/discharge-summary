import mammoth from 'mammoth';
import pdfParse from 'pdf-parse';

const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.csv', '.json']);
const SUPPORTED_EXTENSIONS = new Set([...TEXT_EXTENSIONS, '.pdf', '.docx']);

function ext(name) {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot).toLowerCase() : '';
}

function decodeText(data) {
  return new TextDecoder('utf-8', { fatal: false }).decode(data);
}

export async function extractText(filename, data) {
  const extension = ext(filename);
  const warnings = [];

  if (!SUPPORTED_EXTENSIONS.has(extension)) {
    throw new Error('Unsupported file type. Use txt, md, csv, json, pdf, or docx.');
  }

  if (['.txt', '.md', '.csv'].includes(extension)) {
    return { text: decodeText(data), warnings };
  }

  if (extension === '.json') {
    try {
      const parsed = JSON.parse(decodeText(data));
      return { text: JSON.stringify(parsed, null, 2), warnings };
    } catch {
      warnings.push('JSON could not be parsed, saved as plain text.');
      return { text: decodeText(data), warnings };
    }
  }

  if (extension === '.pdf') {
    const parsed = await pdfParse(data);
    const text = (parsed.text || '').trim();
    if (!text) {
      warnings.push('No extractable text found. Scanned PDFs need OCR and are not supported yet.');
    }
    return { text, warnings };
  }

  if (extension === '.docx') {
    const result = await mammoth.extractRawText({ buffer: data });
    return { text: (result.value || '').trim(), warnings };
  }

  return { text: '', warnings };
}
