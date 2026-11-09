{pkgs, ...}: {
  # herdr-app's wrapper already puts herdr-core on its PATH; listing herdr-core
  # too puts `hc` and `herdr-core` on the user's PATH.
  home.packages = with pkgs.llm-agents; [
    herdr-core
    herdr-app
  ];
}
