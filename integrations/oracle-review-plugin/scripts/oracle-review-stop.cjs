#!/usr/bin/env node
"use strict";

const { guardDecision } = require("./oracle-review-state.cjs");

try {
  const result = guardDecision();
  if (result.decision === "block") {
    process.stdout.write(
      `${JSON.stringify(
        {
          decision: "block",
          reason: result.reason,
          message: result.reason,
          statePath: result.statePath,
        },
        null,
        2,
      )}\n`,
    );
  } else {
    process.stdout.write(`${JSON.stringify({ decision: "allow", statePath: result.statePath }, null, 2)}\n`);
  }
} catch (error) {
  const message = error && error.stack ? error.stack : String(error);
  process.stdout.write(
    `${JSON.stringify(
      {
        decision: "block",
        reason: `Oracle review stop hook failed; inspect the hook before finishing.\n${message}`,
        message,
      },
      null,
      2,
    )}\n`,
  );
}
