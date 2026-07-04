Use the installed Oracle CLI/skill. Do not edit files.

Task: verify that Codex can use Oracle Pro Extended and wait for the result.

1. Run this dry run first:

```bash
oracle --dry-run summary --files-report --engine browser --model gpt-5.5-pro \
  --browser-model-strategy select \
  --browser-attachments always --browser-bundle-files --browser-bundle-format zip \
  --slug "codex smoke cart review" \
  -p "Review this tiny JavaScript cart module for correctness bugs and testing gaps. Return concrete findings with reasoning. This is a smoke test, but give a real, varied review response." \
  --file "README.md" --file "src/cart.js" --file "tests/cart.test.js"
```

2. If the dry run succeeds, run the same command without `--dry-run summary --files-report`.
3. Wait for Oracle to finish. Pro Extended can take 5 to 45 minutes; do not give up early and do not rerun duplicate prompts.
4. If the process detaches or times out, use `oracle status --hours 72` and `oracle session <id-or-slug> --render`.
5. Final response must include:
   - `AGENT_SMOKE_DONE codex-1`
   - Oracle session id or slug
   - Whether zipped attachment bundling was used
   - 3-6 bullet summary of Oracle's actual answer

