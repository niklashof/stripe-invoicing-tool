/**
 * User authentication module.
 * Credentials are stored in data/users.json with bcrypt-hashed passwords.
 */

const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");

const DATA_DIR = path.join(__dirname, "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadUsers() {
  ensureDataDir();
  if (!fs.existsSync(USERS_FILE)) return [];
  return JSON.parse(fs.readFileSync(USERS_FILE, "utf-8"));
}

function saveUsers(users) {
  ensureDataDir();
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), "utf-8");
}

async function createUser(username, password) {
  const users = loadUsers();
  if (users.find((u) => u.username === username)) {
    throw new Error("Username already exists");
  }
  const passwordHash = await bcrypt.hash(password, 10);
  const user = {
    id: "u_" + crypto.randomBytes(4).toString("hex"),
    username,
    passwordHash,
    createdAt: new Date().toISOString(),
  };
  users.push(user);
  saveUsers(users);
  return { id: user.id, username: user.username };
}

async function verifyPassword(username, password) {
  const users = loadUsers();
  const user = users.find((u) => u.username === username);
  if (!user) return null;
  const match = await bcrypt.compare(password, user.passwordHash);
  return match ? { id: user.id, username: user.username } : null;
}

function needsSetup() {
  return loadUsers().length === 0;
}

module.exports = { loadUsers, saveUsers, createUser, verifyPassword, needsSetup };
