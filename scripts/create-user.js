#!/usr/bin/env node

/**
 * CLI utility to create a user.
 * Usage: node scripts/create-user.js <username>
 *        CREATE_USER_PASSWORD=... node scripts/create-user.js <username>
 */

const { createUser } = require("../auth");

function promptForSecret(prompt) {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    const stdout = process.stdout;

    if (!stdin.isTTY || !stdout.isTTY) {
      reject(new Error("Set CREATE_USER_PASSWORD when running without a TTY"));
      return;
    }

    let value = "";
    stdout.write(prompt);
    stdin.resume();
    stdin.setRawMode(true);
    stdin.setEncoding("utf8");

    function cleanup() {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener("data", onData);
      stdout.write("\n");
    }

    function onData(char) {
      if (char === "\u0003") {
        cleanup();
        reject(new Error("Cancelled"));
        return;
      }
      if (char === "\r" || char === "\n") {
        cleanup();
        resolve(value);
        return;
      }
      if (char === "\u007f") {
        value = value.slice(0, -1);
        return;
      }
      value += char;
    }

    stdin.on("data", onData);
  });
}

async function main() {
  const [username] = process.argv.slice(2);

  if (!username) {
    console.error("Usage: node scripts/create-user.js <username>");
    process.exit(1);
  }

  const envPassword = process.env.CREATE_USER_PASSWORD;
  let password = envPassword;
  if (!password) {
    const firstEntry = await promptForSecret("Password: ");
    const secondEntry = await promptForSecret("Confirm password: ");
    if (firstEntry !== secondEntry) {
      console.error("Error: passwords did not match");
      process.exit(1);
    }
    password = firstEntry;
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
