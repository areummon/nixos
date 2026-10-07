# System

The NixOS layer: systemd-boot with LUKS, flakes with binary caches and weekly GC, NetworkManager (with OpenVPN), bluetooth, PipeWire with a fixed 2048 quantum, fcitx5 (Mozc, Hangul), caps-to-escape/ctrl, flatpak, podman (docker-compatible), VirtualBox, gnome-keyring, and zram. Home-manager runs as a NixOS module from here.

Owner: `nixos/configuration.nix`. Hardware and disks: `nixos/hardware-configuration.nix` (generated). Overlays: `overlays/default.nix`. Inputs and pins: `flake.nix`, `flake.lock`.

## Sub-features

- `nix-settings`: substituters, `auto-optimise-store`, `gc` weekly with `--delete-older-than 1w`, channels off.
- `boot`: systemd-boot, keeps 10 generations, two LUKS devices (one in `configuration.nix`, one in `hardware-configuration.nix`).
- `network`: NetworkManager with nameservers 1.1.1.1/8.8.8.8 and the openvpn plugin. Bluetooth is on at boot.
- `audio`: PipeWire with alsa/pulse/jack and a quantum of 2048. `configure-sound-leds` turns off the mic LED when the sysfs path is writable.
- `input`: fcitx5 for Wayland (Mozc, Hangul, GTK addon), `us` X11 layout, interception-tools caps2esc (`caps2esc -m 0`).
- `virt`: podman (`dockerCompat`), VirtualBox host, distrobox.
- `desktop-services`: gvfs, power-profiles-daemon, upower, gnome-keyring with PAM, fwupd, flatpak, fstrim, zram ahead of the disk swap device from `hardware-configuration.nix`.
- `session`: the Hyprland NixOS module with the pinned package and portal, `withUWSM`, zsh as the login shell, and `linger = true` for moka, so user units like hermes run without a login.
- `inputs`: nixpkgs 26.05, unstable, home-manager release-26.05, hyprland, opencode, hermes-agent.

## How to get to it (user POV)

- Everything takes effect after `sudo nixos-rebuild switch --flake .#nixos`. Boot and kernel changes need a reboot.

## Driving it with verify

Preconditions: `$V build` after the edit.

- **Registry.** Run `$V eval nix.registry builtins.attrNames`, which gives `["nixpkgs"]`.
- **Option value.** Run `$V eval services.pipewire.extraConfig`, or any other option path such as `networking.networkmanager.insertNameservers`. The JSON holds the new value.
- **System package added.** Run `$V build`. The `status:` closure diff lists the package with `∅ → <version>`.
- **Input bump.** After `nix flake update <input>`, run `$V build`. The closure diff shows the version changes. Run `$V hypr-check` too when `hyprland` moved.
- **Systemd system unit.** Run `cat "$(cat $($V run)/toplevel.path)/etc/systemd/system/configure-sound-leds.service"`.
- **Activation (post-switch).** Run `systemctl status <unit>` and `nixos-version`. The user does this after switching.

## Gotchas

- `hardware-configuration.nix` is machine-generated, so don't hand-edit it. It holds the filesystems, the disk swap, and the second LUKS device. The first LUKS device is in `configuration.nix`.
- `system.stateVersion` and `home.stateVersion` are `24.11` on purpose. Never bump them as part of an upgrade.
- `flake-registry = ""` only turns off the global registry download. NixOS still pins `nixpkgs` in `/etc/nix/registry.json` to this system's 26.05 source, so `nixpkgs#foo` works and resolves to stable, not unstable. For unstable, use `nix shell --inputs-from . nixpkgs-unstable#foo`.
- `environment.pathsToLink` adds `/share/xdg-desktop-portal` and `/share/applications` (portal `.desktop` files). Both are required by the home-manager portal setup in `home.nix`. Removing it breaks the file chooser in flatpak apps.
- `pkgs` is 26.05 stable, and `pkgs.unstable` comes from the overlay. Mixing both for one package, such as Papirus, causes `buildEnv` conflicts (see the comment in `theme.nix`).
