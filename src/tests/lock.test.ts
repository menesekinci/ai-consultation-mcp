import { describe, it, expect, afterEach } from 'vitest';
import { FileLock } from '../utils/lock.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('FileLock', () => {
  const testFile = path.join(os.tmpdir(), 'test-lock-' + Date.now());

  afterEach(() => {
    if (fs.existsSync(testFile + '.lock')) {
      fs.unlinkSync(testFile + '.lock');
    }
  });

  it('should acquire and release a lock', async () => {
    const lock = new FileLock(testFile);
    const acquired = await lock.acquire();
    expect(acquired).toBe(true);
    expect(fs.existsSync(testFile + '.lock')).toBe(true);
    
    lock.release();
    expect(fs.existsSync(testFile + '.lock')).toBe(false);
  });

  it('should fail if lock already held', async () => {
    const lock1 = new FileLock(testFile);
    const lock2 = new FileLock(testFile);
    
    await lock1.acquire();
    const acquired2 = await lock2.acquire({ timeout: 500 });
    expect(acquired2).toBe(false);
    
    lock1.release();
  });

  it('should acquire sync', () => {
    const lock = new FileLock(testFile);
    const acquired = lock.acquireSync();
    expect(acquired).toBe(true);
    lock.release();
  });
});
