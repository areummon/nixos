# Pi coding agent

`pi` (pi-coding-agent from unstable) runs on Anthropic (`claude-opus-5-5` through the `pi-anthropic-oauth` plugin) with pinned npm/git packages (web access, permission system, OAuth, pstack), a path/bash permission policy, the local gondolin extension that runs Pi's file and shell tools inside a QEMU micro-VM, and the local optchat-memory extension that keeps durable memory per project under `~/.local/share/pi/optchat-memory/projects/<cwd key>` (cwd under home, `/` as `--`; home itself is `home`) plus user-wide notes under `~/.local/share/pi/optchat-memory/global`, each a git repo committed after every turn.

Owner: `desktop/apps/agents/pi.nix`. Extension sources: `desktop/apps/agents/pi-extensions/optchat-memory/` and `pi-extensions/gondolin/index.ts`. Pi loads pstack from the pinned `git:` package, and pstack's `agent` tool is the only subagent mechanism.

## Sub-features

- `pi-settings`: `~/.pi/agent/settings.json` sets the default provider/model, thinking level, `+codemode`, `cacheWarming: "off"` (OptChat §8, no keep-alive pings), and pinned packages.
- `pi-permissions`: `~/.pi/agent/extensions/pi-permission-system/config.json` denies `*.env*` (allows `*.env.example`), `~/.secrets`, `~/.ssh`, `~/.gnupg`, `*.pem`, `*.key`, and `*credentials.json`. It asks before reading or writing `~/Documents`, `~/Downloads`, `~/Pictures`, and `~/Desktop/me`. Bash, the host `nix` tool, and `external_directory` are allowed, because bash runs in the VM. `rm -rf`, `git reset --hard`, `git clean`, `git push`, `curl`, `wget`, `ssh`, and `scp` ask. `nixos-rebuild*` and `home-manager switch*` are denied. Wrappers such as `env`, `timeout`, and `bash -c` also ask, a floor of the extension itself.
- `pi-classifier`: `authorizerChain: ["classifier"]` sends every bash or tool ask to `pi-permission-classifier`, which has Haiku (`~/.pi/agent/extensions/pi-permission-classifier/config.json`) answer allow, deny, or defer. Only a defer prompts the user. It never judges the `path` or `external_directory` families, so the personal-dir asks always reach the user. A timeout, auth failure, or unknown model defers.
- `pi-gondolin`: `~/.pi/agent/extensions/gondolin/index.ts` boots a gondolin QEMU VM at session start (status line `Gondolin: running (<cwd> -> /workspace)`) and mounts only the working directory at `/workspace`. Pi's `read`, `write`, `edit`, `bash`, and user `!` commands run in the VM, the system prompt's cwd line says `/workspace`, host environment variables aren't forwarded, and a path outside the cwd fails with `path escapes workspace`. The guest is `alpine-base`, with no `nix` and no `/nix/store`.
- `pi-host-nix`: the gondolin extension also registers a `nix` tool that runs on the host, not in the VM. It takes `command` (`eval`, `build`, `flake-check`, `store-cat`) and a `target` (a `.#` flake output of the cwd, or a `/nix/store` path for `store-cat`), never a shell string. Every call passes `accept-flake-config false`, the flake commands pass `--no-update-lock-file`, and output is cut to the last 30k characters.
- `pi-pstack-sheet`: `~/.pi/agent/pstack-models.md` is Pi's pstack model override sheet. The pstack Pi extension reads it; `setup-pstack` can't write it from inside the VM, so model changes go in `pi.nix`.
- `pi-npm-activation`: the `piNpmPolicy` activation step runs `pi-npm-policy.mjs` on `~/.pi/agent/npm/package.json` (adds `@earendil-works/gondolin`, pins the patched MCP SDK, denies the `tree-sitter-bash` install script), reinstalls when the policy changed or the MCP SDK isn't 1.32.1, then applies `pi-anthropic-oauth-onpayload.patch` so the plugin calls Pi's `onPayload` hook and OptChat's view cache breakpoints reach Anthropic.
- `pi-optchat-ext`: `~/.pi/agent/extensions/optchat-memory/*.ts` is the extension source. In Pi it adds the `zoom`, `date`, `global_zoom`, and `global_date` tools, the `memory_status`/`memory_verify`/`memory_control`/`memory_note_global` tools, and the `/memory` command (status, verify, zoom, date, pause, resume, rebuild-tree, export, import-notes, html, plus `global-export`, `global-import-notes`, and `global-html`). Only one session at a time holds the global memory lock; the others warn and run with project memory only. Each turn sees the summarized view plus only that turn's messages, waits for the compactor first (Esc cancels the wait), and logs pstack agent reports as `[id] ...` user messages. Under pstack child processes (`--pstack-depth` above 0) it runs in a reduced mode over the parent's frozen snapshot, passed in `PI_OPTCHAT_PSTACK_SNAPSHOT` (`pstack-memory.ts`; design notes in `PSTACK-MEMORY.md`).
- `pi-optchat-config`: `~/.pi/agent/optchat-memory.json` sets the memory dir, sizes, retries, tool-result cap, and compactor model.
- `pi-env`: five session variables, `PI_OPTCHAT_NODE_BYTES`, `_VIEW_BYTES`, `_JOBS`, `_CAP_CHARS`, and `_REPLACE_CONTEXT`.

## How to get to it (user POV)

- Run `pi` in any project directory. Settings and extensions load from `~/.pi/agent/`.
- Edit `pi.nix`, then `sudo nixos-rebuild switch --flake .#nixos`.

## Driving it with verify

Preconditions: `$V build` after the edit.

- **Settings.** Change the model or a package pin. Run `$V diff-live .pi/agent/settings.json`. The patch shows only the intended JSON key change.
- **Permissions.** Change a rule. Run `$V diff-live .pi/agent/extensions/pi-permission-system/config.json`. Rule order is preserved (the last matching rule wins).
- **Gondolin and host nix.** Run `$V ls .pi/agent/extensions/gondolin` and `$V file .pi/agent/extensions/gondolin/index.ts`. The file contains `name: "nix"` and the `NIX_ARGV` table. To check the argv without Pi, run the same command on the host from the repo root, such as `nix --option accept-flake-config false eval .#nixosConfigurations.nixos.config.networking.hostName --no-update-lock-file --json`, which prints `"nixos"`.
- **pstack sheet.** Run `$V diff-live .pi/agent/pstack-models.md`. Only the intended role lines change.
- **Extension files.** Add or edit a `.ts` file. Run `$V ls .pi/agent/extensions/optchat-memory`. The new file is listed. If it isn't, it's untracked: `git add -N` it and rebuild.
- **Extension tests.** Run `node --test desktop/apps/agents/pi-extensions/optchat-memory/*.test.mjs desktop/apps/agents/pi-npm-policy.test.mjs`. All tests pass.
- **Memory config.** Run `$V file .pi/agent/optchat-memory.json`. `projectBaseDir`, `globalMemoryDir` and `compactorModel` hold the expected values.
- **Env.** Run `$V eval home-manager.users.moka.home.sessionVariables`. The `PI_OPTCHAT_*` keys match `optchat-memory.json`.
- **Activation script.** Run `$V eval home-manager.users.moka.home.activation.piNpmPolicy.data`. It references the built `pi-npm-policy.mjs` and `pi-anthropic-oauth-onpayload.patch` store paths.
- **OAuth patch (post-switch).** Run `grep -n 'options?.onPayload' ~/.pi/agent/npm/node_modules/pi-anthropic-oauth/src/stream.ts`. One match means the patch applied.
- **Memory commits (post-switch, after a Pi turn).** Run `git -C ~/.local/share/pi/optchat-memory/projects/nixos-config log --oneline -3`. The top commit reads `messages 0-<n>`.
- **View caching (post-switch, after a multi-turn Pi session).** In the newest `~/.pi/agent/sessions/<cwd>/*.jsonl`, each turn's first assistant `usage.cacheRead` covers most of the view, not just the system prompt (about 17k tokens).
- **Classifier (post-switch, after a Pi session that hit an ask).** In `~/.pi/agent/extensions/pi-permission-system/logs/pi-permission-system-permission-review.jsonl`, each ask is followed by a `classifier.decision` entry with a verdict. The footer shows `judge:anthropic/claude-haiku-4-5`. A run of `defer` with reason `auth-failed` or `timeout` means the judge isn't working, and every ask falls back to prompting.
- **Runtime (post-switch).** Run `pi` in this repo. The status line shows `Gondolin: running`, `!pwd` prints `/workspace`, and asking Pi to `eval` `.#nixosConfigurations.nixos.config.networking.hostName` with the `nix` tool returns `"nixos"` without a prompt. Not verifiable from a build.

## Gotchas

- The extension dir is copied from git-tracked files only. A new file is missing from the build until `git add -N`. The same goes for `pi-npm-policy.mjs` and the `.patch` file, which `pi.nix` references directly; untracked, they fail the eval.
- The classifier's config is a Home Manager link into the read-only store, so `/permission-model` inside Pi can't save a new judge. Change `model` in `pi.nix`, or use `pi --permission-model <provider>/<id>` for one session.
- `config.json` uses `force = true` because `pi install` writes the same path. Activation overwrites whatever Pi wrote there.
- `optchat-memory.json` and `home.sessionVariables` duplicate values (node/view bytes, jobs, cap chars, replace context). When both set a value, the `PI_OPTCHAT_*` variable wins (`config.ts`), so change both together. Session variables only reach new login shells after a switch.
- npm packages are installed by Pi at runtime into `~/.pi/agent/npm/`, not by Nix. A new package pin builds fine even if the package doesn't exist.
- Bumping `pi-anthropic-oauth` can stop the patch from applying. Activation then prints `pi: pi-anthropic-oauth onPayload patch no longer applies` and view caching silently stays off. Watch the switch output after a bump.
- `~/.pi/agent/extensions/optchat-memory`, `extensions/gondolin`, and `~/.pi/agent/node_modules` must be the Home Manager links. A hand-made symlink there makes the switch fail with "would be clobbered". `node_modules` is an out-of-store link to `npm/node_modules`, so the gondolin extension can import `@earendil-works/gondolin`.
- Inside Pi, the `verify` skill and `$V` don't work: the VM has no `nix`, and Pi doesn't read `.claude/skills/`. Pi checks flake changes with the `nix` tool instead. Its flake commands see only git-tracked files, and an edit that adds a flake input fails under `--no-update-lock-file` until the user runs `nix flake lock`.
