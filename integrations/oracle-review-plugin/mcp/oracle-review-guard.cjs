#!/usr/bin/env node
"use strict";

const { createRequire } = require("node:module");
const state = require("../scripts/oracle-review-state.cjs");

const oracleRequire = createRequire("/Users/yukito-nonaka/tasks/oracle-setup/oracle/package.json");
const { McpServer } = oracleRequire("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = oracleRequire("@modelcontextprotocol/sdk/server/stdio.js");
const { z } = oracleRequire("zod");

function textContent(value) {
  return [
    {
      type: "text",
      text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
    },
  ];
}

async function startServer() {
  const server = new McpServer({
    name: "oracle-review-guard",
    version: "0.1.0",
  });

  server.registerTool(
    "require_review",
    {
      title: "Register required Oracle review",
      description:
        "Record a stable Oracle review slug as required before the agent may finish. The slug is normalized the same way as Oracle session ids. Call this when an Oracle consult gates the final answer. The Oracle result must be fetched before finalizing even when it takes 10-60 minutes.",
      inputSchema: {
        slug: z.string().describe("Stable Oracle session slug; normalized to Oracle's 3-5 alphanumeric word session id."),
        reason: z.string().optional().describe("Why this Oracle review gates the final answer."),
      },
    },
    async (input) => {
      const result = state.requireReview(input.slug, { reason: input.reason });
      return { content: textContent(result), structuredContent: result };
    },
  );

  server.registerTool(
    "clear_review",
    {
      title: "Clear required Oracle review",
      description:
        "Clear a required Oracle review slug only after its completed result has been fetched, reread, digested, compared with the agent's own conclusion, and either incorporated or explicitly rejected. Accepts the original requested slug or normalized Oracle session id. Do not trust Oracle blindly.",
      inputSchema: {
        slug: z.string().describe("Stable Oracle session slug or normalized Oracle session id."),
      },
    },
    async (input) => {
      const result = state.clearReview(input.slug);
      return { content: textContent(result), structuredContent: result };
    },
  );

  server.registerTool(
    "review_status",
    {
      title: "List required Oracle reviews",
      description:
        "List currently required Oracle review slugs and their session status from the local Oracle session store. Requested slugs are resolved to Oracle's normalized session ids. Use this after timeout, detach, or a long wait before retrying or finalizing.",
      inputSchema: {},
    },
    async () => {
      const result = state.listRequiredStatuses();
      return { content: textContent(result), structuredContent: result };
    },
  );

  server.registerTool(
    "review_guard",
    {
      title: "Check Oracle review finish guard",
      description:
        "Return allow/block for finishing based on required Oracle review slugs resolved to normalized Oracle session ids. This short check blocks finalization while a required Oracle result is missing, running, or failed; after allow, still think through the fetched result carefully instead of blindly accepting it.",
      inputSchema: {},
    },
    async () => {
      const result = state.guardDecision();
      return { content: textContent(result), structuredContent: result };
    },
  );

  const transport = new StdioServerTransport();
  const closed = new Promise((resolve) => {
    transport.onclose = resolve;
  });
  await server.connect(transport);
  await closed;
}

if (process.argv.includes("--self-test")) {
  console.log(JSON.stringify(state.guardDecision(), null, 2));
} else {
  startServer().catch((error) => {
    console.error("Failed to start oracle-review-guard MCP:", error);
    process.exitCode = 1;
  });
}
