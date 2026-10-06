{
  pkgs,
  lib,
  config,
  ...
}: {
  services.hermes-agent.hermesHomeFiles = {
    "profiles/jobs/config.yaml" = (pkgs.formats.yaml {}).generate "hermes-jobs-config.yaml" {
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
        cwd = "/vault/Job Search/Inbox";
        docker_volumes = [
          "${config.home.homeDirectory}/Documents/career_vault/Job Search/Inbox:/vault/Job Search/Inbox"
          # written by hermes-jobs-verification
          "${config.home.homeDirectory}/Documents/career_vault/Job Search/Active:/vault/Job Search/Active"
        ];
        docker_mount_cwd_to_workspace = false;
        docker_forward_env = [];
        docker_network = true;
        docker_run_as_host_user = true;
        docker_env.OBSIDIAN_VAULT_PATH = "/vault";
        container_persistent = false;
        container_cpu = 1;
        container_memory = 2048;
        container_disk = 10240;
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
    "profiles/jobs/SOUL.md" = ./hermes-jobs-soul.md;
  };

  home.activation.hermesJobsProfileEnv = lib.hm.dag.entryAfter ["writeBoundary" "linkGeneration"] ''
    if [ -f "${config.home.homeDirectory}/.secrets/jobs-profile.env" ]; then
      $DRY_RUN_CMD install -m 0600 -D \
        "${config.home.homeDirectory}/.secrets/jobs-profile.env" \
        "${config.home.homeDirectory}/.hermes/profiles/jobs/.env"
    else
      echo "hermes-agent: ~/.secrets/jobs-profile.env is missing; the 'jobs' profile has no provider credentials yet" >&2
    fi
  '';

  home.activation.hermesJobsInboxPermissions = lib.hm.dag.entryAfter ["writeBoundary"] ''
    $DRY_RUN_CMD mkdir -p "${config.home.homeDirectory}/Documents/career_vault/Job Search/Inbox"
    $DRY_RUN_CMD chmod 700 "${config.home.homeDirectory}/Documents/career_vault/Job Search/Inbox"
    $DRY_RUN_CMD mkdir -p "${config.home.homeDirectory}/Documents/career_vault/Job Search/Active"
  '';

  systemd.user.services.hermes-jobs-discovery = {
    Unit = {
      Description = "Hermes public job discovery";
      After = ["network-online.target"];
      Wants = ["network-online.target"];
      ConditionPathExists = "${config.home.homeDirectory}/.hermes/profiles/jobs/.env";
    };
    Service = {
      Type = "oneshot";
      Environment = [
        "HERMES_HOME=${config.home.homeDirectory}/.hermes"
        "PATH=/run/current-system/sw/bin:/etc/profiles/per-user/${config.home.username}/bin:/run/wrappers/bin"
      ];
      EnvironmentFile = "${config.home.homeDirectory}/.hermes/profiles/jobs/.env";
      ExecStart = pkgs.writeShellScript "hermes-jobs-discovery" ''
        exec hermes -p jobs chat --toolsets web,file -q \
          "Search for currently open software-engineering internships and new-graduate roles in Mexico, especially Mexico City and suitable remote-Mexico roles. Use only public, generic criteria. Fetch and verify the original careers page. Reject stale, closed, ambiguous, unrelated, or experience-requiring listings. Write only sanitized public records under /vault/Job Search/Inbox with company, role, location, type, experience requirement, URL, source, discovery date, and explicit closing date when available. Do not include or seek any applicant identity, university, GPA, CV, application history, recruiter data, or private context. Do not send messages. If no verified listing is found, write nothing."
      '';
      Delegate = true;
    };
  };

  systemd.user.timers.hermes-jobs-discovery = {
    Unit = {
      Description = "Run Hermes public job discovery daily";
    };
    Timer = {
      OnCalendar = "*-*-* 08:30:00";
      Persistent = true;
      RandomizedDelaySec = "15m";
      Unit = "hermes-jobs-discovery.service";
    };
    Install = {
      WantedBy = ["timers.target"];
    };
  };

  systemd.user.services.hermes-jobs-verification = {
    Unit = {
      Description = "Verify discovered jobs and notify Discord";
      After = ["network-online.target"];
      Wants = ["network-online.target"];
      ConditionPathExists = "${config.home.homeDirectory}/.hermes/profiles/jobs/.env";
    };
    Service = {
      Type = "oneshot";
      Environment = [
        "HERMES_HOME=${config.home.homeDirectory}/.hermes"
        "PATH=/run/current-system/sw/bin:/etc/profiles/per-user/${config.home.username}/bin:/run/wrappers/bin"
      ];
      EnvironmentFile = "${config.home.homeDirectory}/.hermes/profiles/jobs/.env";
      ExecStart = pkgs.writeShellScript "hermes-jobs-verification" ''
        set -eu
        report=$(mktemp)
        trap 'rm -f "$report"' EXIT
        hermes -p jobs chat -Q --toolsets web,file -q \
          "Review only public job records in /vault/Job Search/Inbox. For each record, fetch the original career page and confirm it is still open, located in Mexico City, Mexico, or appropriate remote-Mexico, and suitable for an internship or new-graduate applicant. Reject stale, duplicate, ambiguous, or experience-requiring listings. Do not read any private CV, application, recruiter, or personal files. Write verified public records to /vault/Job Search/Active/Verified.md, preserving stable public ids and URLs. Return a concise Discord-ready list of newly verified listings only; return an empty response when there are none." > "$report"
        if grep -q '[^[:space:]]' "$report"; then
          hermes -p jobs send --to 'discord:#job-search' --file "$report" --quiet
        fi
      '';
      Delegate = true;
    };
  };

  systemd.user.timers.hermes-jobs-verification = {
    Unit = {
      Description = "Verify discovered jobs and notify Discord daily";
    };
    Timer = {
      OnCalendar = "*-*-* 09:00:00";
      Persistent = true;
      RandomizedDelaySec = "15m";
      Unit = "hermes-jobs-verification.service";
    };
    Install = {
      WantedBy = ["timers.target"];
    };
  };
}
