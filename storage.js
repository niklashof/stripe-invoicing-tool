const fs = require("fs");
const path = require("path");

const DEFAULT_DATA_DIR = path.join(__dirname, "data");

function getDataDir() {
  return process.env.DATA_DIR || DEFAULT_DATA_DIR;
}

function ensureDataDir() {
  const dir = getDataDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(dir, 0o700);
  } catch (_err) {
    // Ignore permission updates on platforms/filesystems that do not support chmod.
  }
  return dir;
}

function resolveDataPath(filename) {
  return path.join(ensureDataDir(), filename);
}

function readJsonFile(filename, fallbackValue) {
  const filePath = resolveDataPath(filename);
  if (!fs.existsSync(filePath)) {
    return fallbackValue;
  }
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function writeJsonFile(filename, data) {
  const filePath = resolveDataPath(filename);
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), { encoding: "utf-8", mode: 0o600 });
  fs.renameSync(tempPath, filePath);
  try {
    fs.chmodSync(filePath, 0o600);
  } catch (_err) {
    // Ignore permission updates on platforms/filesystems that do not support chmod.
  }
}

function appendLine(filename, line) {
  const filePath = resolveDataPath(filename);
  const needsNewline = fs.existsSync(filePath) && fs.statSync(filePath).size > 0;
  fs.appendFileSync(filePath, `${needsNewline ? "\n" : ""}${line}`, { encoding: "utf-8", mode: 0o600 });
  try {
    fs.chmodSync(filePath, 0o600);
  } catch (_err) {
    // Ignore permission updates on platforms/filesystems that do not support chmod.
  }
}

module.exports = {
  appendLine,
  ensureDataDir,
  getDataDir,
  readJsonFile,
  resolveDataPath,
  writeJsonFile,
};
