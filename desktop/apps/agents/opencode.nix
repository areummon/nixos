{
  pkgs,
  lib,
  config,
  ...
}: let
  # Sandboxed opencode: bubblewrap with a private home and isolated IPC,
  # process, UTS, cgroup, capability, and device namespaces. The agent can
  # access only its own state/config directories and the current workspace.
  # Network remains available because OpenCode needs to call model APIs.
  #
  # Usage:  cd ~/some/project && opencode-sandboxed
  opencode-sandboxed = pkgs.writeShellScriptBin "opencode-sandboxed" ''
    exec ${pkgs.bubblewrap}/bin/bwrap \
      --die-with-parent \
      --new-session \
      --unshare-pid \
      --unshare-uts \
      --unshare-ipc \
      --unshare-cgroup-try \
      --cap-drop ALL \
      --clearenv \
      --ro-bind /nix/store /nix/store \
      --ro-bind /etc /etc \
      --dir /opt \
      --ro-bind /run/current-system/sw /opt/system-profile \
      --ro-bind /etc/profiles/per-user/${config.home.username} /opt/user-profile \
      --proc /proc \
      --dev /dev \
      --tmpfs /tmp \
      --tmpfs /run \
      --tmpfs "$HOME" \
      --dir "$HOME/.config" \
      --dir "$HOME/.local" \
      --dir "$HOME/.local/share" \
      --bind-try "$HOME/.config/opencode" "$HOME/.config/opencode" \
      --bind-try "$HOME/.local/share/opencode" "$HOME/.local/share/opencode" \
      --bind-try "$HOME/.cache/opencode" "$HOME/.cache/opencode" \
      --bind "$PWD" "$PWD" \
      --chdir "$PWD" \
      --setenv HOME "$HOME" \
      --setenv USER "${config.home.username}" \
      --setenv LOGNAME "${config.home.username}" \
      --setenv PATH "/opt/system-profile/bin:/opt/user-profile/bin:/run/wrappers/bin" \
      --setenv XDG_CONFIG_HOME "$HOME/.config" \
      --setenv XDG_DATA_HOME "$HOME/.local/share" \
      --setenv XDG_CACHE_HOME "$HOME/.cache" \
      ${pkgs.opencode}/bin/opencode "$@"
  '';
in {
  programs.opencode = {
    enable = true;
    package = pkgs.opencode;
    settings = {
      model = "openrouter/deepseek/deepseek-v4.1-flash";
      small_model = "openrouter/deepseek/deepseek-v4-flash-0731";
    };
  };

  home.packages = [
    opencode-sandboxed
  ];
}
