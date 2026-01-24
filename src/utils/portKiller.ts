import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/**
 * Get the process ID using a specific port
 * Returns null if no process is using the port
 */
export async function getProcessOnPort(port: number): Promise<number | null> {
  const platform = process.platform;

  try {
    if (platform === 'darwin' || platform === 'linux') {
      // MacOS/Linux: use lsof
      const { stdout } = await execFileAsync('lsof', ['-ti', `:${port}`]);
      const pid = parseInt(stdout.trim().split('\n')[0], 10);
      return isNaN(pid) ? null : pid;
    } else if (platform === 'win32') {
      // Windows: use netstat
      const { stdout } = await execFileAsync('netstat', ['-ano']);
      const lines = stdout.split('\n');

      for (const line of lines) {
        // Look for LISTENING state on our port
        if (line.includes(`:${port}`) && line.includes('LISTENING')) {
          const parts = line.trim().split(/\s+/);
          const pid = parseInt(parts[parts.length - 1], 10);
          return isNaN(pid) ? null : pid;
        }
      }
      return null;
    }

    return null;
  } catch {
    // Command failed - likely no process on port
    return null;
  }
}

/**
 * Kill the process using a specific port
 * Returns true if successful, false otherwise
 */
export async function killProcessOnPort(port: number): Promise<boolean> {
  const pid = await getProcessOnPort(port);

  if (!pid) {
    // No process found on port
    return true;
  }

  // Don't kill our own process
  if (pid === process.pid) {
    return false;
  }

  const platform = process.platform;

  try {
    if (platform === 'darwin' || platform === 'linux') {
      // MacOS/Linux: use kill
      await execFileAsync('kill', ['-9', String(pid)]);
    } else if (platform === 'win32') {
      // Windows: use taskkill
      await execFileAsync('taskkill', ['/PID', String(pid), '/F']);
    }

    // Wait a bit for the port to be released
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Verify port is now free
    const stillInUse = await getProcessOnPort(port);
    return stillInUse === null;
  } catch {
    return false;
  }
}

/**
 * Try to acquire a port, killing existing process if needed
 * Returns true if port is available (or was made available)
 */
export async function ensurePortAvailable(
  port: number,
  options: { autoKill?: boolean; silent?: boolean } = {}
): Promise<{ available: boolean; killed: boolean; pid?: number }> {
  const { autoKill = true, silent = false } = options;

  const existingPid = await getProcessOnPort(port);

  if (!existingPid) {
    return { available: true, killed: false };
  }

  if (!silent) {
    console.log(`⚠️  Port ${port} is in use by process (PID: ${existingPid})`);
  }

  if (!autoKill) {
    return { available: false, killed: false, pid: existingPid };
  }

  if (!silent) {
    console.log(`   🔄 Terminating existing process...`);
  }

  const killed = await killProcessOnPort(port);

  if (killed) {
    if (!silent) {
      console.log(`   ✅ Port ${port} is now available`);
    }
    return { available: true, killed: true, pid: existingPid };
  } else {
    if (!silent) {
      console.log(`   ❌ Failed to terminate process on port ${port}`);
    }
    return { available: false, killed: false, pid: existingPid };
  }
}
