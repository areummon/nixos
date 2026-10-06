{
  pkgs,
  lib,
  config,
  ...
}: let
  # macOS Tahoe-style lock screen, proportions measured from a Tahoe
  # screenshot and scaled to 1920x1200: date + large translucent clock at the
  # top, small avatar, name and password field at the bottom, battery in the
  # top-right corner. font_size is in points (1pt = 1.33px).
  font = "Inter";
  # Inter Display is cut for large sizes, like SF Pro Display
  displayFont = "Inter Display";
  white = alpha: "rgba(255, 255, 255, ${toString alpha})";
  # Very faint shadow so small white text survives bright wallpapers
  textShadow = {
    shadow_passes = 1;
    shadow_size = 2;
    shadow_color = "rgba(0, 0, 0, 0.20)";
  };
  battery = pkgs.writeShellScript "hyprlock-battery" ''
    bat=/sys/class/power_supply/BAT0
    cap=$(cat "$bat/capacity")
    case "$(cat "$bat/status")" in
      Charging) icon="󰂄" ;;
      *)
        icons=(󰂎 󰁺 󰁻 󰁼 󰁽 󰁾 󰁿 󰂀 󰂁 󰂂 󰁹)
        icon=''${icons[$((cap / 10))]}
        ;;
    esac
    echo "$cap%  $icon"
  '';
in {
  # Only used by the lock screen
  home.packages = [pkgs.unstable.inter];

  programs.hyprlock = {
    enable = true;
    package = pkgs.unstable.hyprlock;
    settings = {
      general = {
        screencopy_mode = 0;
      };

      # Wallpaper shown as-is, like macOS
      background = {
        path = "${config.home.homeDirectory}/Pictures/wallpapers/lockwallpaper1.jpg";
        outline_thickness = 0;
        blur_passes = 0;
        brightness = 0.95;
      };

      image = {
        path = "${config.home.homeDirectory}/Pictures/icons/icon2.1.jpg";
        size = 60;
        rounding = -1;
        border_size = 0;
        position = "0, 133";
        halign = "center";
        valign = "bottom";
      };

      label = [
        ({
            # Date: "Tue Jul 8"
            text = "cmd[update:60000] echo \"<span font_weight='600'>$(date +'%a %b %-d')</span>\"";
            color = white 0.62;
            font_size = 26;
            font_family = displayFont;
            position = "0, -107";
            halign = "center";
            valign = "top";
          }
          // textShadow)
        ({
            # Time: big, heavy and translucent so the wallpaper tints it,
            # like the Tahoe glass clock
            text = "cmd[update:1000] echo \"<span font_weight='700' letter_spacing='-2048'>$(date +'%-I:%M')</span>\"";
            color = white 0.6;
            font_size = 124;
            font_family = displayFont;
            position = "0, -123";
            halign = "center";
            valign = "top";
          }
          // textShadow)
        ({
            # User name under the avatar
            text = "<span font_weight='600'>moka</span>";
            color = white 0.95;
            font_size = 13;
            font_family = font;
            position = "0, 97";
            halign = "center";
            valign = "bottom";
          }
          // textShadow)
        ({
            # Battery, top-right corner
            text = "cmd[update:30000] ${battery}";
            color = white 0.9;
            font_size = 11;
            font_family = font;
            position = "-24, -12";
            halign = "right";
            valign = "top";
          }
          // textShadow)
      ];

      # Where macOS shows "Touch ID or Enter Password": a barely-there pill
      # whose placeholder reads like that hint
      input-field = {
        size = "190, 28";
        outline_thickness = 0;
        rounding = -1;
        outer_color = white 0.0;
        inner_color = white 0.12;
        font_color = white 1.0;
        font_family = font;
        dots_center = true;
        dots_size = 0.2;
        dots_spacing = 0.35;
        placeholder_text = "<span foreground='##ffffffd9' font_weight='500'>Enter Password</span>";
        fail_text = "<span foreground='##ffffffd9'>Incorrect password</span>";
        fade_on_empty = false;
        check_color = white 0.25;
        fail_color = "rgba(255, 69, 58, 0.45)";
        capslock_color = "rgba(255, 214, 10, 0.40)";
        position = "0, 63";
        halign = "center";
        valign = "bottom";
      };
    };
  };
}
