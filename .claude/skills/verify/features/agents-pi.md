# Pi coding agent

`pi` (pi-coding-agent from unstable) runs on Anthropic (`claude-opus-5-5` through the `pi-anthropic-oauth` plugin) with pinned npm/git packages (web access, permission system, sandbox, OAuth, pstack), a path/bash permission policy, and the local optchat-memory extension that keeps durable memory under `~/.local/share/pi/optchat-memory/default`, a git repo committed after every turn.

Owner: `desktop/apps/agents/pi.nix`. Extension source: `desktop/apps/agents/pi-extensions/optchat-memory/`. Pi loads pstack from the pinned `git:` package, and pstack's `agent` tool is the only subagent mechanism.

## Sub-features

- `pi-settings`: `~/.pi/agent/settings.json` sets the default provider/model, thinking level, `+codemode`, `cacheWarming: "off"` (OptChat §8, no keep-alive pings), and pinned packages.
- `pi-permissions`: `~/.pi/agent/extensions/pi-permission-system/config.json` denies `*.env*` (allows `*.env.example`), `~/.secrets`, `~/.ssh`, `~/.gnupg`, `*.pem`, `*.key`, and `*credentials.json`. It asks before reading or writing `~/Documents`, `~/Downloads`, `~/Pictures`, and `~/Desktop/me`. Bash asks by default, `rm -rf *` is denied, `sudo *` asks, and `external_directory` asks.
- `pi-npm-activation`: the `piNpmPolicy` activation step runs `pi-npm-policy.mjs` on `~/.pi/agent/npm/package.json` (pins the patched MCP SDK, denies native install scripts), reinstalls when that changes, then applies `pi-anthropic-oauth-onpayload.patch` so the plugin calls Pi's `onPayload` hook and OptChat's view cache breakpoints reach Anthropic.
- `pi-optchat-ext`: `~/.pi/agent/extensions/optchat-memory/*.ts` is the extension source. In Pi it adds the `zoom` and `date` tools, the `memory_status`/`memory_verify`/`memory_control` tools, and the `/memory` command (status, verify, zoom, date, pause, resume, rebuild-tree, export, import-notes, html). Each turn sees the summarized view plus only that turn's messages, waits for the compactor first (Esc cancels the wait), and logs pstack agent reports as `[id] ...` user messages. Under pstack child processes it runs in a reduced, frozen-snapshot mode (`PSTACK-MEMORY.md`).
- `pi-optchat-config`: `~/.pi/agent/optchat-memory.json` sets the memory dir, sizes, retries, tool-result cap, and compactor model.
- `pi-env`: `PI_OPTCHAT_*` session variables.

## How to get to it (user POV)

- Run `pi` in any project directory. Settings and extensions load from `~/.pi/agent/`.
- Edit `pi.nix`, then `sudo nixos-rebuild switch --flake .#nixos`.

## Driving it with verify

Preconditions: `$V build` after the edit.

- **Settings.** Change the model or a package pin. Run `$V diff-live .pi/agent/settings.json`. The patch shows only the intended JSON key change.
- **Permissions.** Change a rule. Run `$V diff-live .pi/agent/extensions/pi-permission-system/config.json`. Rule order is preserved (the last matching rule wins).
- **Extension files.** Add or edit a `.ts` file. Run `$V ls .pi/agent/extensions/optchat-memory`. The new file is listed. If it isn't, it's untracked: `git add -N` it and rebuild.
- **Extension tests.** Run `node --test desktop/apps/agents/pi-extensions/optchat-memory/*.test.mjs desktop/apps/agents/pi-npm-policy.test.mjs`. All tests pass.
- **Memory config.** Run `$V file .pi/agent/optchat-memory.json`. `memoryDir` and `compactorModel` hold the expected values.
- **Env.** Run `$V eval home-manager.users.moka.home.sessionVariables`. The `PI_OPTCHAT_*` keys match `optchat-memory.json`.
- **Activation script.** Run `$V eval home-manager.users.moka.home.activation.piNpmPolicy.data`. It references the built `pi-npm-policy.mjs` and `pi-anthropic-oauth-onpayload.patch` store paths.
- **OAuth patch (post-switch).** Run `grep -n 'options?.onPayload' ~/.pi/agent/npm/node_modules/pi-anthropic-oauth/src/stream.ts`. One match means the patch applied.
- **Memory commits (post-switch, after a Pi turn).** Run `git -C ~/.local/share/pi/optchat-memory/default log --oneline -3`. The top commit reads `messages 0-<n>`.
- **View caching (post-switch, after a multi-turn Pi session).** In the newest `~/.pi/agent/sessions/<cwd>/*.jsonl`, each turn's first assistant `usage.cacheRead` covers most of the view, not just the system prompt (about 17k tokens).
- **Runtime (post-switch).** Run `pi` and check that the extension loads. Not verifiable from a build.

## Gotchas

- The extension dir is copied from git-tracked files only. A new file is missing from the build until `git add -N`. The same goes for `pi-npm-policy.mjs` and the `.patch` file, which `pi.nix` references directly; untracked, they fail the eval.
- `config.json` uses `force = true` because `pi install` writes the same path. Activation overwrites whatever Pi wrote there.
- `optchat-memory.json` and `home.sessionVariables` duplicate values (memory dir, node/view bytes, jobs, cap chars, replace context). When both set a value, the `PI_OPTCHAT_*` variable wins (`config.ts`), so change both together. Session variables only reach new login shells after a switch.
- npm packages are installed by Pi at runtime into `~/.pi/agent/npm/`, not by Nix. A new package pin builds fine even if the package doesn't exist.
- Bumping `pi-anthropic-oauth` can stop the patch from applying. Activation then prints `pi: pi-anthropic-oauth onPayload patch no longer applies` and view caching silently stays off. Watch the switch output after a bump.
- `~/.pi/agent/extensions/optchat-memory` must be the Home Manager link. A hand-made symlink there makes the switch fail with "would be clobbered".
