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
      gateway.multiplex_profiles = true;
      model.default = "gpt-6-luna";
      model.provider = "openai-codex";
      memory.provider = ""; # built-in memory only (MEMORY.md / USER.md)
      terminal.backend = "local";
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
      };
      privacy.redact_pii = true;
      fallback_providers = [
        {
          provider = "openai-codex";
          model = "gpt-6-sol";
        }
        {
          provider = "openrouter";
          model = "deepseek/deepseek-v4.1-flash";
        }
        {
          provider = "nous";
          model = "meituan/longcat-2.0:free";
        }
        {
          provider = "nous";
          model = "stepfun/step-3.7-flash:free";
        }
        {
          provider = "openrouter";
          model = "poolside/laguna-s-2.1:free";
        }
      ];
    };
  };

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
