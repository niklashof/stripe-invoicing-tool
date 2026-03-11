import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { readJsonFile, writeJsonFile } from "./storage";
import type { SafeUser, StoredUser } from "./types/app-types";

const USERS_FILE = "users.json";
export const MIN_PASSWORD_LENGTH = 8;

export function loadUsers(): StoredUser[] {
  return readJsonFile<StoredUser[]>(USERS_FILE, []);
}

export async function createUser(username: string, password: string): Promise<SafeUser> {
  const normalizedUsername = String(username || "").trim();
  if (!normalizedUsername) {
    throw new Error("Username is required");
  }
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }

  const users = loadUsers();
  if (users.find((user) => user.username === normalizedUsername)) {
    throw new Error("Username already exists");
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user: StoredUser = {
    id: `u_${crypto.randomBytes(4).toString("hex")}`,
    username: normalizedUsername,
    passwordHash,
    createdAt: new Date().toISOString(),
  };

  users.push(user);
  writeJsonFile(USERS_FILE, users);
  return { id: user.id, username: user.username };
}

export async function verifyPassword(username: string, password: string): Promise<SafeUser | null> {
  const users = loadUsers();
  const user = users.find((entry) => entry.username === username);
  if (!user) {
    return null;
  }

  const isMatch = await bcrypt.compare(password, user.passwordHash);
  return isMatch ? { id: user.id, username: user.username } : null;
}

export function needsSetup(): boolean {
  return loadUsers().length === 0;
}
