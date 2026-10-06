# Pi coding agent

`pi` (pi-coding-agent from unstable) runs with an OpenAI-Codex default model, pinned npm/git packages (web access, permission system, sandbox, pstack), a path/bash permission policy, and the local optchat-memory extension that keeps durable memory under `~/.local/share/pi/optchat-memory/default`.

Owner: `desktop/apps/agents/pi.nix`. Extension source: `desktop/apps/agents/pi-extensions/optchat-memory/`. `pi-extensions/pstack/` is a vendored reference copy that nothing in Nix uses. Pi loads pstack from the pinned `git:` package.

## Sub-features

- `pi-settings`: `~/.pi/agent/settings.json` sets the default provider/model, thinking level, `+codemode`, and pinned packages.
- `pi-permissions`: `~/.pi/agent/extensions/pi-permission-system/config.json` denies `*.env*` (allows `*.env.example`), `~/.secrets`, `~/.ssh`, `~/.gnupg`, `*.pem`, `*.key`, and `*credentials.json`. It asks before reading or writing `~/Documents`, `~/Downloads`, `~/Pictures`, and `~/Desktop/me`. Bash asks by default, `rm -rf *` is denied, `sudo *` asks, and `external_directory` asks.
- `pi-optchat-ext`: `~/.pi/agent/extensions/optchat-memory/*.ts` is the extension source. In Pi it adds the `/memory` command (status, verify, zoom, pause, resume, rebuild-tree, export, import-notes, html), the `/work` command, and the `spawn`/`tell` subagent tools. Under pstack child processes it runs in a reduced, frozen-snapshot mode (`PSTACK-MEMORY.md`).
- `pi-optchat-config`: `~/.pi/agent/optchat-memory.json` sets the memory dir, sizes, compactor model, and subagent tools/extensions.
- `pi-env`: `PI_OPTCHAT_*` session variables.

## How to get to it (user POV)

- Run `pi` in any project directory. Settings and extensions load from `~/.pi/agent/`.
- Edit `pi.nix`, then `sudo nixos-rebuild switch --flake .#nixos`.

## Driving it with verify

Preconditions: `$V build` after the edit.

- **Settings.** Change the model or a package pin. Run `$V diff-live .pi/agent/settings.json`. The patch shows only the intended JSON key change.
- **Permissions.** Change a rule. Run `$V diff-live .pi/agent/extensions/pi-permission-system/config.json`. Rule order is preserved (the last matching rule wins).
- **Extension files.** Add or edit a `.ts` file. Run `$V ls .pi/agent/extensions/optchat-memory`. The new file is listed. If it isn't, it's untracked: `git add -N` it and rebuild.
- **Extension tests.** Run `node --test desktop/apps/agents/pi-extensions/optchat-memory/pstack-memory.test.mjs`. All tests pass.
- **Memory config.** Run `$V file .pi/agent/optchat-memory.json`. `memoryDir` and `compactorModel` hold the expected values.
- **Env.** Run `$V eval home-manager.users.moka.home.sessionVariables`. The `PI_OPTCHAT_*` keys match `optchat-memory.json`.
- **Runtime (post-switch).** Run `pi` and check that the extension loads. Not verifiable from a build.

## Gotchas

- The extension dir is copied from git-tracked files only. A new file is missing from the build until `git add -N`.
- `config.json` uses `force = true` because `pi install` writes the same path. Activation overwrites whatever Pi wrote there.
- `optchat-memory.json` and `home.sessionVariables` duplicate values (memory dir, node/view bytes, jobs, cap chars, replace context). When both set a value, the `PI_OPTCHAT_*` variable wins (`config.ts`), so change both together. Session variables only reach new login shells after a switch.
- npm packages are installed by Pi at runtime into `~/.pi/agent/npm/`, not by Nix. A new package pin builds fine even if the package doesn't exist.
