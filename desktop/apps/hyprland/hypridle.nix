{
  pkgs,
  lib,
  config,
  ...
}: {
  services.hypridle = {
    enable = true;
    package = pkgs.hypridle;
    settings = {
      general = {
        lock_cmd = "pidof hyprlock || hyprlock";
        before_sleep_cmd = "loginctl lock-session";
        after_sleep_cmd = "hyprctl dispatch dpms on";
      };
      listener = [
        {
          #2.5 mins
          timeout = 150;
          on-timeout = "brightnessctl -s set 10";
          on-resume = "brightnessctl -r";
        }
        {
          # 5 mins
          timeout = 300;
          on-timeout = "loginctl lock-session";
        }
        {
          # 5.5 mins
          timeout = 330;
          on-timeout = "hyprctl dispatch dpms off";
          on-resume = "hyprctl dispatch dpms on";
        }
        {
          # 30 mins
          timeout = 1800;
          on-timeout = "systemctl suspend";
        }
      ];
    };
  };
}
