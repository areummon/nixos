# nixos-config feature map

This map is the maintained source for finding where each feature of moka's NixOS + home-manager config lives, and for verifying a change to it. Find the feature below, open its file for the recipe, and drive it with `.claude/skills/verify/scripts/verify` (`$V`).

## Where things live

```text
flake.nix                       inputs (nixpkgs 26.05, unstable, home-manager, hyprland, opencode, hermes-agent)
                                -> nixosConfigurations.nixos
nixos/configuration.nix         system: boot, nix/gc, network, audio, input, users, virt, Hyprland+UWSM, zsh, HM wiring
nixos/hardware-configuration.nix   generated; don't edit by hand
home-manager/home.nix           user: packages, session vars, portals, git, direnv; imports hyprland + hermes HM modules and ../desktop
desktop/default.nix             -> shell/, apps/, theme/theme.nix
desktop/shell/                  zsh.nix (aliases, fzf, eza, zoxide), starship.nix
desktop/apps/default.nix        list of every app module; add new apps here
desktop/apps/agents/            AI agents: pi, hermes (local/news/jobs), opencode, codex, AGENTS.md
desktop/apps/hyprland/          hyprland.nix (Lua config: binds, rules), hypridle, hyprlock, hyprpaper, hyprsunset, session daemons
desktop/apps/waybar/            bar + scripts/ (backlight, bluetooth, network, power, volume)
desktop/apps/wofi/              launcher (SUPER+R) and clipboard picker
desktop/apps/{kitty,neovim,firefox,vscode,mpv,fd}/   single-app modules
desktop/theme/theme.nix         GTK/dconf dark theme, Papirus icons, McMojave cursor
overlays/default.nix            pkgs.unstable comes from here
pkgs/, modules/                 empty scaffolding (still wired as flake outputs and the additions overlay)
```

Package-set conventions: most packages come from `pkgs.unstable.*`, and system/home share one nixpkgs (`useGlobalPkgs`). Agents and the desktop are all home-manager modules, so their options live under `home-manager.users.moka.*` when you `$V eval`.

## Baseline preconditions

- Run from the repo root, with `V=.claude/skills/verify/scripts/verify`.
- `$V doctor` reports `eval: ok`. Resolve any `WARN untracked` file that a module references.
- `$V build` has run after your last edit. Every recipe reads the latest run.

## Driving conventions

- Prove a change with `$V diff-live <home path>` or `$V eval <option>`, not by reading the `.nix` source.
- A recipe step marked **post-switch** needs the user to run `sudo nixos-rebuild switch --flake .#nixos`. Report it as unverified rather than switching yourself.
- Never start hermes units, never switch, and never garbage-collect.

## Proof and skip reporting

- Name the feature file and the sub-feature ID with each piece of evidence.
- Evidence lives in `$($V run)`. Cite the file name there.
- Report a post-switch step you could not run as skipped, with the reason.

## Feature entry contract

Each feature file has an H1, one paragraph, then exactly these H2s in order: `Sub-features`, `How to get to it (user POV)`, `Driving it with verify`, `Gotchas`.

## Features

- [Pi coding agent](./agents-pi.md): Pi settings, permission policy, the gondolin VM sandbox and its host `nix` tool, the pstack sheet, and the optchat-memory extension.
- [Hermes agent](./agents-hermes.md): the Discord gateway service, the OptChat memory provider, the local browser, plus the paused `news` and `jobs` profiles.
- [Coding agents and global rules](./agents-coding.md): OpenCode (and `opencode-sandboxed`), Codex, `~/AGENTS.md`.
- [Hyprland desktop](./desktop-hyprland.md): keybinds, idle/lock, wallpaper, waybar, wofi, notifications, clipboard.
- [Shell and terminal](./shell-terminal.md): zsh, starship, kitty, neovim.
- [System](./system.md): boot, nix settings, networking, audio, input methods, caps2esc, virtualisation.
