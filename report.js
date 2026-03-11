#!/usr/bin/env node

/**
 * Stripe VAT Report Generator
 *
 * Pulls completed checkout sessions for a given month,
 * groups line items by product → VAT rate, and outputs
 * a summary + detailed CSV.
 *
 * Usage:
 *   node report.js 2026-02 --account=hotel-berlin
 *   node report.js 2026-02 --account=hotel-berlin --csv
 *   STRIPE_SECRET_KEY=sk_live_xxx node report.js 2026-02          (legacy)
 *   STRIPE_SECRET_KEY=sk_live_xxx node report.js 2026-02 --csv    (legacy)
 */

const Stripe = require("stripe");
const fs = require("fs");
const path = require("path");
const { getAccount, getAllAccounts } = require("./accounts");
const { buildLineItemCsv, buildLineItemReport } = require("./exports");

// ─── Helpers ─────────────────────────────────────────────────────

function parseMonth(input) {
  const match = input?.match(/^(\d{4})-(\d{2})$/);
  if (!match) {
    console.error('Please provide a month in YYYY-MM format, e.g. "2026-02"');
    process.exit(1);
  }
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const from = new Date(Date.UTC(year, month - 1, 1));
  const to = new Date(Date.UTC(year, month, 1));
  return {
    from: Math.floor(from.getTime() / 1000),
    to: Math.floor(to.getTime() / 1000),
    label: `${year}-${String(month).padStart(2, "0")}`,
  };
}

function formatEur(cents) {
  return (cents / 100).toFixed(2).replace(".", ",");
}

function resolveStripeKey(args) {
  const accountArg = args.find((a) => a.startsWith("--account="));
  if (accountArg) {
    const slug = accountArg.split("=")[1];
    const account = getAccount(slug);
    if (!account) {
      const available = getAllAccounts().map((a) => a.slug).join(", ");
      console.error(`Account "${slug}" not found.`);
      if (available) console.error(`Available accounts: ${available}`);
      process.exit(1);
    }
    return { key: account.stripeSecretKey, accountName: account.name };
  }

  if (process.env.STRIPE_SECRET_KEY) {
    return { key: process.env.STRIPE_SECRET_KEY, accountName: null };
  }

  console.error("Provide --account=slug or set STRIPE_SECRET_KEY environment variable.");
  process.exit(1);
}

// ─── Main ────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const monthArg = args.find((a) => !a.startsWith("--"));
  const wantCsv = args.includes("--csv");

  const { key, accountName } = resolveStripeKey(args);
  const stripe = new Stripe(key);
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

  // ── Console summary ────────────────────────────────────────────

  console.log("═══════════════════════════════════════════════════════");
  const title = accountName
    ? `  VAT Summary for ${period.label} – ${accountName}`
    : `  VAT Summary for ${period.label}`;
  console.log(title);
  console.log("═══════════════════════════════════════════════════════\n");

  let totalGross = 0;
  let totalNet = 0;
  let totalVat = 0;

  for (const rate of Object.keys(buckets).sort((a, b) => a - b)) {
    const b = buckets[rate];
    totalGross += b.gross;
    totalNet += b.net;
    totalVat += b.vat;

    console.log(`  ${rate}% VAT`);
    console.log(`  ─────────────────────────────────────────────────`);

    for (const [label, bp] of Object.entries(b.byProduct)) {
      console.log(
        `    ${label.padEnd(30)} ${String(bp.count).padStart(4)}x   ` +
          `Brutto ${formatEur(bp.gross).padStart(10)} €   ` +
          `Netto ${formatEur(bp.net).padStart(10)} €   ` +
          `USt ${formatEur(bp.vat).padStart(9)} €`
      );
    }

    console.log(
      `    ${"SUMME".padEnd(30)} ${String(b.count).padStart(4)}x   ` +
        `Brutto ${formatEur(b.gross).padStart(10)} €   ` +
        `Netto ${formatEur(b.net).padStart(10)} €   ` +
        `USt ${formatEur(b.vat).padStart(9)} €`
    );
    console.log();
  }

  console.log(`  ─────────────────────────────────────────────────`);
  console.log(
    `  ${"GESAMT".padEnd(32)}       ` +
      `Brutto ${formatEur(totalGross).padStart(10)} €   ` +
      `Netto ${formatEur(totalNet).padStart(10)} €   ` +
      `USt ${formatEur(totalVat).padStart(9)} €`
  );
  console.log();

  // ── CSV export ─────────────────────────────────────────────────

  if (wantCsv) {
    const csvContent = buildLineItemCsv(rows);
    const csvPath = path.join(
      process.cwd(),
      `vat-report-${period.label}.csv`
    );
    fs.writeFileSync(csvPath, csvContent, "utf-8");
    console.log(`  CSV saved to: ${csvPath}\n`);
  }
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
