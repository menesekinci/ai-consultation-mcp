import crypto from 'node:crypto';
import { ConfigError } from '../utils/index.js';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 16; // 128 bits
const AUTH_TAG_LENGTH = 16; // 128 bits

/**
 * Derives a consistent encryption key from a machine-specific identifier
 */
function deriveKey(): Buffer {
  // Use a combination of machine-specific values for key derivation
  const machineId =
    process.env.USER ||
    process.env.USERNAME ||
    process.env.HOME ||
    'default-user';
  const salt = 'agent-consultation-mcp-v1';

  return crypto.pbkdf2Sync(machineId, salt, 100000, KEY_LENGTH, 'sha256');
}

/**
 * Encrypts a string using AES-256-GCM
 */
export function encrypt(plaintext: string): string {
  if (!plaintext) {
    return '';
  }

  try {
    const key = deriveKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(plaintext, 'utf8', 'base64');
    encrypted += cipher.final('base64');

    const authTag = cipher.getAuthTag();

    // Combine IV + AuthTag + Encrypted data
    const combined = Buffer.concat([
      iv,
      authTag,
      Buffer.from(encrypted, 'base64'),
    ]);

    return combined.toString('base64');
  } catch (error) {
    throw new ConfigError(
      `Encryption failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Decrypts a string encrypted with AES-256-GCM
 */
export function decrypt(encryptedData: string): string {
  if (!encryptedData) {
    return '';
  }

  try {
    const key = deriveKey();
    const combined = Buffer.from(encryptedData, 'base64');

    // Extract IV, AuthTag, and encrypted data
    const iv = combined.subarray(0, IV_LENGTH);
    const authTag = combined.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const encrypted = combined.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted.toString('base64'), 'base64', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (error) {
    throw new ConfigError(
      `Decryption failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Checks if a string appears to be encrypted (base64 with proper length)
 */
export function isEncrypted(value: string): boolean {
  if (!value) {
    return false;
  }

  try {
    const decoded = Buffer.from(value, 'base64');
    // Minimum length: IV (16) + AuthTag (16) + at least 1 byte of data
    return decoded.length > IV_LENGTH + AUTH_TAG_LENGTH;
  } catch {
    return false;
  }
}
