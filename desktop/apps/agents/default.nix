{
  pkgs,
  lib,
  config,
  ...
}: {
  imports = [
    ./codex.nix
    ./opencode.nix
    ./hermes-agent.nix
    ./agents-md.nix
  ];
}
