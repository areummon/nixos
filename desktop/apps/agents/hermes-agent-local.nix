{
  pkgs,
  lib,
  config,
  ...
}: let
  # nixpkgs Chromium for agent-browser (its own download fails on NixOS).
  chromiumPath = "${pkgs.chromium}/bin/chromium";

  # Hermes comes prebuilt from llm-agents (cache.numtide.com); the hermes-agent
  # flake input only supplies the home-manager module. That module expects two
  # things of its own package that the llm-agents one lacks, bridged here.
  hermes = pkgs.llm-agents.hermes-agent;

  # 1. `hermesVenv`: a python3 that imports hermes_cli, used to stamp
  # config.yaml. The hermes wrapper exports the interpreter and source root.
  hermesVenv = pkgs.runCommand "hermes-venv" {} ''
    mkdir -p $out/bin
    eval "$(grep -E "^export HERMES_PYTHON(_SRC_ROOT)?=" ${hermes}/bin/hermes)"
    test -x "$HERMES_PYTHON" && test -d "$HERMES_PYTHON_SRC_ROOT"
    {
      echo "#!${pkgs.runtimeShell}"
      echo "PYTHONPATH=$HERMES_PYTHON_SRC_ROOT exec $HERMES_PYTHON \"\$@\""
    } > $out/bin/python3
    chmod +x $out/bin/python3
  '';
  hermesPackage = hermes.overrideAttrs (old: {
    passthru = old.passthru // {inherit hermesVenv;};
  });

  # 2. A desktop package that takes the launcher environment (HERMES_HOME of
  # the service) through `.override {extraEnv, extraRun}`.
  hermesDesktop = lib.makeOverridable (
    {
      extraEnv ? {},
      extraRun ? [],
    }:
      pkgs.symlinkJoin {
        inherit (pkgs.llm-agents.hermes-desktop) pname version;
        paths = [pkgs.llm-agents.hermes-desktop];
        nativeBuildInputs = [pkgs.makeWrapper];
        postBuild = ''
          wrapProgram $out/bin/hermes-desktop ${lib.escapeShellArgs (
            lib.concatLists (lib.mapAttrsToList (name: value: ["--set" name value]) extraEnv)
            ++ lib.concatMap (line: ["--run" line]) extraRun
          )}
        '';
      }
  ) {};
in {
  programs.hermes-agent = {
    enable = true;
    # Electron app; runs this same Hermes build against the service's HERMES_HOME.
    desktop = {
      enable = true;
      package = hermesDesktop;
    };
  };

  # Local browser automation for Hermes's browser_* tools.
  home.packages = [pkgs.agent-browser pkgs.chromium];
  home.sessionVariables.AGENT_BROWSER_EXECUTABLE_PATH = chromiumPath;

  services.hermes-agent = {
    enable = true;
    package = hermesPackage;
    gateway.enable = true;
    environmentFiles = [
      "${config.home.homeDirectory}/.secrets/openrouter.env"
      "${config.home.homeDirectory}/.secrets/discord.env"
    ];
    settings = {
      model.default = "claude-opus-5-5";
      model.provider = "anthropic";
      # One chat that never ends (hermes-plugins/optmem), next to the built-in MEMORY.md / USER.md.
      memory.provider = "optmem";
      memory.optmem.compactor_model = "claude-haiku-5-5";
      # The view (up to 128 KB) arrives as the memory prefetch. Above this cap Hermes swaps
      # a prefetch for a 1 KB preview (default 10,000 chars).
      hooks.output_spill.max_chars = 200000;
      terminal.backend = "local";
      # Nous Portal tools; "" = inherit web.backend ("nous" there fails).
      web = {
        backend = "nous";
        search_backend = "";
        extract_backend = "";
      };
      image_gen.provider = "nous";
      tts.provider = "nous";
      # Local agent-browser instead of paid Browser Use cloud/CLI.
      browser.cloud_provider = "local";
      browser.backend = "local";
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
  home.file."${config.services.hermes-agent.hermesHome}/plugins/optmem".source = ./hermes-plugins/optmem;

  systemd.user.services.hermes-agent.Service = {
    Environment = lib.mkForce [
      "HERMES_HOME=${config.home.homeDirectory}/.hermes"
      "HERMES_MANAGED=home-manager"
      "OBSIDIAN_VAULT_PATH=${config.home.homeDirectory}/Documents/study_vault"
      "AGENT_BROWSER_EXECUTABLE_PATH=${chromiumPath}"
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
