# Coding agents and global rules

Claude Code and Claude Desktop, OpenCode with a bubblewrap-sandboxed launcher (`opencode-sandboxed`), and the shared `~/AGENTS.md` rules file that agent sessions under `~` read (except inside `opencode-sandboxed`, which can't see it). Codex and its network-enabled delegation profile are dormant: `codex.nix` stays in the repo but isn't imported.

Owners: `desktop/apps/agents/claude.nix`, `opencode.nix`, `agents-md.nix`; dormant: `codex.nix` (re-add it in `agents/default.nix`). Claude Code, Claude Desktop, Codex and OpenCode come from `pkgs.llm-agents` (the `llm-agents` overlay in `overlays/default.nix`). Hermes stays on its own flake: its home-manager module needs `hermesVenv` and `.override` hooks that the llm-agents `hermes-agent` lacks.

## Sub-features

- `claude-packages`: `claude.nix` puts `claude` (`pkgs.llm-agents.claude-code`) and `claude-desktop` in `home.packages`. Claude Code's settings in `~/.claude/` aren't managed by Nix.
- `claude-desktop-keyring`: `claude-desktop` is a `symlinkJoin` wrapper that adds `--password-store=gnome-libsecret`, because Electron only auto-detects the keyring on GNOME/KDE and otherwise falls back to the unencrypted "basic" store. The desktop entry `com.anthropic.Claude.desktop` runs the bare name `claude-desktop`, so the launcher hits the wrapper.
- `opencode-settings`: `~/.config/opencode/opencode.json` sets `model` and `small_model`.
- `opencode-sandboxed`: the `opencode-sandboxed` wrapper. bwrap gives it a tmpfs home where only the three opencode dirs and `$PWD` are persistently writable (the tmpfs home, `/tmp`, and `/run` are writable but discarded), plus read-only `/nix/store`, `/etc`, and the system and user profiles. PID, UTS, IPC, and cgroup are unshared, capabilities are dropped, and the environment is cleared. `/tmp` and `/run` are empty tmpfs mounts, so setuid wrappers such as `sudo` aren't available inside. The network is **not** unshared.
- `codex-delegation` (dormant): `~/.codex/opencode-delegation.config.toml` (workspace-write, `approval_policy = "on-request"`, network on, with Codex's `network_proxy` allowlisting only the openrouter domains), layered over the base config by `codex --profile opencode-delegation`.
- `agents-md`: `~/AGENTS.md` lists secrets that are off limits, folders that need asking first, and general conduct rules.

## How to get to it (user POV)

- Run `claude`, or open Claude from the launcher (`claude-desktop`).
- Run `opencode` or `cd <project> && opencode-sandboxed`.
- Any agent started under `~` picks up `~/AGENTS.md`, except `opencode-sandboxed`, whose tmpfs home hides it.

## Driving it with verify

Preconditions: `$V build` after the edit. Below, `B="$(cat $($V run)/toplevel.path)/etc/profiles/per-user/moka"`.

- **Claude packages.** Run `command ls $B/bin/ | grep -xE 'claude|claude-desktop'`, which lists both.
- **Claude Desktop keyring.** Run `grep -c -- --password-store=gnome-libsecret $B/bin/claude-desktop` (gives `1`) and `grep ^Exec $B/share/applications/com.anthropic.Claude.desktop` (bare `claude-desktop`).
- **OpenCode model.** Run `$V diff-live .config/opencode/opencode.json`. Only `model` or `small_model` changes.
- **Sandbox wrapper.** Run `cat $B/bin/opencode-sandboxed`. The `bwrap` flags match the edit.
- **Codex profile (when re-enabled).** Run `$V diff-live .codex/opencode-delegation.config.toml`. While dormant, `$V ls .codex` is empty.
- **Global rules.** Run `$V diff-live AGENTS.md`. The rule text matches the edit.
- **Sandbox behavior (post-switch).** Copy the wrapper to scratch with its `.../bin/opencode "$@"` line replaced by `/opt/system-profile/bin/sh -c 'ls -A $HOME; test -e $HOME/AGENTS.md || echo AGENTS.md missing'`, then run the copy from `/tmp/<scratch>` with `timeout 10 ... </dev/null`. It prints `.config .local` (plus `.cache` when `~/.cache/opencode` exists, since that mount is `--bind-try`) and `AGENTS.md missing`. From a dir under `~`, the top-level directory of `$PWD` also shows. If the line isn't replaced, the real OpenCode TUI starts, so keep the `timeout`.

## Gotchas

- `ls` is a zsh alias for eza, which prints the profile's symlinked binaries as `name -> target`, so `ls ... | grep -x` matches nothing. Use `command ls`.
- Dropping the `claude-desktop` wrapper, or giving the desktop entry an absolute store path, silently moves Claude Desktop back to the "basic" password store.
- OpenCode gets no API key from the environment. The default models are the free Zen `opencode/deepseek-v4.1-flash-free` (no login), and OpenRouter models use the key OpenCode saved in `~/.local/share/opencode/auth.json` (`opencode auth list`). The same holds inside `opencode-sandboxed`, which mounts that dir.
- When Codex is re-enabled: the base `~/.codex/config.toml` isn't managed by Nix and sets no sandbox or network keys, so the "normal profile stays network-disabled" comment in `codex.nix` rests on Codex's own workspace-write default. Codex's Linux sandbox needs `bwrap` on PATH, which only `pi.nix` installs (`pkgs.unstable.bubblewrap`).
- `~/AGENTS.md` is a home-manager symlink. Editing it in place fails, so edit `agents-md.nix` instead.
- This repo's own Claude Code settings live outside Nix in `~/.claude/` (for example `pstack-models.md`), not in this flake.
