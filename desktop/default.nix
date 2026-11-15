{
  # Home nix imports for programs like hyprland
  imports = [
    ./shell
    ./apps
    ./theme/theme.nix
  ];
}
