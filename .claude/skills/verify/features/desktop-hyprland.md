# Hyprland desktop

A Hyprland session (Lua config, started by uwsm from the first TTY login) with waybar, a wofi launcher and clipboard picker, swaync notifications, idle dimming, locking and suspend, a wallpaper, night-light, and a polkit agent. The session daemons are user units on `graphical-session.target`, not `exec-once`.

Owners: `desktop/apps/hyprland/hyprland.nix` (monitors, binds, rules, all in one `extraConfig` Lua string), `hypridle.nix`, `hyprlock.nix`, `hyprpaper.nix`, `hyprsunset.nix`, `session.nix` (polkit, cliphist, swaync and its CSS), `desktop/apps/waybar/`, `desktop/apps/wofi/wofi.nix`, `desktop/theme/theme.nix`. System side: `programs.hyprland` with `withUWSM` in `nixos/configuration.nix`.

## Sub-features

- `hypr-binds`: SUPER+Q kitty, +C close, +R wofi, +SHIFT+F firefox, +SHIFT+D Brave (flatpak), +L lock, +N notification center, +SHIFT+V clipboard, +SHIFT+A region screenshot, +M `uwsm stop`, +S/+O special workspaces `magic`/`protonvpn`, plus media and brightness keys.
- `hypr-idle`: dims at 150s, locks at 300s, DPMS off at 330s, suspends at 1800s (`hypridle.nix`).
- `hypr-lock`: hyprlock look plus a PAM entry (`security.pam.services.hyprlock`).
- `waybar`: left (user, workspaces, window), center (language, temp, mem, cpu, ...), right (mpris, audio, backlight, battery, ...). Click handlers in `waybar/scripts/*`.
- `session-daemons`: `hyprpolkitagent`, `cliphist`, `swaync`, `waybar`, `hypridle`, `hyprpaper`, `hyprsunset` units.
- `theme`: GTK dark, Papirus, McMojave hyprcursor (installed by hand in `~/.local/share/icons`).

## How to get to it (user POV)

- Log in on TTY1. zsh `profileExtra` runs `uwsm start default`.
- Press the binds above, click waybar modules, or wait for the idle timeouts.

## Driving it with verify

Preconditions: `$V build` after the edit.

- **Config parses.** Run `$V hypr-check`. It prints `config ok` and exits 0. A Lua error prints the line and exits 1.
- **Bind changed.** Run `$V diff-live .config/hypr/hyprland.lua`. The patch shows only the intended `hl.bind(...)` hunk.
- **Idle/lock/wallpaper.** Run `$V diff-live .config/hypr/hypridle.conf`. Use the same for `hyprlock.conf`, `hyprpaper.conf`, and `hyprsunset.conf`.
- **Waybar.** Run `$V diff-live .config/waybar/config` and `.config/waybar/style.css`. Scripts are under `.config/waybar/scripts/`.
- **Session units.** Run `$V file .config/systemd/user/swaync.service`. Then `$V ls .config/systemd/user/graphical-session.target.wants` lists each daemon.
- **Notification CSS.** Run `$V diff-live .config/swaync/style.css`.
- **Runtime (post-switch).** Run `hyprctl reload` or log in again, then `hyprctl binds` and `systemctl --user status waybar`. The user does this after switching.

## Gotchas

- Binds live inside a single Lua heredoc in `hyprland.nix`. Nix doesn't parse it, so a Lua error only shows in `hypr-check`.
- `wayland.windowManager.hyprland.systemd.enable = false`: uwsm owns the session. Don't add `exec-once` for daemons; add a home-manager service instead.
- The wallpaper path is `~/Pictures/wallpapers/greenleaves2.jpg`. That folder is personal, so don't open it without asking. A missing file builds fine.
- `wofi` blur and swaync glass come from Hyprland `layer_rule`s near the end of `hyprland.lua`.
