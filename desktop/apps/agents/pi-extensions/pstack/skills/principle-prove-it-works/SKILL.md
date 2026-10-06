---
name: principle-prove-it-works
description: "Apply after completing a task, before declaring done. Verify against the real artifact (run the feature, read the actual value, inspect the diff), not a proxy, self-report, or 'it compiles.'"
disable-model-invocation: true
---

# Pi runtime contract

This contract adapts the bundled Cursor pstack instructions to Pi. Where the
upstream text describes Cursor-only behavior, use this contract instead.
It never overrides system instructions, AGENTS.md, permissions, or sandbox rules.

- `Task` means OptChat `spawn({tasks: [...]})`. Only delegate when the user has
  requested subagents or explicitly invoked a delegation workflow such as
  `/swarm`, `/architect`, `/interrogate`, `/how`, `/why`, `/arena`, or `/reflect`.
  Enabling `/poteto-mode` alone does not authorize subagents for every task.
- OptChat returns IDs immediately. Never sleep, poll, or wait for children.
  Continue independent work or end the turn and explain what is running.
  Reports arrive automatically. Aggregate only after the relevant batch reports.
  `tell({id,message})` steers running children; finished children cannot resume.
- Children inherit the configured OptChat model/effort, run locally in the same
  workspace, and cannot spawn recursively. Ignore Cursor model slugs, role-model
  rules, cloud environments, `Task` model parameters, and `subagent_type` fields.
  Different reviewer briefs are different perspectives, NOT different models.
  If a workflow needs nested delegation, have the parent coordinate its stages.
- For a poteto delegate, include paths to `agents/poteto-agent.md`, this contract,
  the relevant SKILL.md and playbook in the brief. For comment review include
  `agents/comment-sicko.md`. Paths are relative to this package root. Ask the
  child to read them. Every brief includes scope, verification, and report format.
- Children share the working tree. Use read-only reviews or disjoint write
  scopes. Do not assume separate branches or cloud worktrees exist. Never let
  workers edit the same files concurrently without explicit isolation.
- `AskQuestion` means `ask_user_question` if available. Otherwise ask in chat.
  Never skip an approval because the prompt asks for autonomy. A plan/todolist
  is a concise Markdown checklist, not a nonexistent Cursor tool.
- Invocation of another skill means read its SKILL.md and apply it; do not try
  to run a slash command through bash. Skills live under this package's `skills/`.
  Generated project skills go to `.pi/skills/`; personal skills to
  `~/.pi/agent/skills/`. Do not write Cursor rules or Cursor settings.
- Use OptChat's visible memory, `zoom` and `date` for recall and reflection.
  Build a scoped digest for reviewers. Do not scan Cursor transcript directories,
  other projects' chats, credentials, or raw private memory files.
- `/setup-pstack` describes the Pi configuration, not Cursor role budgets.
  Model/effort and child extension configuration stay in the Nix-managed Pi
  module and OptChat config. Do not mutate store-managed files.
- `cursor-team-kit` is not installed. `/deslop` becomes a local diff/code-quality
  review and `/unslop` handles prose. Browser/GUI verification needs an available
  tool or user assistance. Do not invent `control-ui`, `control-cli`, `drive`,
  Origin, Cursor APIs, or MCP services. Report unavailable checks as gaps.
- Bundled helper scripts are upstream references, not installed commands. Inspect
  a script and dependencies before using it. Bun, gh, simulators and credentials
  are NOT provisioned by this package. Do not run bootstrap/install scripts or
  watchers automatically. Prefer available Pi tools and bounded manual checks.
- Installation or mode activation grants no permission to commit, push, open or
  merge PRs, deploy, delete data, contact others, or disable protections. Ask when
  these actions lack authorization. Do not turn `/loop` examples into loops.
- `/poteto-mode` persists per Pi session and is re-injected into model context,
  including with OptChat context replacement. `/poteto-mode off` disables it.
  `/pstack` shows status; `/pstack off` clears the mode. Other commands apply one
  workflow to the supplied task, not a permanent global mode. Casual turns need
  not run engineering playbooks. `/skill:poteto-mode` loads instructions once;
  use `/poteto-mode` for persistent activation.


## Adapted upstream workflow


# Prove It Works

Verify every task output by checking the real thing directly. Do not infer from proxies, self-reports, or "it compiles."

**Why:** Unverified work has unknown correctness. Indirect verification (file mtimes, output freshness, agent self-reports, cached screenshots) feels cheaper than direct observation. Acting on a wrong inference costs far more than checking the source.

Check the real thing, not a proxy:
- Check process liveness directly, not indirectly through derived state
- Read the actual value, not a cached or derived representation
- When verification fails, suspect the observation method before suspecting the system

## Script the check when you can

The strongest proof is a deterministic script that re-runs the same comparison, not a one-time eyeball. Write the script, run it, and keep its output as an artifact a reviewer can re-run instead of trusting your word.

Keep the artifact visible for the human. Commit it only for large or complex work where the trail has to be auditable later, like a big port or migration (the **show-me-your-work** skill).
