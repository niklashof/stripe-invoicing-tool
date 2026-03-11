/**
 * User authentication module.
 * Credentials are stored in data/users.json with bcrypt-hashed passwords.
 */

const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { readJsonFile, writeJsonFile } = require("./storage");

const USERS_FILE = "users.json";
const MIN_PASSWORD_LENGTH = 8;

function loadUsers() {
  return readJsonFile(USERS_FILE, []);
}

async function createUser(username, password) {
  const normalizedUsername = String(username || "").trim();
  if (!normalizedUsername) {
    throw new Error("Username is required");
  }
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }

  const users = loadUsers();
  if (users.find((u) => u.username === normalizedUsername)) {
    throw new Error("Username already exists");
  }
  const passwordHash = await bcrypt.hash(password, 10);
  const user = {
    id: "u_" + crypto.randomBytes(4).toString("hex"),
    username: normalizedUsername,
    passwordHash,
    createdAt: new Date().toISOString(),
  };
  users.push(user);
  writeJsonFile(USERS_FILE, users);
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

module.exports = { MIN_PASSWORD_LENGTH, loadUsers, createUser, verifyPassword, needsSetup };
