{
  pkgs,
  lib,
  config,
  ...
}: {
  imports = [
    ./codex.nix
    ./opencode.nix
    ./pi.nix
    ./hermes-agent-local.nix
    # Paused Oct '26; re-add to re-enable the news/jobs workers and their timers.
    # ./hermes-agent-news.nix
    # ./hermes-agent-jobs.nix
    ./agents-md.nix
  ];
}
