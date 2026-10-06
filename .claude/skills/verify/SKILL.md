---
name: verify
description: Verify changes to moka's NixOS + home-manager flake (Hyprland desktop, zsh/kitty/neovim, Pi/Hermes/OpenCode/Codex agents, system services) by building the real system closure and inspecting the generated files and units, without switching. Use after editing any .nix file here, to prove a config change produces the intended file/unit, or to find which module owns a feature (see features/README.md).
---

# Verify the nixos-config flake

The "app" is a NixOS system (`nixosConfigurations.nixos`) with home-manager embedded as a NixOS module for user `moka`. A change is proven when the **built** artifact, meaning the file in `~`, the systemd unit, or the package in the closure, shows the intended difference from the **live** one. Nothing here switches, activates, or restarts anything.

Start at [features/README.md](features/README.md). It maps every feature to the file that owns it, and it's also the quickest way around this repo.

All commands run from the repo root through one helper:

```bash
V=.claude/skills/verify/scripts/verify
$V            # usage
```

## Launch

There is no server. "Launch" means building the closure. It takes about 25s when cached and longer after a `flake.lock` bump.

```bash
$V build
```

Ready means it prints `run:`, `toplevel:`, `home:` and a `status:` line:

- `identical to running system`: your edits change nothing. This is wrong if you expected a change.
- `differs from running system`: expected after an edit. The closure diff follows. It is empty for config-only edits, because only package versions show up there.

Teardown: none. Built store paths aren't GC roots and get collected by the weekly `nix.gc`.

## Doctor

Run it first, and again whenever an eval or build fails strangely:

```bash
$V doctor
```

It checks the repo root, host name, nix version, the current system path, and untracked files, then evaluates the toplevel drvPath. `eval: ok` means the config evaluates. A `WARN untracked` list matters: **flakes only see git-tracked files.** A new file a module references fails with `path ... does not exist`, and a new file inside a directory the config sources, such as `pi-extensions/optchat-memory/`, is silently left out of the build. Fix it with `git add -N <file>`, which marks the file without staging its content.

## Drive

After `$V build`, every command reads that run:

| Goal | Command |
|---|---|
| See a generated home file | `$V file .config/hypr/hyprland.lua` |
| Prove an edit changes the live file | `$V diff-live .pi/agent/settings.json` |
| List generated files under a dir | `$V ls .config/systemd/user` |
| Read any evaluated option | `$V eval home-manager.users.moka.programs.opencode.settings` |
| Read a NixOS option | `$V eval services.pipewire.extraConfig` |
| Validate Hyprland config | `$V hypr-check` (runs the built Hyprland's `--verify-config`; exit 1 on errors) |
| Check formatting | `nix fmt -- --check <file.nix>` (alejandra) |

Paths for `file`/`diff-live`/`ls` are relative to `$HOME`. User systemd units live at `.config/systemd/user/<name>.service|.timer`. Hermes profile files (`services.hermes-agent.hermesHomeFiles`) don't appear in home files. Read them with `$V eval home-manager.users.moka.services.hermes-agent.hermesHomeFiles`, or build one attribute.

## Evidence

Each `build` creates `~/.local/state/nixos-config-verify/<YYYYMMDD-HHMMSS>/` and points `latest` at it. Print it with `$V run`. Every later command writes its output there too:

- `git-head.txt`, `git-status.txt`, `git-diff.patch`: the source state that was built
- `toplevel.path`, `home-files.path`, `closure-diff.txt`, `build.log`
- `file_<path>.txt`, `diff-live_<path>.patch`, `eval_<attr>.json`, `hypr-check.txt`

Proof standard:

- Show the **diff against live** (`diff-live`) or the evaluated option value, not just "it built". A successful build only proves the Nix is valid.
- For a unit or timer, show the built unit file with the expected `ExecStart`/`OnCalendar`.
- For a Hyprland edit, also pass `hypr-check`.
- Behavior that only exists after activation, like a keybind firing, a service running, or a timer firing, is out of reach without switching. Report it as **not verified: needs `sudo nixos-rebuild switch --flake .#nixos`** and let the user switch. Never run `switch`, `boot`, `test`, `dry-activate`, `home-manager switch`, or the `update` zsh alias yourself.
- Never `systemctl --user start` the hermes units to "test" them. They call paid/free model APIs, write to the user's vault, and post to Discord.

## Cleanup

Nothing to stop. Remove only scratch you made yourself, such as a scratch copy of the repo. **Keep** `~/.local/state/nixos-config-verify/`, since that is where the proof lives. Never `nix-collect-garbage` or delete generations.

To prove a hypothetical edit without touching the user's working tree, which they may be editing concurrently, copy the repo to scratch (`cp -a`), edit there, and run that copy's `scripts/verify` with `VERIFY_OUT=<scratch>-evidence`. The helper builds the repo it lives in.

## Isolation

Builds are safe to run concurrently. The `latest` symlink is per `VERIFY_OUT`, so parallel agents should each set their own `VERIFY_OUT`.
