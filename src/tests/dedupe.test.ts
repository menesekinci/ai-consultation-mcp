import { describe, expect, it } from 'vitest';
import { getTitleFromPath, isDuplicateTitle } from '../rag/dedupe.js';

describe('dedupe helpers', () => {
  it('gets title from path', () => {
    expect(getTitleFromPath('/tmp/docs/file.md')).toBe('file.md');
  });

  it('matches titles case-insensitively', () => {
    const existing = ['Alpha.md', 'Beta.txt'];
    expect(isDuplicateTitle(existing, 'alpha.md')).toBe(true);
    expect(isDuplicateTitle(existing, 'gamma.md')).toBe(false);
  });
});
