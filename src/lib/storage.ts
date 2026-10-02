/**
 * Storage abstraction. LocalStorage writes under STORAGE_DIR (default ./storage).
 * Swap for an S3/GCS adapter by implementing the same interface.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export interface StorageAdapter {
  put(key: string, data: Buffer | string): Promise<string>;
  get(key: string): Promise<Buffer>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
  deletePrefix(prefix: string): Promise<void>;
  resolve(key: string): string;
}

const ROOT = path.resolve(process.env.STORAGE_DIR ?? "./storage");

function safeKey(key: string): string {
  const norm = path.posix.normalize(key).replace(/^(\.\.(\/|\\|$))+/, "");
  if (norm.includes("..") || path.isAbsolute(norm)) throw new Error("Invalid storage key");
  return norm;
}

class LocalStorage implements StorageAdapter {
  resolve(key: string) {
    const p = path.join(ROOT, safeKey(key));
    if (!p.startsWith(ROOT)) throw new Error("Path traversal blocked");
    return p;
  }
  async put(key: string, data: Buffer | string) {
    const p = this.resolve(key);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, data);
    return key;
  }
  async get(key: string) {
    return fs.readFile(this.resolve(key));
  }
  async exists(key: string) {
    try {
      await fs.access(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }
  async delete(key: string) {
    await fs.rm(this.resolve(key), { force: true });
  }
  async deletePrefix(prefix: string) {
    await fs.rm(this.resolve(prefix), { recursive: true, force: true });
  }
}

export const storage: StorageAdapter = new LocalStorage();

export function sanitizeFilename(name: string): string {
  const base = path.basename(name).replace(/[^\w.\-() ]+/g, "_").slice(0, 120);
  return base || "upload";
}

export function hashText(...parts: string[]): string {
  return crypto.createHash("sha1").update(parts.join("\u0000")).digest("hex");
}

export const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_MB ?? 60) * 1024 * 1024;
