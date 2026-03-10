/**
 * Account store – CRUD for Stripe account configurations.
 * Data is persisted in data/accounts.json.
 */

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "data");
const ACCOUNTS_FILE = path.join(DATA_DIR, "accounts.json");

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadAccounts() {
  ensureDataDir();
  if (!fs.existsSync(ACCOUNTS_FILE)) return [];
  return JSON.parse(fs.readFileSync(ACCOUNTS_FILE, "utf-8"));
}

function saveAccounts(accounts) {
  ensureDataDir();
  fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2), "utf-8");
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
  const account = { slug, name, stripeSecretKey, stripeWebhookSecret, slackWebhookUrl };
  accounts.push(account);
  saveAccounts(accounts);
  return account;
}

function updateAccount(slug, updates) {
  const accounts = loadAccounts();
  const idx = accounts.findIndex((a) => a.slug === slug);
  if (idx === -1) throw new Error(`Account "${slug}" not found`);
  // Don't allow changing slug
  delete updates.slug;
  accounts[idx] = { ...accounts[idx], ...updates };
  saveAccounts(accounts);
  return accounts[idx];
}

function deleteAccount(slug) {
  const accounts = loadAccounts();
  const idx = accounts.findIndex((a) => a.slug === slug);
  if (idx === -1) throw new Error(`Account "${slug}" not found`);
  accounts.splice(idx, 1);
  saveAccounts(accounts);
}

module.exports = { loadAccounts, saveAccounts, getAccount, getAllAccounts, createAccount, updateAccount, deleteAccount };
