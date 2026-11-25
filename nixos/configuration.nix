{
  inputs,
  outputs,
  config,
  pkgs,
  ...
}: {
  imports = [
    ./hardware-configuration.nix
    inputs.home-manager.nixosModules.home-manager
  ];

  nixpkgs = {
    overlays = [
      outputs.overlays.stable-packages
      outputs.overlays.llm-agents
    ];
    config.allowUnfree = true;
  };

  nix = {
    settings = {
      experimental-features = ["nix-command" "flakes"];
      flake-registry = "";
      # Workaround for https://github.com/NixOS/nix/issues/9574
      nix-path = config.nix.nixPath;

      substituters = [
        "https://cache.nixos.org"
        "https://hyprland.cachix.org"
        "https://nix-community.cachix.org"
        "https://cache.numtide.com"
      ];
      trusted-public-keys = [
        "cache.nixos.org-1:6NCHdD59X431o0gWypbMrAURkbJ16ZPMQFGspcDShjY="
        "hyprland.cachix.org-1:a7pgxzMz7+chwVL3/pzj6jIBMioiJM7ypFP8PwtkuGc="
        "nix-community.cachix.org-1:mB9FSh9qf2dCimDSUo8Zy7bkq5CX+/rkCWyvRCYg3Fs="
        "niks3.numtide.com-1:DTx8wZduET09hRmMtKdQDxNNthLQETkc/yaX7M4qK0g="
      ];
    };
    channel.enable = false;

    # Weekly garbage collection. The age must be in days: nix-collect-garbage
    # rejects "1w" and the whole run fails.
    gc = {
      automatic = true;
      dates = "weekly";
      options = "--delete-older-than 7d";
    };

    settings.auto-optimise-store = true;
  };

  boot.loader.systemd-boot.enable = true;
  boot.loader.efi.canTouchEfiVariables = true;
  boot.loader.systemd-boot.configurationLimit = 10;

  boot.initrd.luks.devices."luks-2a23b25c-f966-49a7-bd0b-fd56274e81f7".device = "/dev/disk/by-uuid/2a23b25c-f966-49a7-bd0b-fd56274e81f7";

  networking = {
    hostName = "nixos";
    networkmanager = {
      enable = true;
      insertNameservers = ["1.1.1.1" "8.8.8.8"];
      plugins = [
        pkgs.networkmanager-openvpn
      ];
    };
    # ShotDrop: allow LocalSend UDP multicast discovery replies (no open TCP ports)
    firewall = {
      allowedUDPPorts = [53317];
    };
  };

  hardware.bluetooth = {
    enable = true;
    powerOnBoot = true;
  };

  time.timeZone = "America/Mexico_City";

  i18n.defaultLocale = "en_US.UTF-8";

  i18n.inputMethod = {
    type = "fcitx5";
    enable = true;
    fcitx5.addons = with pkgs.stable; [
      fcitx5-mozc
      fcitx5-hangul
      fcitx5-gtk
    ];
    fcitx5.waylandFrontend = true;
  };
  services.xserver.desktopManager.runXdgAutostartIfNone = true;

  services.xserver.xkb = {
    layout = "us";
    variant = "";
  };

  users.users.moka = {
    isNormalUser = true;
    description = "moka";
    extraGroups = ["networkmanager" "wheel"];
    shell = config.programs.zsh.package;
    # Keeps the user manager, and so the Hermes gateway, running without a login
    linger = true;
  };
  programs.zsh.enable = true;

  environment.systemPackages = with pkgs; [
    git
    vim
    wget
    nautilus
    distrobox
  ];

  services.fwupd.enable = true;

  programs.hyprland = {
    enable = true;
    withUWSM = true;
    package = inputs.hyprland.packages.${pkgs.stdenv.hostPlatform.system}.hyprland;
    portalPackage = inputs.hyprland.packages.${pkgs.stdenv.hostPlatform.system}.xdg-desktop-portal-hyprland;
  };
  home-manager = {
    useGlobalPkgs = true;
    useUserPackages = true;
    extraSpecialArgs = {inherit inputs outputs;};
    users.moka = import ../home-manager/home.nix;
  };
  # Required with useUserPackages so the HM-declared xdg-desktop-portal
  # definitions (and portal-provided .desktop files) get linked into the
  # system environment for the portal broker to find.
  environment.pathsToLink = [
    "/share/xdg-desktop-portal"
    "/share/applications"
  ];

  # Systemd configuration to turn off led of F4
  systemd.services.configure-sound-leds = rec {
    wantedBy = ["sound.target"];
    after = wantedBy;
    serviceConfig.Type = "oneshot";
    # -w guard: don't fail the boot unit if the sysfs path doesn't exist
    # (e.g. kernel/codec changes).
    script = ''
      if [ -w /sys/class/sound/ctl-led/mic/mode ]; then
        echo off > /sys/class/sound/ctl-led/mic/mode
      fi
    '';
  };

  security.rtkit.enable = true;
  services.pipewire = {
    enable = true;
    alsa.enable = true;
    alsa.support32Bit = true;
    pulse.enable = true;
    extraConfig.pipewire."pipewire" = {
      "context.properties" = {
        "default.clock.quantum" = 2048;
        "default.clock.min-quantum" = 2048;
        "default.clock.max-quantum" = 2048;
      };
    };
  };

  # Desktop services: mounts/trash for nautilus, power profiles, battery info
  services.gvfs.enable = true;
  services.power-profiles-daemon.enable = true;
  services.upower.enable = true;

  # Secret storage for libsecret users (VS Code, Obsidian, Proton VPN),
  # unlocked with the login password on TTY login
  services.gnome.gnome-keyring.enable = true;
  security.pam.services.login.enableGnomeKeyring = true;

  # Weekly TRIM for the NVMe drive, and compressed RAM swap before disk swap
  services.fstrim.enable = true;
  zramSwap.enable = true;

  security.pam.services.hyprlock = {};

  services.flatpak.enable = true;
  fonts.packages = with pkgs; [
    noto-fonts-cjk-sans
    noto-fonts-cjk-serif
  ];

  # Gnome requirements
  programs.dconf.enable = true;

  # Maps capslock to escape when pressed and ctrl when held down
  services.interception-tools = let
    itools = pkgs.interception-tools;
    itools-caps = pkgs.stable.interception-tools-plugins.caps2esc;
  in {
    enable = true;
    plugins = [itools-caps];
    # requires explicit paths: https://github.com/NixOS/nixpkgs/issues/126681
    udevmonConfig = pkgs.lib.mkDefault ''
      - JOB: "${itools}/bin/intercept -g $DEVNODE | ${itools-caps}/bin/caps2esc -m 0 | ${itools}/bin/uinput -d $DEVNODE"
        DEVICE:
          EVENTS:
            EV_KEY: [KEY_CAPSLOCK, KEY_ESC]
    '';
  };

  virtualisation.podman = {
    enable = true;
    dockerCompat = true;
  };

  # This value determines the NixOS release from which the default
  # settings for stateful data, like file locations and database versions
  # on your system were taken. It‘s perfectly fine and recommended to leave
  # this value at the release version of the first install of this system.
  # Before changing this value read the documentation for this option
  # (e.g. man configuration.nix or on https://nixos.org/nixos/options.html).
  system.stateVersion = "24.11"; # Did you read the comment?
}
