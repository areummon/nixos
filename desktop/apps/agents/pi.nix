{
  config,
  pkgs,
  lib,
  ...
}: let
  projectsBaseDir = "${config.xdg.dataHome}/pi/optchat-memory/projects";
  globalMemoryDir = "${config.xdg.dataHome}/pi/optchat-memory/global";
  # Keep JSON key order: the permission extension uses the last matching rule.
  permissionPolicy = ''
    {
      "permission": {
        "*": "allow",
        "path": {
          "*": "allow",
          "*.env": "deny",
          "*.env.*": "deny",
          "*.env.example": "allow",
          "~/.secrets/*": "deny",
          "~/.ssh/*": "deny",
          "~/.gnupg/*": "deny",
          "*.pem": "deny",
          "*.key": "deny",
          "*credentials.json": "deny"
        },
        "path_read": {
          "~/Documents/*": "ask",
          "~/Downloads/*": "ask",
          "~/Pictures/*": "ask",
          "~/Desktop/me/*": "ask"
        },
        "path_write": {
          "~/Documents/*": "ask",
          "~/Downloads/*": "ask",
          "~/Pictures/*": "ask",
          "~/Desktop/me/*": "ask"
        },
        "bash": {
          "*": "allow",
          "rm *": "ask",
          "rm -rf *": "deny",
          "mv *": "ask",
          "sudo *": "ask",
          "ssh *": "ask",
          "scp *": "ask",
          "rsync *": "ask",
          "curl *": "ask",
          "wget *": "ask",
          "git push*": "ask",
          "git commit*": "ask",
          "git reset*": "ask",
          "git clean*": "ask",
          "npm install*": "ask",
          "npm ci*": "ask",
          "pip install*": "ask",
          "systemctl *": "ask",
          "nixos-rebuild*": "deny",
          "home-manager switch*": "deny"
        },
        "external_directory": "ask"
      }
    }
  '';
in {
  # gondolin needs qemu_kvm; bwrap is kept for codex and opencode.
  home.packages = with pkgs.unstable; [pi-coding-agent nodejs bubblewrap ripgrep qemu_kvm];

  # Fix the MCP SDK advisory without downgrading Pi plugins. The Bash parser
  # uses bundled WASM, so its native install script stays explicitly denied.
  home.activation.piNpmPolicy = lib.hm.dag.entryAfter ["writeBoundary"] ''
    if [ -z "''${DRY_RUN_CMD:-}" ]; then
      export PATH="${pkgs.unstable.nodejs}/bin:$PATH"
      piNpmDir="${config.home.homeDirectory}/.pi/agent/npm"
      piPolicyChanged=$(node ${./pi-npm-policy.mjs} "$piNpmDir/package.json")
      if [ -n "$piPolicyChanged" ] || ! node -e 'process.exit(require(process.argv[1]).version === "1.32.1" ? 0 : 1)' "$piNpmDir/node_modules/@modelcontextprotocol/sdk/package.json" 2>/dev/null; then
        npm install --prefix "$piNpmDir" --ignore-scripts --legacy-peer-deps --no-audit --no-fund
      fi
      # pi-anthropic-oauth ignores Pi's onPayload hook, which drops OptChat's
      # view cache breakpoints, so every turn rewrites the whole view.
      oauthDir="$piNpmDir/node_modules/pi-anthropic-oauth"
      if [ -f "$oauthDir/src/stream.ts" ] && ! grep -q "options?.onPayload" "$oauthDir/src/stream.ts"; then
        if ${pkgs.patch}/bin/patch --dry-run -s -d "$oauthDir" -p1 < ${./pi-anthropic-oauth-onpayload.patch} >/dev/null; then
          ${pkgs.patch}/bin/patch -s -d "$oauthDir" -p1 < ${./pi-anthropic-oauth-onpayload.patch}
        else
          echo "pi: pi-anthropic-oauth onPayload patch no longer applies; OptChat view caching stays off" >&2
        fi
      fi
    fi
  '';

  # Preserve Pi's default coding tools and add its built-in codemode tool.
  home.file.".pi/agent/settings.json".text = builtins.toJSON {
    defaultProvider = "anthropic";
    defaultModel = "claude-opus-5-5";
    defaultThinkingLevel = "medium";
    defaultTools = ["+codemode"];
    # OptChat spec §8: no cache keep-alive pings; a long tool rewrites its entries.
    cacheWarming = "off";
    packages = [
      "npm:pi-web-access@0.35.0"
      "npm:@gotgenes/pi-permission-system@39.0.3"
      # Overrides the "anthropic" provider's transport and OAuth, retaining
      # Pi's model catalog. Chat and memory calls use this plugin's handler.
      "npm:pi-anthropic-oauth@0.3.1"
      # Maintained Pi port; pin the reviewed revision for reproducible updates.
      "git:github.com/michael-denyer/pstack-claude@4d4e159a77aec356ae6be320f281808aab0d25ca"
    ];
  };

  home.file.".pi/agent/extensions/pi-permission-system/config.json" = {
    force = true; # Replace the file created by `pi install` on the next activation.
    text = permissionPolicy;
  };

  # OptChat-style durable memory extension. Source is declarative; runtime data
  # stays mutable under XDG data, not in the Nix store.
  home.file.".pi/agent/extensions/optchat-memory".source = ./pi-extensions/optchat-memory;
  home.file.".pi/agent/extensions/gondolin".source = ./pi-extensions/gondolin;
  # Pi resolves an extension's bare imports from its symlink path, so this link
  # lets the gondolin extension find the package Pi's npm policy installs.
  home.file.".pi/agent/node_modules".source =
    config.lib.file.mkOutOfStoreSymlink "${config.home.homeDirectory}/.pi/agent/npm/node_modules";
  home.file.".pi/agent/optchat-memory.json".text = builtins.toJSON {
    # Each project's memory lives at <projectBaseDir>/<cwd under home, "/" as "--">.
    projectBaseDir = projectsBaseDir;
    inherit globalMemoryDir;
    nodeBytes = 512;
    viewBytes = 128000;
    jobs = 8;
    tries = 5;
    retryMs = 10000;
    capChars = 30000;
    replaceContext = true;
    disableModelCompactor = false;
    # Cheap but competent compactor (spec §4.2/§10); the chat model stays your choice.
    compactorModel = "anthropic/claude-sonnet-5-5";
    compactorThinking = "medium";
  };

  home.sessionVariables = {
    PI_OPTCHAT_NODE_BYTES = "512";
    PI_OPTCHAT_VIEW_BYTES = "128000";
    PI_OPTCHAT_JOBS = "8";
    PI_OPTCHAT_CAP_CHARS = "30000";
    # Full OptChat mode: system + durable memory view + latest user message.
    PI_OPTCHAT_REPLACE_CONTEXT = "1";
  };

  xdg.dataFile."pi/optchat-memory/projects/.keep".text = "";
  xdg.dataFile."pi/optchat-memory/global/.keep".text = "";
}
