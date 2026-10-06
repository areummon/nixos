---
name: figure-it-out
description: "Design an auditable playbook when no narrower one fits: a large migration, an ambitious multi-part change, or work a human reviews after stepping away. Scales rigor to the task, runs a hypothesis loop, and logs decisions via show-me-your-work. Use for /figure-it-out, 'figure it out', a large migration, or when no narrower playbook applies."
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


# Figure it out

When the task matches no playbook, design one. The deliverable before any code is the workflow itself: a sequence of phases that scales rigor to the task, runs the scientific method, and leaves a decision trail a human can audit after stepping away.

## Start

Open a todolist whose first item is to read the Principles section of the **poteto-mode** skill. Then add the phases below as todos.

## Phase A: Frame

Ground first, then commit. Don't start the run until you can state:

- The definition of done as a falsifiable predicate (the **prove-it-works** principle skill).
- Scope, quantified: rough units and effort, plus the blockers grounding surfaced.
- The rigor level, biased high. One-way doors and high blast radius get more. Reversible low-stakes steps get less. Rigor is gates and artifacts, not "try harder".

Present the framing and tradeoffs before committing to a long run. Reversible work proceeds (the **never-block-on-the-human** principle skill), but a multi-hour run earns one checkpoint.

## Phase B: Design the workflow

Decompose into atomic, independently-landable units. Sequence riskiest-unknown-first. Scaffold and verification come before features (the **foundational-thinking** principle skill).

- Build the verification harness before the work, with the baseline captured from the pre-change state, so the check reads as "old value vs new value".
- For one-way-door design decisions, run the **architect** skill (it runs **arena**). Skip it for mechanical work whose shape is already concrete. A second arena over a settled design is over-engineering (the **laziness-protocol** principle skill).
- Decide what fans out. Parallelize only across seams, and give each worker its own worktree or branch (the **separate-before-serializing-shared-state** principle skill). Don't over-fan.
- Write the designed phase list down. That list is what the human reviews.

Then execute the design. Add its steps to the todolist as concrete items, after the Phase C entry and before Phase D. Run each under the Phase C loop discipline, and weave the Phase D log through them, a row as each step lands, rather than saving the whole trail for the end.

## Phase C: Run the loop

Each unit is an experiment. State the hypothesis, make the smallest change, measure against the predicate on the real artifact, keep it if it advanced, revert it if it didn't.
Apply the **sequence-verifiable-units** principle skill, verifying each unit before starting the next instead of batching checks at the end.

- Verify by inspecting the artifact, never a self-report. When something passes too easily, suspect the observation method before the system.
- Pair delegated work with a judge. If a worker games the gate, reset and harden the contract. If the gate itself is wrong, fix the gate in its own change rather than routing around it.
- A verdict is VERIFIED, NOT VERIFIED, or INCONCLUSIVE. Inconclusive is not a pass. Don't hide a negative.

## Phase D: Keep the audit trail

Log the run via the **show-me-your-work** skill. figure-it-out's work is usually ambitious enough to commit the trail so the reviewer can read it in the PR. The trail plus the diff is what lets the human come back and trust the work.

## Phase E: Verify and hand back

Check the whole against the Phase A predicate on the real product, not just the harness. Encode any recurring correction as a gate, a lint rule, a check, or a script (the **encode-lessons-in-structure** principle skill).

**Reply:** the playbook you designed, the rigor level and why, the decision-trail path, what's verified against the predicate, and what's still open.
