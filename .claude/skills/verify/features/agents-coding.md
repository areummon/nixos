# Coding agents and global rules

OpenCode, with a bubblewrap-sandboxed launcher (`opencode-sandboxed`), Codex, with a network-enabled delegation profile, and the shared `~/AGENTS.md` rules file that every agent session under `~` reads. Claude Code itself is a plain package in `home-manager/home.nix`.

Owners: `desktop/apps/agents/opencode.nix`, `codex.nix`, `agents-md.nix`. The OpenCode package comes from the `opencode` flake overlay in `nixos/configuration.nix`.

## Sub-features

- `opencode-settings`: `~/.config/opencode/opencode.json` sets `model` and `small_model`.
- `opencode-sandboxed`: the `opencode-sandboxed` wrapper (bwrap with a private home, only the opencode dirs and `$PWD` bound).
- `codex-delegation`: `~/.codex/opencode-delegation.config.toml` (workspace-write, network allowed only to openrouter), launched by the `codex-opencode` zsh function in `desktop/shell/zsh.nix`.
- `agents-md`: `~/AGENTS.md` lists secrets that are off limits and folders that need asking first.

## How to get to it (user POV)

- Run `opencode` or `cd <project> && opencode-sandboxed`.
- Run `codex`, or `codex-opencode` for the delegation profile with OpenRouter credentials loaded.
- Any agent started under `~` picks up `~/AGENTS.md`.

## Driving it with verify

Preconditions: `$V build` after the edit.

- **OpenCode model.** Run `$V diff-live .config/opencode/opencode.json`. Only `model` or `small_model` changes.
- **Sandbox wrapper.** Run `cat "$(cat $($V run)/toplevel.path)/etc/profiles/per-user/moka/bin/opencode-sandboxed"`. The `bwrap` flags match the edit.
- **Codex profile.** Run `$V diff-live .codex/opencode-delegation.config.toml`. The TOML change is visible.
- **Global rules.** Run `$V diff-live AGENTS.md`. The rule text matches the edit.
- **Sandbox behavior (post-switch).** In a scratch dir, run `opencode-sandboxed` and ask it to `ls ~`. Only `.config`, `.local`, and the opencode dirs are visible.

## Gotchas

- In zsh, `opencode` is a function (`zsh.nix`) that loads the OpenRouter key into that one process. `opencode-sandboxed` doesn't go through it, and its bwrap `--clearenv` drops the environment too.
- `codex-opencode` lives in `zsh.nix`, not `codex.nix`. Edits to the profile and to its launcher are in two files.
- `~/AGENTS.md` is a home-manager symlink. Editing it in place fails, so edit `agents-md.nix` instead.
- This repo's own Claude Code settings live outside Nix in `~/.claude/` (for example `pstack-models.md`), not in this flake.
