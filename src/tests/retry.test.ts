import { describe, it, expect, vi } from 'vitest';
import { withRetry } from '../utils/retry.js';

describe('withRetry', () => {
  it('should return result if operation succeeds first time', async () => {
    const op = vi.fn().mockResolvedValue('success');
    const result = await withRetry(op);
    expect(result).toBe('success');
    expect(op).toHaveBeenCalledTimes(1);
  });

  it('should retry if operation fails with 429', async () => {
    const op = vi.fn()
      .mockRejectedValueOnce({ status: 429 })
      .mockResolvedValueOnce('success');
    
    const result = await withRetry(op, { baseDelay: 1 });
    expect(result).toBe('success');
    expect(op).toHaveBeenCalledTimes(2);
  });

  it('should throw if max retries exceeded', async () => {
    const op = vi.fn().mockRejectedValue({ status: 500 });
    
    await expect(withRetry(op, { maxRetries: 1, baseDelay: 1 }))
      .rejects.toThrow();
    expect(op).toHaveBeenCalledTimes(2);
  });
});
