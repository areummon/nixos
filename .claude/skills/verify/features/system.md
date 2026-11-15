# System

The NixOS layer: systemd-boot with LUKS, flakes with binary caches and weekly GC, NetworkManager (with OpenVPN), bluetooth, PipeWire with a fixed 2048 quantum, fcitx5 (Mozc, Hangul), caps-to-escape/ctrl, flatpak, podman (docker-compatible), gnome-keyring, and zram. Home-manager runs as a NixOS module from here.

Owner: `nixos/configuration.nix`. Hardware and disks: `nixos/hardware-configuration.nix` (generated). Overlays: `overlays/default.nix`. Inputs and pins: `flake.nix`, `flake.lock`.

## Sub-features

- `nix-settings`: substituters, `auto-optimise-store`, `gc` weekly with `--delete-older-than 7d` (`1w` is rejected and fails the run), channels off.
- `boot`: systemd-boot, keeps 10 generations, two LUKS devices (one in `configuration.nix`, one in `hardware-configuration.nix`).
- `network`: NetworkManager with nameservers 1.1.1.1/8.8.8.8 and the openvpn plugin. Bluetooth is on at boot.
- `audio`: PipeWire with alsa/pulse and a quantum of 2048. `configure-sound-leds` turns off the mic LED when the sysfs path is writable.
- `input`: fcitx5 for Wayland (Mozc, Hangul, GTK addon), `us` X11 layout, interception-tools caps2esc (`caps2esc -m 0`).
- `virt`: podman (`dockerCompat`), distrobox.
- `desktop-services`: gvfs, power-profiles-daemon, upower, gnome-keyring with PAM, fwupd, flatpak, fstrim, zram ahead of the disk swap device from `hardware-configuration.nix`.
- `session`: the Hyprland NixOS module with the pinned package and portal, `withUWSM`, zsh as the login shell, and `linger = true` for moka, so user units like hermes run without a login.
- `inputs`: nixpkgs (nixos-unstable), nixpkgs-stable (26.05), home-manager master, hyprland, llm-agents (numtide/llm-agents.nix, no `follows`, served by cache.numtide.com), hermes-agent (module only; the Hermes packages come from `pkgs.llm-agents`).

## How to get to it (user POV)

- Everything takes effect after `sudo nixos-rebuild switch --flake .#nixos`. Boot and kernel changes need a reboot.

## Driving it with verify

Preconditions: `$V build` after the edit.

- **Registry.** Run `$V eval nix.registry builtins.attrNames`, which gives `["nixpkgs"]`.
- **Option value.** Run `$V eval services.pipewire.extraConfig.pipewire`, or any other option path such as `networking.networkmanager.insertNameservers`. The JSON holds the new value.
- **System package added.** Run `$V build`. The `status:` closure diff lists the package with `∅ → <version>`.
- **Input bump.** After `nix flake update <input>`, run `$V build`. The closure diff shows the version changes. Run `$V hypr-check` too when `hyprland` moved.
- **Systemd system unit.** Run `cat "$(cat $($V run)/toplevel.path)/etc/systemd/system/configure-sound-leds.service"`.
- **Activation (post-switch).** Run `systemctl status <unit>` and `nixos-version`. The user does this after switching.

## Gotchas

- `hardware-configuration.nix` is machine-generated, so don't hand-edit it. It holds the filesystems, the disk swap, and the second LUKS device. The first LUKS device is in `configuration.nix`.
- `system.stateVersion` and `home.stateVersion` are `24.11` on purpose. Never bump them as part of an upgrade.
- `flake-registry = ""` only turns off the global registry download. NixOS still pins `nixpkgs` in `/etc/nix/registry.json` to this system's nixos-unstable source, so `nixpkgs#foo` works and resolves to unstable. For the release, use `nix shell --inputs-from . nixpkgs-stable#foo`.
- `environment.pathsToLink` adds `/share/xdg-desktop-portal` and `/share/applications` (portal `.desktop` files). Both are required by the home-manager portal setup in `home.nix`. Removing it breaks the file chooser in flatpak apps.
- `$V eval services.pipewire.extraConfig` fails as a whole: nixpkgs made `extraConfig.client-rt` a removed option that throws when read. Evaluate the sub-key you edited (`.pipewire`, `.pipewire-pulse`, `.client`).
- `hermes-agent.url` follows upstream main and supplies only the home-manager module, so `nix flake update hermes-agent` moves the module while the Hermes version moves with `llm-agents`.
- `pkgs` is nixos-unstable, and `pkgs.stable` (26.05) comes from the overlay. Only fcitx5 (it breaks on unstable) and interception-tools are pinned to it. `fcitx5-with-addons` and `interception-tools` are swapped in the overlay because their modules take no package option, and the fcitx5 addons and the caps2esc plugin are named as `pkgs.stable.*` in `configuration.nix`. Mixing both sets for one package in one profile causes `buildEnv` conflicts.
