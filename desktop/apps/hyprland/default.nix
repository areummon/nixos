{
  pkgs,
  lib,
  config,
  ...
}: {
  imports = [
    ./hyprland.nix
    ./hyprpaper.nix
    ./hypridle.nix
    ./hyprlock.nix
    ./hyprsunset.nix
    ./session.nix
  ];
}
