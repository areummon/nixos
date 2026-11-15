{
  pkgs,
  lib,
  config,
  ...
}: {
  programs.fd = {
    enable = true;
    package = pkgs.fd;
    hidden = true;
    ignores = [
      ".cache/"
      ".firefox/"
      ".mozilla/"
      ".local/state/nix/profiles/"
      ".local/share/Trash/"
      ".var/"
      ".local/share/fonts/"
      ".local/share/flatpak/"
      ".git"
    ];
  };
}
