Use the installed Oracle CLI/skill. Do not edit files.

Task: retry the Claude Code Oracle Pro Extended smoke after the earlier concurrent browser run failed.

1. Run this dry run first:

```bash
oracle --dry-run summary --files-report --engine browser --model gpt-5.5-pro \
  --browser-model-strategy current \
  --browser-attachments always --browser-bundle-files --browser-bundle-format zip \
  --slug "claude smoke cart evaluation retry" \
  -p "Evaluate this tiny JavaScript cart module as a reviewer. Focus on correctness, mutation side effects, null handling, and whether the tests would catch regressions. This is a smoke test retry, but give a real, varied review response." \
  --file "README.md" --file "src/cart.js" --file "tests/cart.test.js"
```

2. If the dry run succeeds, run the same command without `--dry-run summary --files-report`.
3. Wait for Oracle to finish. Pro Extended can take 5 to 45 minutes; do not give up early and do not rerun duplicate prompts.
4. If the process detaches or times out, use `oracle status --hours 72` and `oracle session <id-or-slug> --render`.
5. Final response must include:
   - `AGENT_SMOKE_DONE claude-1-retry`
   - Oracle session id or slug
   - Whether zipped attachment bundling was used
   - 3-6 bullet summary of Oracle's actual answer

