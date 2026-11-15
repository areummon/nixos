{inputs, ...}: {
  # Agent CLIs from numtide/llm-agents.nix, as pkgs.llm-agents.<name>. Its own
  # packages (not overlays.shared-nixpkgs), so they match cache.numtide.com.
  llm-agents = final: _prev: {
    llm-agents = inputs.llm-agents.packages.${final.stdenv.hostPlatform.system};
  };

  # The 26.05 release as pkgs.stable
  stable-packages = final: prev: {
    stable = import inputs.nixpkgs-stable {
      system = final.stdenv.hostPlatform.system;
      config.allowUnfree = true;
    };
    # services.interception-tools runs udevmon from this attribute
    inherit (final.stable) interception-tools;
    # i18n.inputMethod builds fcitx5 from this attribute, and unstable fcitx5 breaks
    qt6Packages = prev.qt6Packages.overrideScope (_: _: {
      inherit (final.stable.qt6Packages) fcitx5-with-addons;
    });
  };
}
