#!/usr/bin/env node

/**
 * CLI utility to create a user.
 * Usage: node scripts/create-user.js <username> <password>
 */

const { createUser } = require("../auth");

async function main() {
  const [username, password] = process.argv.slice(2);

  if (!username || !password) {
    console.error("Usage: node scripts/create-user.js <username> <password>");
    process.exit(1);
  }

  try {
    const user = await createUser(username, password);
    console.log(`User created: ${user.username} (${user.id})`);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

main();
