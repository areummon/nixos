{
  description = "My nix flake configuration to manage the system";

  inputs = {
    # Base package set and NixOS modules
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    # pkgs.stable: packages that break on unstable (fcitx5)
    nixpkgs-stable.url = "github:NixOS/nixpkgs/nixos-26.05";
    home-manager = {
      url = "github:nix-community/home-manager"; # master tracks nixos-unstable
      inputs.nixpkgs.follows = "nixpkgs";
    };
    hyprland.url = "github:hyprwm/Hyprland";
    # Agent CLIs, tested against its own pinned nixpkgs-unstable; no follows so cache.numtide.com hits.
    llm-agents.url = "github:numtide/llm-agents.nix";
    # Home-manager module only; the packages come from llm-agents
    hermes-agent.url = "github:NousResearch/hermes-agent";
  };

  outputs = {
    self,
    nixpkgs,
    ...
  } @ inputs: let
    inherit (self) outputs;
    system = "x86_64-linux";
  in {
    # `nix fmt`
    formatter.${system} = nixpkgs.legacyPackages.${system}.alejandra;
    # pkgs.stable and pkgs.llm-agents
    overlays = import ./overlays {inherit inputs;};

    nixosConfigurations.nixos = nixpkgs.lib.nixosSystem {
      specialArgs = {inherit inputs outputs;};
      modules = [./nixos/configuration.nix];
    };
  };
}
