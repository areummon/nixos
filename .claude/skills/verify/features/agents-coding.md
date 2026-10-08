# Coding agents and global rules

OpenCode, with a bubblewrap-sandboxed launcher (`opencode-sandboxed`), Codex, with a network-enabled delegation profile, and the shared `~/AGENTS.md` rules file that agent sessions under `~` read (except inside `opencode-sandboxed`, which can't see it). Claude Code itself is a plain package in `home-manager/home.nix`.

Owners: `desktop/apps/agents/opencode.nix`, `codex.nix`, `agents-md.nix`. The OpenCode package comes from the `opencode` flake overlay in `nixos/configuration.nix`.

## Sub-features

- `opencode-settings`: `~/.config/opencode/opencode.json` sets `model` and `small_model`.
- `opencode-sandboxed`: the `opencode-sandboxed` wrapper. bwrap gives it a tmpfs home where only the three opencode dirs and `$PWD` are persistently writable (the tmpfs home, `/tmp`, and `/run` are writable but discarded), plus read-only `/nix/store`, `/etc`, and the system and user profiles. PID, UTS, IPC, and cgroup are unshared, capabilities are dropped, and the environment is cleared. `/tmp` and `/run` are empty tmpfs mounts, so setuid wrappers such as `sudo` aren't available inside. The network is **not** unshared.
- `codex-delegation`: `~/.codex/opencode-delegation.config.toml` (workspace-write, `approval_policy = "on-request"`, network on, with Codex's `network_proxy` allowlisting only the openrouter domains), layered over the base config by `codex --profile opencode-delegation`, which the `codex-opencode` zsh function in `desktop/shell/zsh.nix` runs.
- `agents-md`: `~/AGENTS.md` lists secrets that are off limits, folders that need asking first, and general conduct rules.

## How to get to it (user POV)

- Run `opencode` or `cd <project> && opencode-sandboxed`.
- Run `codex`, or `codex-opencode` for the delegation profile with OpenRouter credentials loaded.
- Any agent started under `~` picks up `~/AGENTS.md`, except `opencode-sandboxed`, whose tmpfs home hides it.

## Driving it with verify

Preconditions: `$V build` after the edit.

- **OpenCode model.** Run `$V diff-live .config/opencode/opencode.json`. Only `model` or `small_model` changes.
- **Sandbox wrapper.** Run `cat "$(cat $($V run)/toplevel.path)/etc/profiles/per-user/moka/bin/opencode-sandboxed"`. The `bwrap` flags match the edit.
- **Codex profile.** Run `$V diff-live .codex/opencode-delegation.config.toml`. The TOML change is visible.
- **Global rules.** Run `$V diff-live AGENTS.md`. The rule text matches the edit.
- **Sandbox behavior (post-switch).** Copy the wrapper to scratch with its `.../bin/opencode "$@"` line replaced by `/opt/system-profile/bin/sh -c 'ls -A $HOME; test -e $HOME/AGENTS.md || echo AGENTS.md missing'`, then run the copy from `/tmp/<scratch>` with `timeout 10 ... </dev/null`. It prints `.config .local` (plus `.cache` when `~/.cache/opencode` exists, since that mount is `--bind-try`) and `AGENTS.md missing`. From a dir under `~`, the top-level directory of `$PWD` also shows. If the line isn't replaced, the real OpenCode TUI starts, so keep the `timeout`.

## Gotchas

- In zsh, `opencode` is a function (`zsh.nix`) that loads the OpenRouter key into that one process. `opencode-sandboxed` doesn't go through it, and `--clearenv` drops the environment, so it has no `OPENROUTER_API_KEY`. It works only with credentials OpenCode saved under `~/.local/share/opencode`.
- The base `~/.codex/config.toml` isn't managed by Nix. It sets no sandbox or network keys, so the "normal profile stays network-disabled" comment in `codex.nix` rests on Codex's own workspace-write default.
- Codex's Linux sandbox needs `bwrap` on PATH, and only `pi.nix` installs it (`pkgs.unstable.bubblewrap`). Removing it there breaks Codex sandboxing. `opencode-sandboxed` calls bwrap by store path and is unaffected.
- `codex-opencode` lives in `zsh.nix`, not `codex.nix`. Edits to the profile and to its launcher are in two files.
- `~/AGENTS.md` is a home-manager symlink. Editing it in place fails, so edit `agents-md.nix` instead.
- This repo's own Claude Code settings live outside Nix in `~/.claude/` (for example `pstack-models.md`), not in this flake.
