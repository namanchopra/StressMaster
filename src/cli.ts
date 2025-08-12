#!/usr/bin/env node

// CLI entry point for StressMaster
import { CLIRunner } from "./cli/cli-runner";

async function main() {
  const cli = new CLIRunner();
  await cli.run();
}

// Handle unhandled promise rejections
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
  process.exit(1);
});

// Handle uncaught exceptions
process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
  process.exit(1);
});

main().catch((error) => {
  console.error("CLI Error:", error);
  process.exit(1);
});
