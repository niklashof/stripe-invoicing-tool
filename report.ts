#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import Stripe from "stripe";
import { getAccount, getAllAccounts } from "./accounts";
import { buildLineItemCsv, buildLineItemReport } from "./exports";
import { getErrorMessage, type StripeClientLike } from "./types/app-types";

interface ParsedMonth {
  from: number;
  to: number;
  label: string;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function parseMonth(input: string | undefined): ParsedMonth {
  const match = input?.match(/^(\d{4})-(\d{2})$/);
  if (!match) {
    fail('Please provide a month in YYYY-MM format, e.g. "2026-02"');
  }

  const year = Number.parseInt(match[1]!, 10);
  const month = Number.parseInt(match[2]!, 10);
  const from = new Date(Date.UTC(year, month - 1, 1));
  const to = new Date(Date.UTC(year, month, 1));

  return {
    from: Math.floor(from.getTime() / 1000),
    to: Math.floor(to.getTime() / 1000),
    label: `${year}-${String(month).padStart(2, "0")}`,
  };
}

function formatEur(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}

function resolveStripeKey(args: string[]): { key: string; accountName: string | null } {
  const accountArg = args.find((arg) => arg.startsWith("--account="));
  if (accountArg) {
    const slug = accountArg.split("=")[1];
    if (!slug) {
      fail("Account slug is required");
    }

    const account = getAccount(slug);
    if (!account) {
      const available = getAllAccounts()
        .map((entry) => entry.slug)
        .join(", ");
      console.error(`Account "${slug}" not found.`);
      if (available) {
        console.error(`Available accounts: ${available}`);
      }
      process.exit(1);
    }
    if (!account.stripeSecretKey) {
      fail(`Account "${slug}" has no Stripe secret key configured.`);
    }

    return { key: account.stripeSecretKey, accountName: account.name };
  }

  if (process.env.STRIPE_SECRET_KEY) {
    return { key: process.env.STRIPE_SECRET_KEY, accountName: null };
  }

  fail("Provide --account=slug or set STRIPE_SECRET_KEY environment variable.");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const monthArg = args.find((arg) => !arg.startsWith("--"));
  const wantCsv = args.includes("--csv");

  const { key, accountName } = resolveStripeKey(args);
  const stripe = new Stripe(key) as unknown as StripeClientLike;
  const period = parseMonth(monthArg);

  const heading = accountName
    ? `Fetching completed payments for ${period.label} (${accountName}) ...`
    : `Fetching completed payments for ${period.label} ...`;
  console.log(`\n${heading}\n`);

  const { buckets, rows, sessions } = await buildLineItemReport(stripe, {
    from: period.from,
    to: period.to,
  });

  if (sessions.length === 0) {
    console.log("No completed checkout sessions found for this period.");
    return;
  }

  console.log(`Found ${sessions.length} completed session(s).\n`);

  console.log("═══════════════════════════════════════════════════════");
  const title = accountName
    ? `  VAT Summary for ${period.label} - ${accountName}`
    : `  VAT Summary for ${period.label}`;
  console.log(title);
  console.log("═══════════════════════════════════════════════════════\n");

  let totalGross = 0;
  let totalNet = 0;
  let totalVat = 0;

  for (const rate of Object.keys(buckets).sort((left, right) => Number(left) - Number(right))) {
    const bucket = buckets[Number(rate)]!;
    totalGross += bucket.gross;
    totalNet += bucket.net;
    totalVat += bucket.vat;

    console.log(`  ${rate}% VAT`);
    console.log("  ─────────────────────────────────────────────────");

    for (const [label, productBucket] of Object.entries(bucket.byProduct)) {
      console.log(
        `    ${label.padEnd(30)} ${String(productBucket.count).padStart(4)}x   ` +
          `Brutto ${formatEur(productBucket.gross).padStart(10)} €   ` +
          `Netto ${formatEur(productBucket.net).padStart(10)} €   ` +
          `USt ${formatEur(productBucket.vat).padStart(9)} €`
      );
    }

    console.log(
      `    ${"SUMME".padEnd(30)} ${String(bucket.count).padStart(4)}x   ` +
        `Brutto ${formatEur(bucket.gross).padStart(10)} €   ` +
        `Netto ${formatEur(bucket.net).padStart(10)} €   ` +
        `USt ${formatEur(bucket.vat).padStart(9)} €`
    );
    console.log();
  }

  console.log("  ─────────────────────────────────────────────────");
  console.log(
    `  ${"GESAMT".padEnd(32)}       ` +
      `Brutto ${formatEur(totalGross).padStart(10)} €   ` +
      `Netto ${formatEur(totalNet).padStart(10)} €   ` +
      `USt ${formatEur(totalVat).padStart(9)} €`
  );
  console.log();

  if (wantCsv) {
    const csvContent = buildLineItemCsv(rows);
    const csvPath = path.join(process.cwd(), `vat-report-${period.label}.csv`);
    fs.writeFileSync(csvPath, csvContent, "utf-8");
    console.log(`  CSV saved to: ${csvPath}\n`);
  }
}

void main().catch((error: unknown) => {
  console.error("Error:", getErrorMessage(error));
  process.exit(1);
});
