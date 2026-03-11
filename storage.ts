import fs from "node:fs";
import path from "node:path";

const DEFAULT_DATA_DIR = path.join(__dirname, "data");

export function getDataDir(): string {
  return process.env.DATA_DIR || DEFAULT_DATA_DIR;
}

export function ensureDataDir(): string {
  const dir = getDataDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(dir, 0o700);
  } catch {
    // Ignore permission updates on platforms/filesystems that do not support chmod.
  }
  return dir;
}

export function resolveDataPath(filename: string): string {
  return path.join(ensureDataDir(), filename);
}

export function readJsonFile<T>(filename: string, fallbackValue: T): T {
  const filePath = resolveDataPath(filename);
  if (!fs.existsSync(filePath)) {
    return fallbackValue;
  }
  return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
}

export function writeJsonFile<T>(filename: string, data: T): void {
  const filePath = resolveDataPath(filename);
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), { encoding: "utf-8", mode: 0o600 });
  fs.renameSync(tempPath, filePath);
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // Ignore permission updates on platforms/filesystems that do not support chmod.
  }
}

export function appendLine(filename: string, line: string): void {
  const filePath = resolveDataPath(filename);
  const needsNewline = fs.existsSync(filePath) && fs.statSync(filePath).size > 0;
  fs.appendFileSync(filePath, `${needsNewline ? "\n" : ""}${line}`, { encoding: "utf-8", mode: 0o600 });
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // Ignore permission updates on platforms/filesystems that do not support chmod.
  }
}
