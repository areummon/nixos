{
  pkgs,
  lib,
  config,
  ...
}: {
  programs.mpv = {
    enable = true;
    package = pkgs.mpv;
    config = {
      hdr-compute-peak = "no";
      tone-mapping = "bt.2390";
      target-prim = "bt.709";
      target-trc = "bt.1886";
      video-output-levels = "full";
    };
  };
}
