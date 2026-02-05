import { describe, expect, it } from 'vitest';
import { inferMimeType } from '../rag/ingest.js';

describe('inferMimeType', () => {
  it('maps common extensions', () => {
    expect(inferMimeType('file.md')).toBe('text/markdown');
    expect(inferMimeType('file.txt')).toBe('text/plain');
    expect(inferMimeType('file.json')).toBe('application/json');
    expect(inferMimeType('file.pdf')).toBe('application/pdf');
    expect(inferMimeType('file.docx')).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(inferMimeType('file.csv')).toBe('text/csv');
    expect(inferMimeType('file.yaml')).toBe('application/x-yaml');
    expect(inferMimeType('file.yml')).toBe('application/x-yaml');
  });

  it('defaults to octet-stream', () => {
    expect(inferMimeType('file.unknown')).toBe('application/octet-stream');
  });
});
