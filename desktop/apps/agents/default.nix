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
    ./hermes-agent-news.nix
    ./hermes-agent-jobs.nix
    ./agents-md.nix
  ];
}
