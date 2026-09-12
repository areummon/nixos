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
    ];
    settings = {
      model.default = "gpt-5.6-luna";
      model.provider = "openai-codex";
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
    };
    Install = {WantedBy = ["default.target"];};
  };

  # Skills are managed live in ~/.hermes/skills/ (real files, trusted dir).
  # The ./hermes-skills/ copies in this repo are historical snapshots only.
}
