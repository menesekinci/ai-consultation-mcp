import { describe, it, expect } from 'vitest';
import { buildWebUIUrl } from '../proxy/daemon-client.js';

describe('proxy daemon client', () => {
  it('builds Web UI URL from daemon port', () => {
    expect(buildWebUIUrl(3456)).toBe('http://127.0.0.1:3456');
  });
});
