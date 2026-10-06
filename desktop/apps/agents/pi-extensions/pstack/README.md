# Pstack for Pi (local port)

Source: https://github.com/cursor/plugins/tree/main/pstack
Vendored revision: `df581122cde17e6e27686b5a448bde23e4ad4318`.
Upstream LICENSE is retained. Skills, playbooks, references, helper scripts and
agent briefs are bundled. Cursor automations and plugin installation metadata
are deliberately not installed. Nothing is downloaded at runtime by this port.

Local changes: normalized skill names; Pi runtime contract prepended to all 51
skills; generated-skill paths changed to Pi paths; setup and recall rewritten
for Pi; session-persistent mode and direct slash-command extension added.
Upstream helper scripts remain reference material, with no dependencies
installed or scripts automatically executed. Read PI-COMPATIBILITY.md first.

## Installation

`desktop/apps/agents/pi.nix` maps this whole directory to `~/.pi/agent/pstack`
and declares `./pstack` as a local Pi package. The package manifest loads
`index.ts` and `skills/`. It does not belong directly under the runtime
`~/.pi/agent/extensions/` directory, which would not discover its skills.
OptChat child sessions explicitly load `pstack/index.ts` along with the existing
permission and sandbox extensions. The adapter does not disable either guard.

After rebuilding Home Manager/NixOS, restart Pi or `/reload`.

## Usage

- `/pstack` lists commands and mode status.
- `/poteto-mode` or `/poteto-mode on` enables the mode for this session without
  starting a model request. `/poteto-mode <task>` enables it and submits a task.
- `/poteto-mode off` or `/pstack off` disables it.
- `/how <task>`, `/swarm <task>`, `/architect <task>`, `/interrogate <task>`,
  `/tdd <task>` and every other skill name work as direct commands.
- `/skill:<name>` remains Pi's standard explicit skill invocation.
- `/setup-pstack` explains the Pi setup instead of writing Cursor model rules.

The mode is restored from the active Pi session branch, not globally enabled.
Its instructions are injected on each model request, so OptChat's context
replacement and report-driven continuations do not erase it. A one-shot command
is a workflow request, not a new tool or an automatic execution engine.

## Differences from Cursor

OptChat children run locally, inherit its configured model/effort, share the
working tree and cannot delegate recursively. Multi-model panels become
same-model independent perspectives, explicitly labeled as such. Reports arrive
asynchronously; the parent never polls or waits. Cloud workers, Cursor GUI
controllers, role-model budgets and Cursor automations are not implemented.
External helper dependencies are not installed. Safety and approval rules take
precedence over the upstream autonomy/commit/shipping instructions.

`/loop` is not implemented. A future extension should require explicit start,
interval, iteration/time limits and a stop condition; prevent overlapping turns;
stop on errors or pending approvals; expose status and stop; and cancel timers
on reload/session switch/shutdown. It should not auto-start on session resume.

## Tests

`node --experimental-strip-types --test desktop/apps/agents/pi-extensions/pstack/index.test.mjs`

The tests cover command discovery, mode activation/off, preserved arguments,
branch restoration, structured system messages, and one-shot workflow dispatch.
They do not establish quality of model execution or external tool compatibility.
