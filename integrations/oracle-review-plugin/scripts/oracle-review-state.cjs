#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const STATE_VERSION = 1;
const TERMINAL_SUCCESS = new Set(["completed"]);
const TERMINAL_FAILURE = new Set(["error", "partial", "cancelled", "failed"]);
const NON_TERMINAL = new Set(["pending", "running"]);
const MAX_SLUG_WORDS = 5;
const MIN_CUSTOM_SLUG_WORDS = 3;
const MAX_SLUG_WORD_LENGTH = 10;

function oracleHomeDir(env = process.env) {
  return env.ORACLE_HOME_DIR || path.join(os.homedir(), ".oracle");
}

function statePath(env = process.env) {
  return env.ORACLE_REVIEW_STATE_PATH || path.join(oracleHomeDir(env), "review-required-sessions.json");
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeOracleSlug(slug) {
  if (typeof slug !== "string") {
    throw new Error("slug must be a string");
  }
  const words = slug.toLowerCase().match(/[a-z0-9]+/g) || [];
  const normalized = words
    .slice(0, MAX_SLUG_WORDS)
    .map((word) => word.slice(0, MAX_SLUG_WORD_LENGTH))
    .join("-");
  const wordCount = normalized.split("-").filter(Boolean).length;
  if (wordCount < MIN_CUSTOM_SLUG_WORDS || wordCount > MAX_SLUG_WORDS) {
    throw new Error(
      `slug must normalize to ${MIN_CUSTOM_SLUG_WORDS}-${MAX_SLUG_WORDS} alphanumeric words for Oracle sessions`,
    );
  }
  return normalized;
}

function validateSlug(slug) {
  return normalizeOracleSlug(slug);
}

function ensureStateShape(raw) {
  if (!raw || typeof raw !== "object") {
    return { version: STATE_VERSION, required: {} };
  }
  const required = raw.required && typeof raw.required === "object" ? raw.required : {};
  return { version: STATE_VERSION, required };
}

function readState(env = process.env) {
  const file = statePath(env);
  try {
    return ensureStateShape(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return { version: STATE_VERSION, required: {} };
    }
    throw error;
  }
}

function writeState(state, env = process.env) {
  const file = statePath(env);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(ensureStateShape(state), null, 2)}\n`);
  fs.renameSync(tmp, file);
  return file;
}

function requireReview(slug, options = {}, env = process.env) {
  const requestedSlug = String(slug);
  const stableSlug = validateSlug(requestedSlug);
  const state = readState(env);
  const previous = state.required[stableSlug] || {};
  const timestamp = nowIso();
  state.required[stableSlug] = {
    slug: stableSlug,
    requestedSlug,
    reason: options.reason || previous.reason || "",
    createdAt: previous.createdAt || timestamp,
    updatedAt: timestamp,
    active: true,
  };
  const file = writeState(state, env);
  return { statePath: file, entry: state.required[stableSlug] };
}

function clearReview(slug, env = process.env) {
  const requestedSlug = String(slug);
  const stableSlug = validateSlug(requestedSlug);
  const state = readState(env);
  const existed = Boolean(state.required[stableSlug] || state.required[requestedSlug]);
  delete state.required[stableSlug];
  delete state.required[requestedSlug];
  const file = writeState(state, env);
  return { statePath: file, slug: stableSlug, requestedSlug, existed };
}

function sessionMetaPath(slug, env = process.env) {
  return path.join(oracleHomeDir(env), "sessions", slug, "meta.json");
}

function readSessionMeta(slug, env = process.env) {
  const file = sessionMetaPath(slug, env);
  try {
    return { metaPath: file, metadata: JSON.parse(fs.readFileSync(file, "utf8")) };
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return { metaPath: file, metadata: null };
    }
    throw error;
  }
}

function classifySessionStatus(status) {
  if (TERMINAL_SUCCESS.has(status)) return "completed";
  if (TERMINAL_FAILURE.has(status)) return "failed";
  if (NON_TERMINAL.has(status)) return "running";
  if (!status) return "missing";
  return "running";
}

function listRequiredStatuses(env = process.env) {
  const state = readState(env);
  const entries = Object.entries(state.required)
    .map(([key, value]) => {
      const entry = value && typeof value === "object" ? value : {};
      return { key, entry };
    })
    .filter(({ entry }) => entry.active !== false)
    .map(({ key, entry }) => {
      const requestedSlug = entry.requestedSlug || entry.slug || key;
      const slug = validateSlug(entry.slug || requestedSlug);
      const { metaPath, metadata } = readSessionMeta(slug, env);
      const status = metadata ? String(metadata.status || "") : "missing";
      return {
        slug,
        requestedSlug,
        reason: entry.reason || "",
        requiredAt: entry.createdAt || null,
        updatedAt: entry.updatedAt || null,
        status,
        state: metadata ? classifySessionStatus(status) : "missing",
        model: metadata && metadata.model ? metadata.model : null,
        mode: metadata && metadata.mode ? metadata.mode : null,
        metaPath,
      };
    });
  return { statePath: statePath(env), entries };
}

function formatBlockMessage(blocked) {
  const lines = blocked.map((entry) => {
    const label =
      entry.requestedSlug && entry.requestedSlug !== entry.slug
        ? `${entry.requestedSlug} (session ${entry.slug})`
        : entry.slug;
    if (entry.state === "running") {
      return `${label}: ${entry.status}. Check Oracle MCP sessions before finishing.`;
    }
    if (entry.state === "failed") {
      return `${label}: ${entry.status}. Handle the Oracle failure before finishing.`;
    }
    return `${label}: no session metadata at ${entry.metaPath}. Check whether consult started or clear the required slug.`;
  });
  return `Required Oracle review is not complete:\n${lines.join("\n")}`;
}

function guardDecision(env = process.env) {
  const status = listRequiredStatuses(env);
  const blocked = status.entries.filter((entry) => entry.state !== "completed");
  if (blocked.length === 0) {
    return {
      decision: "allow",
      statePath: status.statePath,
      entries: status.entries,
    };
  }
  return {
    decision: "block",
    reason: formatBlockMessage(blocked),
    statePath: status.statePath,
    entries: status.entries,
  };
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function main(argv = process.argv.slice(2)) {
  const command = argv[0] || "status";
  if (command === "require") {
    const slug = argv[1];
    const reason = argv.slice(2).join(" ");
    printJson(requireReview(slug, { reason }));
    return;
  }
  if (command === "clear") {
    printJson(clearReview(argv[1]));
    return;
  }
  if (command === "guard" || command === "hook") {
    printJson(guardDecision());
    return;
  }
  if (command === "status") {
    printJson(listRequiredStatuses());
    return;
  }
  throw new Error(`Unknown command: ${command}`);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error && error.stack ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  clearReview,
  guardDecision,
  listRequiredStatuses,
  normalizeOracleSlug,
  oracleHomeDir,
  readState,
  requireReview,
  statePath,
  validateSlug,
};
