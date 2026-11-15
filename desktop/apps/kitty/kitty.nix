{
  pkgs,
  lib,
  config,
  ...
}: {
  programs.kitty = {
    enable = true;
    package = pkgs.kitty;
    font.name = "MesloLG";

    themeFile = "everforest_dark_hard";

    settings = {
      background_opacity = "0.85";
      dynamic_background_opacity = "yes";
      font_size = 14.0;
    };
  };
}
