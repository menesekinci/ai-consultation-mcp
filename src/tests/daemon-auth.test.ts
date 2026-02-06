import { afterEach, describe, expect, it } from 'vitest';
import net from 'node:net';
import { createDaemonServer } from '../daemon/server.js';

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address && typeof address === 'object') {
        const { port } = address;
        server.close(() => resolve(port));
        return;
      }
      server.close();
      reject(new Error('Could not resolve a free port'));
    });
    server.on('error', reject);
  });
}

describe('daemon auth', () => {
  let server: ReturnType<typeof createDaemonServer> | null = null;

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = null;
    }
  });

  it('rejects unauthenticated /api requests when daemon token is enabled', async () => {
    const port = await getFreePort();
    server = createDaemonServer(port, 'test-token');
    await server.start();

    const unauthorized = await fetch(`http://127.0.0.1:${port}/api/health`);
    expect(unauthorized.status).toBe(401);

    const authorized = await fetch(`http://127.0.0.1:${port}/api/health`, {
      headers: { 'x-daemon-token': 'test-token' },
    });
    expect(authorized.status).toBe(200);
  });
});
