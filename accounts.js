/**
 * Account store – CRUD for Stripe account configurations.
 * Data is persisted in data/accounts.json.
 */

const { readJsonFile, writeJsonFile } = require("./storage");

const ACCOUNTS_FILE = "accounts.json";

function cleanValue(value) {
  if (typeof value !== "string") {
    return value ?? null;
  }
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function loadAccounts() {
  return readJsonFile(ACCOUNTS_FILE, []);
}

function getAccount(slug) {
  return loadAccounts().find((a) => a.slug === slug) || null;
}

function getAllAccounts() {
  return loadAccounts();
}

function createAccount({ slug, name, stripeSecretKey, stripeWebhookSecret, slackWebhookUrl }) {
  const accounts = loadAccounts();
  if (accounts.find((a) => a.slug === slug)) {
    throw new Error(`Account "${slug}" already exists`);
  }
  const account = {
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

function updateAccount(slug, updates) {
  const accounts = loadAccounts();
  const idx = accounts.findIndex((a) => a.slug === slug);
  if (idx === -1) throw new Error(`Account "${slug}" not found`);

  const nextAccount = { ...accounts[idx] };
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

  accounts[idx] = nextAccount;
  writeJsonFile(ACCOUNTS_FILE, accounts);
  return accounts[idx];
}

function deleteAccount(slug) {
  const accounts = loadAccounts();
  const idx = accounts.findIndex((a) => a.slug === slug);
  if (idx === -1) throw new Error(`Account "${slug}" not found`);
  accounts.splice(idx, 1);
  writeJsonFile(ACCOUNTS_FILE, accounts);
}

module.exports = { loadAccounts, getAccount, getAllAccounts, createAccount, updateAccount, deleteAccount };
