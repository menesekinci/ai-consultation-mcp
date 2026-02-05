import path from 'path';

export function inferMimeType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  switch (ext) {
    case '.md':
      return 'text/markdown';
    case '.txt':
      return 'text/plain';
    case '.json':
      return 'application/json';
    case '.pdf':
      return 'application/pdf';
    case '.docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case '.csv':
      return 'text/csv';
    case '.yaml':
    case '.yml':
      return 'application/x-yaml';
    default:
      return 'application/octet-stream';
  }
}

export async function extractTextFromBuffer(buffer: Buffer, mimeType: string, filename: string): Promise<string> {
  const ext = path.extname(filename).toLowerCase();

  if (mimeType === 'application/pdf' || ext === '.pdf') {
    const pdfParse = (await import('pdf-parse')).default;
    const data = await pdfParse(buffer);
    return data.text || '';
  }

  if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || ext === '.docx') {
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ buffer });
    return result.value || '';
  }

  return buffer.toString('utf8');
}
