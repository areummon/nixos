{
  pkgs,
  lib,
  config,
  ...
}: {
  programs.hermes-agent.enable = true;

  services.hermes-agent = {
    enable = true;
    gateway.enable = true;
    environmentFiles = [
      "${config.home.homeDirectory}/.secrets/openrouter.env"
      "${config.home.homeDirectory}/.secrets/discord.env"
    ];
    settings = {
      model.default = "claude-opus-5-5";
      model.provider = "anthropic";
      # One chat that never ends (hermes-plugins/optchat), next to the built-in MEMORY.md / USER.md.
      memory.provider = "optchat";
      memory.optchat.compactor_model = "claude-haiku-4-5-20251001";
      # The view (up to 128 KB) arrives as the memory prefetch. Above this cap Hermes swaps
      # a prefetch for a 1 KB preview (default 10,000 chars).
      hooks.output_spill.max_chars = 200000;
      terminal.backend = "local";
      # Keyless Parallel (PARALLEL_API_KEY upgrades it to paid). Both keys stay explicit:
      # unset, autodetect picks openai-native from the openai-codex login, which can't
      # serve client-side search, and keyless Firecrawl answers 403. The activation
      # merge never deletes keys, so naming both also overrides the stale firecrawl one.
      web = {
        search_backend = "parallel";
        extract_backend = "parallel";
      };
      discord = {
        require_mention = true;
        auto_thread = true;
        reactions = true;
        history_backfill = true;
      };
      approvals = {
        mode = "smart";
        cron_mode = "deny";
        single_query_mode = "deny";
        unattended_mode = "deny";
      };
      security = {
        redact_secrets = true;
        tirith_enabled = true;
        # Nix supplies the runtime tools. A lazy download lands generic-linux binaries
        # NixOS can't exec, and its ~/.hermes/tools/facts.json makes the startup check
        # demand pm copies of node/npm/ffmpeg/ripgrep ("install out of sync").
        allow_lazy_installs = false;
      };
      privacy.redact_pii = true;
      fallback_providers = [
        {
          provider = "anthropic";
          model = "claude-sonnet-5-5";
        }
      ];
    };
  };

  # Not services.hermes-agent.extraPlugins: it links plugins as nix-managed-<name>, and a
  # memory provider's directory name is its memory.provider name.
  home.file."${config.services.hermes-agent.hermesHome}/plugins/optchat".source = ./hermes-plugins/optchat;

  systemd.user.services.hermes-agent.Service = {
    Environment = lib.mkForce [
      "HERMES_HOME=${config.home.homeDirectory}/.hermes"
      "HERMES_MANAGED=home-manager"
      "OBSIDIAN_VAULT_PATH=${config.home.homeDirectory}/Documents/study_vault"
      "PATH=/run/current-system/sw/bin:/etc/profiles/per-user/${config.home.username}/bin:/run/wrappers/bin"
    ];
    PrivateTmp = true;
    Delegate = true;
    ProtectSystem = "full";
    ProtectKernelTunables = true;
    ProtectKernelModules = true;
    ProtectKernelLogs = true;
    ProtectControlGroups = true;
    ProtectHostname = true;
    LockPersonality = true;
    RestrictAddressFamilies = ["AF_UNIX" "AF_INET" "AF_INET6"];
  };
}
