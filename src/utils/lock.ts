import fs from 'fs';

/**
 * Simple file-based lock for cross-process synchronization
 */
export class FileLock {
  private lockPath: string;

  constructor(filePath: string) {
    this.lockPath = filePath + '.lock';
  }

  /**
   * Acquire the lock
   */
  async acquire(options: { timeout?: number; interval?: number } = {}): Promise<boolean> {
    const { timeout = 5000, interval = 100 } = options;
    const start = Date.now();

    while (Date.now() - start < timeout) {
      try {
        // wx flag fails if file exists
        await fs.promises.writeFile(this.lockPath, process.pid.toString(), { flag: 'wx' });
        return true;
      } catch (err: any) {
        if (err.code !== 'EEXIST') {
          throw err;
        }

        // Check if lock is stale (process no longer exists)
        try {
          const pid = parseInt(await fs.promises.readFile(this.lockPath, 'utf8'), 10);
          if (isNaN(pid) || !this.processExists(pid)) {
            // Stale lock - remove and try again next loop
            this.release();
          }
        } catch {
          // Ignore read errors
        }
      }
      await this.sleep(interval);
    }

    return false;
  }

  /**
   * Release the lock
   */
  release(): void {
    try {
      if (fs.existsSync(this.lockPath)) {
        fs.unlinkSync(this.lockPath);
      }
    } catch {
      // Ignore errors
    }
  }

  /**
   * Acquire the lock sync
   */
  acquireSync(options: { timeout?: number; interval?: number } = {}): boolean {
    const { timeout = 5000, interval = 100 } = options;
    const start = Date.now();

    while (Date.now() - start < timeout) {
      try {
        fs.writeFileSync(this.lockPath, process.pid.toString(), { flag: 'wx' });
        return true;
      } catch (err: any) {
        if (err.code !== 'EEXIST') {
          throw err;
        }

        try {
          const content = fs.readFileSync(this.lockPath, 'utf8');
          const pid = parseInt(content, 10);
          if (isNaN(pid) || !this.processExists(pid)) {
            this.release();
          }
        } catch {
          // Ignore
        }
      }
      
      // Need a sync sleep
      const endWait = Date.now() + interval;
      while (Date.now() < endWait) {
        // block
      }
    }

    return false;
  }

  private processExists(pid: number): boolean {
    try {
      if (!pid) return false;
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
