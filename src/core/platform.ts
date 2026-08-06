export interface RuntimeFile {
  content: Uint8Array;
  size: number;
}

export interface RuntimeServices {
  randomId(): string;
  readFile(path: string): Promise<RuntimeFile>;
  fileExists(path: string): Promise<boolean>;
  joinPath(...parts: string[]): string;
}

async function readNodeFile(path: string): Promise<RuntimeFile> {
  const fs = await import('node:fs/promises');
  const stats = await fs.stat(path);
  const content = await fs.readFile(path);
  return { content, size: stats.size };
}

async function nodeFileExists(path: string): Promise<boolean> {
  try {
    const fs = await import('node:fs/promises');
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

async function nodeJoinPath(...parts: string[]): Promise<string> {
  const path = await import('node:path');
  return path.join(...parts);
}

export const defaultRuntimeServices: RuntimeServices = {
  randomId(): string {
    const runtimeCrypto = globalThis.crypto as Crypto | undefined;
    if (runtimeCrypto?.randomUUID) return runtimeCrypto.randomUUID();
    throw new Error('No runtime randomUUID implementation is available.');
  },
  readFile: readNodeFile,
  fileExists: nodeFileExists,
  joinPath(...parts: string[]): string {
    return parts.filter(Boolean).join('/').replace(/\/+/g, '/').replace(/\/\//g, '/');
  }
};

export async function joinRuntimePath(...parts: string[]): Promise<string> {
  try {
    return await nodeJoinPath(...parts);
  } catch {
    return defaultRuntimeServices.joinPath(...parts);
  }
}