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
      "${config.home.homeDirectory}/.secrets/signal.env"
      "${config.home.homeDirectory}/.secrets/discord.env"
    ];
    settings = {
      model.default = "gpt-5.6-luna";
      model.provider = "openai-codex";
      memory.provider = "honcho";
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
          model = "gpt-5.6-sol";
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
  # The generated service uses a deliberately small PATH. Include the
  # system and user profiles so Nix, direnv, and development tools are visible.
  systemd.user.services.hermes-agent.Service = {
    Environment = lib.mkForce [
      "HERMES_HOME=${config.home.homeDirectory}/.hermes"
      "HERMES_MANAGED=home-manager"
      "OBSIDIAN_VAULT_PATH=${config.home.homeDirectory}/Documents/study_vault"
      "PATH=/run/current-system/sw/bin:/etc/profiles/per-user/${config.home.username}/bin:/run/wrappers/bin"
    ];
    NoNewPrivileges = true;
    PrivateTmp = true;
    ProtectSystem = "full";
    ProtectKernelTunables = true;
    ProtectKernelModules = true;
    ProtectKernelLogs = true;
    ProtectControlGroups = true;
    ProtectHostname = true;
    RestrictSUIDSGID = true;
    LockPersonality = true;
    CapabilityBoundingSet = [];
    RestrictAddressFamilies = ["AF_UNIX" "AF_INET" "AF_INET6"];
  };

  # signal-cli daemon in HTTP mode for the Hermes Signal gateway
  systemd.user.services.signal-cli-daemon = {
    Unit = {
      Description = "signal-cli daemon (HTTP mode) for Hermes gateway";
      After = ["network-online.target"];
    };
    Service = {
      ExecStart = "${pkgs.unstable.signal-cli}/bin/signal-cli --config %h/.local/share/signal-cli daemon --http 127.0.0.1:8080";
      EnvironmentFile = "${config.home.homeDirectory}/.secrets/signal.env";
      Restart = "on-failure";
      RestartSec = 10;
      NoNewPrivileges = true;
      PrivateTmp = true;
      PrivateDevices = true;
      ProtectSystem = "strict";
      ProtectHome = "read-only";
      ReadWritePaths = ["%h/.local/share/signal-cli"];
      ProtectKernelTunables = true;
      ProtectKernelModules = true;
      ProtectKernelLogs = true;
      ProtectControlGroups = true;
      ProtectHostname = true;
      RestrictSUIDSGID = true;
      LockPersonality = true;
      CapabilityBoundingSet = [];
    };
    Install = {WantedBy = ["default.target"];};
  };
}
