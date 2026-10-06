---
name: how
description: "Use for \"how does X work\", code walkthroughs before changing something, and placement / ownership / layering questions (\"where should this live\", \"which package owns this\", \"is this the right layer\"). Explains subsystem architecture, runtime flow, onboarding mental models. Use why for motivation."
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


# How

Explore the codebase to answer "how does X work?" questions. Produce architectural explanations at the level of a senior engineer onboarding onto a subsystem, enough to build a working mental model, not so much that it reads like annotated source code.

Each spawn below names a role line in the `pstack-models.mdc` rule and a default. Set `model` to that line's value, or to the default if the rule or the line is missing. Leave `model` unset when the value is `auto` or `inherit-parent`. If the Task tool rejects a slug, use the default and say so. If it rejects the default, use the closest valid slug of the same family from its error message.

## Step 1. Assess Complexity

If the scope is ambiguous, state your interpretation and explore. The user can redirect.

- **Simple** (a single module, a small utility, a narrow question such as "how does function X work"): no explorers. One explainer explores and explains in a single pass. Go to Step 2b.
- **Complex** (a subsystem spanning multiple files or services, a cross-cutting feature, a full architectural overview): spawn parallel explorers first, then hand off to the explainer. Go to Step 2a.

When in doubt, take the simple path.

## Step 2a. Explore (complex questions only)

Decompose the question into 2 to 4 exploration angles, each a distinct slice of the subsystem. Spawn all explorers in a single message:

- `subagent_type`: `generalPurpose`
- `model`: the `how explorer` line, default `grok-4.7-xhigh-fast`
- `readonly`: `true`

Each explorer gets the prompt in `references/explorer-prompt.md` with its angle filled in. Then go to Step 3.

## Step 2b. Direct Explain (simple questions)

Spawn one Task subagent that explores and explains in one pass:

- `subagent_type`: `generalPurpose`
- `model`: the `how explainer` line, default `claude-opus-5-5-xhigh`
- `readonly`: `true`

Build its prompt from `references/explainer-prompt.md` without the explorer-findings section. Go to Step 4.

## Step 3. Synthesize (complex questions only)

Once all explorers have returned, spawn one Task subagent to synthesize their findings into one explanation:

- `subagent_type`: `generalPurpose`
- `model`: the `how explainer` line, default `claude-opus-5-5-xhigh`
- `readonly`: `true`

Build its prompt from `references/explainer-prompt.md` with every explorer's findings filled in.

## Step 4. Present

Present the explainer's output to the user. Light edits for clarity or context from the conversation are fine. Do not substantially rewrite it.

## Output Format

The explanation uses the sections defined in `references/explainer-prompt.md`, dropping any that do not apply: Overview, Key Concepts, How It Works, Where Things Live, Gotchas.
