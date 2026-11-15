{
  pkgs,
  config,
  lib,
  ...
}: {
  services.hyprpaper = {
    enable = true;
    package = pkgs.hyprpaper;
    settings = {
      splash = false;
      wallpaper = [
        {
          monitor = "eDP-1";
          path = "${config.home.homeDirectory}/Pictures/wallpapers/greenleaves2.jpg";
        }
      ];
    };
  };
}
