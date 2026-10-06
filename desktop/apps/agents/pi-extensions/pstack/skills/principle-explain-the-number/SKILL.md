---
name: principle-explain-the-number
description: "Apply before you trust, report, or act on a number you measured: a speedup, a regression, a throughput, a latency, or an eval result. Find what limits it, and rule out that it measured something other than the work you think."
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


# Explain the Number

A measured number is a claim about a system. Before you trust it, report it, or act on it, find what limits it and rule out that it measured something else.

**Why:** A run that went wrong still prints a plausible number. Requests that failed, a cache that skipped the work, code that never ran, a side left on default settings, and run-to-run noise all produce results that look fine. If you cannot say why the number is not twice as good, you do not know what you measured.

**Pattern:**

- **Ask "why not double?"** Name the resource or code path that bounds the result, such as a core, a lock, the disk, the network, or the load generator itself. Get it from a profile or from system counters taken during a run, then map it to source. A guess from reading the code is not a limiter.
- **List what else the number could be measuring, and rule out each one with evidence.** The usual suspects are errors, skipped or cached work, an untuned side, noise, and a piece too small to matter end to end.
- **Keep the evidence with the number.** Put the run count, the spread, and the limiter in the notes or a linked artifact, so a reader can check the claim.

For a performance number, run the full procedure with the [benchmark-checklist](../benchmark-checklist/SKILL.md) skill. For an eval result, ask the same of the trials: did every run do the task, does the gap hold across trials and models, and does the scenario matter.

You skipped this when the evidence behind a number has no run count, no spread, or no named limiter, or when the time saved is larger than the time the changed piece took.

Distinct from [Prove It Works](../principle-prove-it-works/SKILL.md), which checks that an output is real. This checks that a measured number means what you say it means.
