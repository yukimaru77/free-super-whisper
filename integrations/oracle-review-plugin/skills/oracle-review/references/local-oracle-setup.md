# Local Oracle Review Setup

## Current Oracle Install

- CLI source: `/Users/yukito-nonaka/tasks/oracle-setup/oracle`
- Active CLI symlink: `/Users/yukito-nonaka/bin/oracle`
- MCP entrypoint: `/Users/yukito-nonaka/tasks/oracle-setup/oracle/dist/bin/oracle-mcp.js`
- Oracle home: `/Users/yukito-nonaka/.oracle`
- Session store: `/Users/yukito-nonaka/.oracle/sessions`

## Current Oracle Config

`/Users/yukito-nonaka/.oracle/config.json` is expected to use browser mode, `gpt-5.5-pro`, manual login, profile pooling, model selection, and extended thinking. Do not add per-request timeout values unless the operator explicitly asks.

The current profile pool is:

- `/Users/yukito-nonaka/.oracle/browser-profile`
- `/Users/yukito-nonaka/.oracle/browser-profile-2`

`manualLoginProfilePoolSize: 2` expands to those two profile directories. `maxConcurrentTabs: 2` is per profile. Follow-up sessions must stay pinned to the profile stored in the parent session metadata.

## Verified Behavior

- Browser mode manual login works.
- Profile 1 and profile 2 are signed in.
- `gpt-5.5-pro` selects ChatGPT Pro Extended.
- Image generation explicitly activates ChatGPT's Create image tool before Send.
- Deep Research can be selected and leaves the Deep research pill active.
- `chatgpt-pro-heavy` resolves to browser mode, `gpt-5.5-pro`, and extended thinking.

## Rebuild And Verify Oracle

Run these from `/Users/yukito-nonaka/tasks/oracle-setup/oracle` after source edits:

```bash
./node_modules/.bin/tsgo --noEmit
./node_modules/.bin/vitest run tests/browser/config.test.ts tests/browser/tabLeaseRegistry.test.ts tests/cli/browserDefaults.test.ts tests/cli/browserConfig.test.ts tests/cli/followup.test.ts tests/mcp/consult.test.ts
./node_modules/.bin/tsgo -p tsconfig.build.json
oracle --dry-run summary -p "config check"
```

## Plugin MCP Servers

The plugin exposes two MCP servers:

- `oracle`: starts the local Oracle MCP server and provides `consult`, `sessions`, `chatgpt_image`, and related Oracle tools.
- `oracle-review-guard`: stores required review slugs and reports whether finishing is allowed. It normalizes requested slugs the same way as Oracle session ids.

The Oracle consult remains the execution path. The guard MCP is state and policy support only.

## Stop Hook

The hook command is:

```bash
node /Users/yukito-nonaka/plugins/oracle-review/scripts/oracle-review-stop.cjs
```

It reads `/Users/yukito-nonaka/.oracle/review-required-sessions.json` and checks each active normalized slug's `meta.json`. It must not wait for Oracle completion.

If adding it to `~/.codex/hooks.json`, keep any existing stop hooks and append this command as another Stop hook.
