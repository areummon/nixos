{pkgs, ...}: let
  # Electron only auto-detects the keyring on GNOME/KDE; on Hyprland it falls
  # back to the unencrypted "basic" store, so point it at gnome-keyring.
  claude-desktop = pkgs.symlinkJoin {
    name = "claude-desktop";
    paths = [pkgs.llm-agents.claude-desktop];
    nativeBuildInputs = [pkgs.makeWrapper];
    postBuild = ''
      wrapProgram $out/bin/claude-desktop --add-flags "--password-store=gnome-libsecret"
    '';
  };
in {
  home.packages = [
    pkgs.llm-agents.claude-code
    claude-desktop
  ];
}
