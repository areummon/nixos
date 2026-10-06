{
  config,
  pkgs,
  ...
}: let
  optchatMemoryDir = "${config.xdg.dataHome}/pi/optchat-memory/default";
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
          "*": "ask",
          "rm -rf *": "deny",
          "sudo *": "ask"
        },
        "external_directory": "ask"
      }
    }
  '';
in {
  # carderne/pi-sandbox needs bwrap, rg, and socat on PATH on Linux.
  home.packages = with pkgs.unstable; [pi-coding-agent nodejs bubblewrap ripgrep socat];

  # Preserve Pi's default coding tools and add its built-in codemode tool.
  home.file.".pi/agent/settings.json".text = builtins.toJSON {
    defaultProvider = "openai-codex";
    defaultModel = "gpt-6.1-sol";
    defaultThinkingLevel = "medium";
    defaultTools = ["+codemode"];
    packages = [
      "npm:pi-web-access@0.35.0"
      "npm:@gotgenes/pi-permission-system@39.0.3"
      "npm:pi-sandbox@0.7.0"
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
  home.file.".pi/agent/optchat-memory.json".text = builtins.toJSON {
    memoryDir = optchatMemoryDir;
    nodeBytes = 512;
    viewBytes = 128000;
    jobs = 8;
    tries = 5;
    retryMs = 10000;
    capChars = 30000;
    replaceContext = true;
    disableModelCompactor = false;
    # Cheap but competent compactor (spec §4.2/§10); the chat model stays your choice.
    compactorModel = "openai-codex/gpt-6-luna";
    compactorThinking = "medium";
    # Subagents (spawn/tell) run in-process with only these extensions. The
    # Permission and sandbox approval dialogs forward to the parent's UI.
    # Children fail closed unless sandbox startup succeeds, and expose only
    # read/zoom/date/codemode. Shell commands and edits stay with the parent.
    # These restrictions apply to OptChat spawn/tell, not pstack's subprocess
    # agent tool. Pstack children load global Pi packages and cancel UI dialogs.
    subagentTools = ["read" "zoom" "date" "codemode"];
    subagentExtensions = [
      "${config.home.homeDirectory}/.pi/agent/npm/node_modules/@gotgenes/pi-permission-system"
      "${config.home.homeDirectory}/.pi/agent/npm/node_modules/pi-sandbox"
    ];
  };

  home.sessionVariables = {
    PI_OPTCHAT_MEMORY_DIR = optchatMemoryDir;
    PI_OPTCHAT_NODE_BYTES = "512";
    PI_OPTCHAT_VIEW_BYTES = "128000";
    PI_OPTCHAT_JOBS = "8";
    PI_OPTCHAT_CAP_CHARS = "30000";
    # Full OptChat mode: system + durable memory view + latest user message.
    PI_OPTCHAT_REPLACE_CONTEXT = "1";
  };

  xdg.dataFile."pi/optchat-memory/default/.keep".text = "";
}
