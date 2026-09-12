{pkgs, ...}: {
  home.packages = [
    pkgs.unstable.codex
  ];

  # Dedicated Codex profile for delegating to a networked OpenCode subprocess.
  # The normal Codex profile remains network-disabled; use the codex-opencode
  # shell alias to select this profile.
  home.file.".codex/opencode-delegation.config.toml".text = ''
    sandbox_mode = "workspace-write"
    approval_policy = "on-request"
    allow_login_shell = false

    [sandbox_workspace_write]
    network_access = true

    [features.network_proxy]
    enabled = true
    domains = {
      "openrouter.ai" = "allow",
      "api.openrouter.ai" = "allow"
    }
  '';
}
