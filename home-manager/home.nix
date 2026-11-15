{
  inputs,
  config,
  pkgs,
  ...
}: {
  imports = [
    inputs.hyprland.homeManagerModules.default
    inputs.hermes-agent.homeManagerModules.default

    ../desktop
  ];

  home = {
    username = "moka";
    homeDirectory = "/home/moka";
  };

  home.packages = with pkgs; [
    anki
    obsidian
    brightnessctl
    bluez-tools
    btop
    wl-clipboard
    # util
    zip
    xz
    unzip
    bat
    pstree
    rclone
    zathura
    sioyek
    # Built against the running compositor, not nixpkgs' Hyprland
    (hyprshot.override {hyprland = inputs.hyprland.packages.${pkgs.stdenv.hostPlatform.system}.hyprland;})
    # flatpak
    libsecret
    # fonts
    # iosevka and fira-code are kitty's fallback glyph fonts
    iosevka
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
    OBSIDIAN_VAULT_PATH = "${config.home.homeDirectory}/Documents/study_vault";
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

  home.sessionPath = [
    "$HOME/.local/share/flatpak/exports/bin"
  ];

  fonts.fontconfig.enable = true;

  programs.home-manager.enable = true;

  # Nicely reload system units when changing configs
  systemd.user.startServices = "sd-switch";

  programs.git = {
    enable = true;
    settings = {
      user = {
        name = "moka";
        email = "areumm@proton.me";
      };
    };
  };

  # GitHub CLI; also registers gh as git's credential helper for github.com
  programs.gh = {
    enable = true;
    package = pkgs.gh;
    gitCredentialHelper.enable = true;
  };

  programs = {
    direnv = {
      enable = true;
      package = pkgs.direnv;
      enableBashIntegration = true;
      enableZshIntegration = true;
      nix-direnv.enable = true;
    };
    bash.enable = true;
  };

  # https://nixos.wiki/wiki/FAQ/When_do_I_update_stateVersion
  home.stateVersion = "24.11";
}
