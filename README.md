# NixOS Configuration

Personal NixOS and Home Manager configuration using flakes.

## Structure

```text
nixos/          System-level configuration
home-manager/   User-level configuration
desktop/        Hyprland, applications, shell, and theme
overlays/       pkgs.stable and pkgs.llm-agents
flake.nix      Flake inputs and system outputs
```

## Apply

```bash
sudo nixos-rebuild switch --flake .#nixos
```

## Check

```bash
nix flake check
nix build .#nixosConfigurations.nixos.config.system.build.toplevel --no-link
```

Keep secrets and machine-specific credentials out of the repository.
