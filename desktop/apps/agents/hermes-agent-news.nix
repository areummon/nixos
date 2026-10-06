{
  pkgs,
  lib,
  config,
  ...
}: {
  services.hermes-agent.hermesHomeFiles = {
    "profiles/news/config.yaml" = (pkgs.formats.yaml {}).generate "hermes-news-config.yaml" {
      model.default = "meituan/longcat-2.0:free";
      model.provider = "nous";
      memory = {
        provider = "";
        memory_enabled = false;
        user_profile_enabled = false;
      };
      fallback_providers = [
        {
          provider = "nous";
          model = "inclusionai/ling-3.0-flash-fin:free";
        }
      ];
      auxiliary.free_only = true;
      terminal = {
        backend = "docker";
        cwd = "/vault/Tech News";
        docker_volumes = [
          "${config.home.homeDirectory}/Documents/career_vault/Tech News:/vault/Tech News"
        ];
        docker_mount_cwd_to_workspace = false;
        docker_forward_env = [];
        docker_network = true;
        docker_run_as_host_user = true;
        docker_env.OBSIDIAN_VAULT_PATH = "/vault";
        container_persistent = false;
        container_cpu = 2;
        container_memory = 4096;
        container_disk = 20480;
        docker_extra_args = ["--read-only"];
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
    };
    "profiles/news/SOUL.md" = ./hermes-news-soul.md;
  };

  home.activation.hermesNewsProfileEnv = lib.hm.dag.entryAfter ["writeBoundary" "linkGeneration"] ''
    if [ -f "${config.home.homeDirectory}/.secrets/news-profile.env" ]; then
      $DRY_RUN_CMD install -m 0600 -D \
        "${config.home.homeDirectory}/.secrets/news-profile.env" \
        "${config.home.homeDirectory}/.hermes/profiles/news/.env"
    else
      echo "hermes-agent: ~/.secrets/news-profile.env is missing; the 'news' profile has no credentials yet" >&2
    fi
  '';

  systemd.user.services.hermes-news-digest = {
    Unit = {
      Description = "Hermes verified daily tech-news digest";
      After = ["network-online.target"];
      Wants = ["network-online.target"];
      ConditionPathExists = "${config.home.homeDirectory}/.hermes/profiles/news/.env";
    };
    Service = {
      Type = "oneshot";
      Environment = [
        "HERMES_HOME=${config.home.homeDirectory}/.hermes"
        "PATH=/run/current-system/sw/bin:/etc/profiles/per-user/${config.home.username}/bin:/run/wrappers/bin"
      ];
      EnvironmentFile = "${config.home.homeDirectory}/.hermes/profiles/news/.env";
      ExecStart = pkgs.writeShellScript "hermes-news-digest" ''
        set -eu
        report=$(mktemp)
        trap 'rm -f "$report"' EXIT
        hermes -p news chat -Q --toolsets web,file -q \
          "Run the daily verified technology-news digest. Read /vault/Tech News/Ledger.md before researching. Cover only important developments from the last 24 hours across AI; CS and systems (theory, compilers, kernels, runtimes, databases, and major open source); and computer/phone hardware. Use web search only to discover candidates, then fetch and verify every source you cite. Require a primary source whenever available, such as an official company or government announcement, research paper, standards body, regulator filing, or project release. For reports without a primary source, corroborate the claim with at least two independent reputable sources. Check publication date, author or organization, and whether the source directly supports the claim. Never publish a rumor, prediction, social-media claim, copied aggregator item, or single-source report that cannot be independently verified. Prefer primary sources and reputable reporting; reject stale items, paywalls, and minor routine updates. Deduplicate by stable URL and event against the ledger. Write the final digest to /vault/Tech News/Digests/YYYY-MM-DD.md and append each reported item to /vault/Tech News/Ledger.md with date, headline, key, source, and URL. Never include personal context. If no item passes verification, do not change the ledger or create a digest and return exactly [SILENT]. Otherwise return only a concise Discord-ready digest with verified links." > "$report"
        if ! grep -qx '\[SILENT\]' "$report" && [ -s "$report" ]; then
          hermes -p news send --to 'discord:1549641424373288960' --file "$report" --quiet
        fi
      '';
      Delegate = true;
    };
  };

  systemd.user.timers.hermes-news-digest = {
    Unit = {
      Description = "Run the verified tech-news digest daily";
    };
    Timer = {
      OnCalendar = "*-*-* 09:30:00";
      Persistent = true;
      RandomizedDelaySec = "5m";
      Unit = "hermes-news-digest.service";
    };
    Install = {
      WantedBy = ["timers.target"];
    };
  };
}
