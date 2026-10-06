{
  pkgs,
  lib,
  config,
  ...
}: let
  # Same source as home.packages (unstable) — two different Papirus versions
  # in the same profile make buildEnv fail with conflicting subpaths.
  papirus = pkgs.unstable.papirus-icon-theme;
  # McMojave isn't packaged in nixpkgs; it's a hyprcursor theme installed by
  # hand in ~/.local/share/icons/McMojave (no xcursor files).
  cursor = {
    name = "McMojave";
    size = 40;
  };
in {
  dconf.settings = {
    "org/gnome/desktop/interface" = {
      color-scheme = "prefer-dark";
      gtk-theme = "adw-gtk3-dark";
      icon-theme = "Papirus-Dark";
      cursor-theme = cursor.name;
      cursor-size = cursor.size;
    };
  };

  # Read by Hyprland, XWayland and GTK at session start (replaces hyprctl setcursor)
  home.sessionVariables = {
    HYPRCURSOR_THEME = cursor.name;
    HYPRCURSOR_SIZE = toString cursor.size;
    XCURSOR_THEME = cursor.name;
    XCURSOR_SIZE = toString cursor.size;
  };

  # GTK4/libadwaita apps follow colorScheme + dconf color-scheme; forcing the
  # adw-gtk3 theme onto GTK4 can break them, so only GTK3 gets a theme.
  gtk = {
    enable = true;
    colorScheme = "dark";
    theme = {
      name = "adw-gtk3-dark";
      package = pkgs.adw-gtk3;
    };
    # stateVersion < 26.05 would otherwise inherit gtk.theme here
    gtk4.theme = null;
    iconTheme = {
      name = "Papirus-Dark";
      package = papirus;
    };
    cursorTheme = cursor;
  };

  qt = {
    enable = true;
    style = {
      name = "adwaita-dark";
      package = with pkgs; [
        adwaita-qt
        adwaita-qt6
      ];
    };
    platformTheme.name = "adwaita";
  };
}
