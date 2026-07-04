Use the installed Oracle CLI/skill. Do not edit files.

Task: retry the OpenCode Oracle Pro Extended smoke after the earlier parallel OpenCode run hit a local database lock.

1. Run this dry run first:

```bash
oracle --dry-run summary --files-report --engine browser --model gpt-5.5-pro \
  --browser-model-strategy current \
  --browser-attachments always --browser-bundle-files --browser-bundle-format zip \
  --slug "opencode smoke bug detection retry" \
  -p "Find likely bugs in this tiny mixed JS/Python codebase. Rank the findings by user impact and explain which tests should be added. This is a smoke test retry, but give a real, varied review response." \
  --file "README.md" --file "src/**" --file "tests/**"
```

2. If the dry run succeeds, run the same command without `--dry-run summary --files-report`.
3. Wait for Oracle to finish. Pro Extended can take 5 to 45 minutes; do not give up early and do not rerun duplicate prompts.
4. If the process detaches or times out, use `oracle status --hours 72` and `oracle session <id-or-slug> --render`.
5. Final response must include:
   - `AGENT_SMOKE_DONE opencode-1-retry`
   - Oracle session id or slug
   - Whether zipped attachment bundling was used
   - 3-6 bullet summary of Oracle's actual answer

