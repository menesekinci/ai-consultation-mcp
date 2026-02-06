import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { registerIdleTimerHooks } from '../daemon/index.js';

class MockSocket extends EventEmitter {}
class MockIo extends EventEmitter {}

describe('daemon idle hook wiring', () => {
  it('triggers activity callback on connect and disconnect', () => {
    const io = new MockIo();
    const socket = new MockSocket();
    const onActivity = vi.fn();

    registerIdleTimerHooks(io as any, onActivity);

    io.emit('connection', socket);
    expect(onActivity).toHaveBeenCalledTimes(1);

    socket.emit('disconnect');
    expect(onActivity).toHaveBeenCalledTimes(2);
  });
});
