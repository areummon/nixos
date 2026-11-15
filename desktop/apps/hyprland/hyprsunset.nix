{
  pkgs,
  lib,
  config,
  ...
}: {
  services.hyprsunset = {
    enable = true;
    package = pkgs.hyprsunset;
    settings = {
      max-gamma = 150;
      profile = [
        {
          time = "7:00";
          temperature = 3700;
        }
        {
          time = "9:00";
          identity = true;
        }
        {
          time = "16:00";
          temperature = 4500;
        }
        {
          time = "17:30";
          temperature = 3800;
        }
        {
          time = "18:00";
          temperature = 3200;
        }
        {
          time = "21:00";
          temperature = 2500;
        }
      ];
    };
  };
}
