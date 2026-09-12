{
  inputs,
  outputs,
  lib,
  config,
  pkgs,
  ...
}: {
  imports = [
    # If you want to use modules your own flake exports (from modules/home-manager): outputs.homeManagerModules.example
    # Or modules exported from other flakes (such as nix-colors):
    # inputs.nix-colors.homeManagerModules.default
    inputs.hyprland.homeManagerModules.default
    inputs.hermes-agent.homeManagerModules.default

    ../desktop
  ];

  home = {
    username = "moka";
    homeDirectory = "/home/moka";
  };

  home.packages = with pkgs.unstable; [
    anki
    signal-cli
    brightnessctl
    bluez-tools
    btop
    wl-clipboard
    # util
    zip
    xz
    unzip
    bat
    xdotool
    pstree
    rclone
    zathura
    sioyek
    hyprshot
    # flatpak
    libsecret
    # fonts
    font-awesome
    powerline-fonts
    powerline-symbols
    iosevka
    fira-code-symbols
    nerd-fonts.jetbrains-mono
    nerd-fonts.fira-code
    nerd-fonts.symbols-only
    nerd-fonts.meslo-lg
    nerd-fonts.commit-mono
    playerctl
    libnotify
    proton-vpn
  ];

  home.sessionVariables = {
    NIXOS_OZONE_WL = "1";
    HYPRSHOT_DIR = "${config.home.homeDirectory}/Pictures/Screenshots";
  };

  # NIX_XDG_DESKTOP_PORTAL_DIR to the user profile (home-manager issue
  # #7124), so the broker only sees portals declared in home-manager.
  # hyprland handles screenshot/screencast; gtk provides FileChooser etc.
  # (the dialogs flatpak apps use for nautilus browsing, gthumb, ...).
  xdg.portal = {
    enable = true;
    extraPortals = [pkgs.xdg-desktop-portal-gtk];
    config.hyprland.default = ["hyprland" "gtk"];
  };

  # Configuration for Flatpak
  home.sessionPath = [
    "$HOME/.local/share/flatpak/exports/bin"
  ];

  # Line for fonts to work
  fonts.fontconfig.enable = true;

  # Enable home-manager and git
  programs.home-manager.enable = true;

  # Nicely reload system units when changing configs
  systemd.user.startServices = "sd-switch";

  # Git configuration
  programs.git = {
    enable = true;
    settings = {
      user = {
        name = "moka";
        email = "areumm@proton.me";
      };
    };
  };

  # nix-direnv configuration for programming environments
  programs = {
    direnv = {
      enable = true;
      package = pkgs.unstable.direnv;
      enableBashIntegration = true;
      enableZshIntegration = true;
      nix-direnv.enable = true;
    };
    bash.enable = true;
  };

  # https://nixos.wiki/wiki/FAQ/When_do_I_update_stateVersion
  home.stateVersion = "24.11";
}
