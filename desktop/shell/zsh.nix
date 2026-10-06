{
  pkgs,
  lib,
  config,
  ...
}: {
  programs.zsh = {
    enable = true;
    enableCompletion = true;
    autosuggestion.enable = true;
    syntaxHighlighting.enable = true;
    shellAliases = {
      update = "sudo nixos-rebuild switch";
      sd = "cd ~ && cd \$(fd --type d | fzf)";
    };
    history = {
      size = 10000;
      path = "${config.xdg.dataHome}/zsh/history";
    };
    # Login shell only: start Hyprland through uwsm on the first TTY login
    profileExtra = ''
      if uwsm check may-start && uwsm select; then
        exec systemd-cat -t uwsm_start uwsm start default
      fi
    '';
    initContent = lib.strings.concatStrings [
      # compinit itself is run by enableCompletion
      ''
        zstyle ':completion:*' matcher-list 'm:{a-z}={A-Za-z}'
      ''
      ''
        bindkey -v  # Enable vi mode
        bindkey "$key[Up]" history-beginning-search-backward
        bindkey "$key[Down]" history-beginning-search-forward
        bindkey '^E' end-of-line
      ''
      ''
        export KEYTIMEOUT=1  # Reduce mode switch delay
      ''
      # Load the OpenRouter key only into the commands that need it, instead
      # of exporting it to every process started from the shell
      ''
        _with_openrouter() {
          (
            [ -f ~/.secrets/openrouter.env ] && set -a && source ~/.secrets/openrouter.env && set +a
            exec "$@"
          )
        }
        opencode() { _with_openrouter opencode "$@" }
        codex-opencode() { _with_openrouter codex --profile opencode-delegation "$@" }
      ''
    ];
  };

  programs.fzf = {
    enable = true;
    package = pkgs.unstable.fzf;
    enableZshIntegration = true;
  };

  programs.eza = {
    enable = true;
    package = pkgs.unstable.eza;
    enableZshIntegration = true;
    icons = "auto";
    git = true;
  };

  programs.zoxide = {
    enable = true;
    package = pkgs.unstable.zoxide;
    enableZshIntegration = true;
  };
}
