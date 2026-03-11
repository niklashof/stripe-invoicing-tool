import { readJsonFile, writeJsonFile } from "./storage";
import type { Account, AccountUpdates } from "./types/app-types";

const ACCOUNTS_FILE = "accounts.json";

function cleanValue(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return value ?? null;
  }
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export function loadAccounts(): Account[] {
  return readJsonFile<Account[]>(ACCOUNTS_FILE, []);
}

export function getAccount(slug: string): Account | null {
  return loadAccounts().find((account) => account.slug === slug) || null;
}

export function getAllAccounts(): Account[] {
  return loadAccounts();
}

export function createAccount({
  slug,
  name,
  stripeSecretKey,
  stripeWebhookSecret,
  slackWebhookUrl,
}: Account): Account {
  const accounts = loadAccounts();
  if (accounts.find((account) => account.slug === slug)) {
    throw new Error(`Account "${slug}" already exists`);
  }

  const account: Account = {
    slug,
    name: String(name || "").trim(),
    stripeSecretKey: cleanValue(stripeSecretKey),
    stripeWebhookSecret: cleanValue(stripeWebhookSecret),
    slackWebhookUrl: cleanValue(slackWebhookUrl),
  };

  accounts.push(account);
  writeJsonFile(ACCOUNTS_FILE, accounts);
  return account;
}

export function updateAccount(slug: string, updates: AccountUpdates): Account {
  const accounts = loadAccounts();
  const accountIndex = accounts.findIndex((account) => account.slug === slug);
  if (accountIndex === -1) {
    throw new Error(`Account "${slug}" not found`);
  }

  const nextAccount: Account = { ...accounts[accountIndex]! };
  if (updates.name !== undefined) {
    nextAccount.name = String(updates.name || "").trim();
  }
  if (updates.stripeSecretKey !== undefined) {
    nextAccount.stripeSecretKey = cleanValue(updates.stripeSecretKey);
  }
  if (updates.stripeWebhookSecret !== undefined) {
    nextAccount.stripeWebhookSecret = cleanValue(updates.stripeWebhookSecret);
  }
  if (updates.slackWebhookUrl !== undefined) {
    nextAccount.slackWebhookUrl = cleanValue(updates.slackWebhookUrl);
  }

  accounts[accountIndex] = nextAccount;
  writeJsonFile(ACCOUNTS_FILE, accounts);
  return accounts[accountIndex]!;
}

export function deleteAccount(slug: string): void {
  const accounts = loadAccounts();
  const accountIndex = accounts.findIndex((account) => account.slug === slug);
  if (accountIndex === -1) {
    throw new Error(`Account "${slug}" not found`);
  }

  accounts.splice(accountIndex, 1);
  writeJsonFile(ACCOUNTS_FILE, accounts);
}
