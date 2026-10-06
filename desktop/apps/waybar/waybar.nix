{
  config,
  pkgs,
  lib,
  ...
}: let
  # Powerline dividers between bar segments; colors are set per-instance in the CSS.
  divider = glyph: {
    format = glyph;
    tooltip = false;
  };
  dividers = name: count: glyph:
    lib.genAttrs (map (i: "custom/${name}#${toString i}") (lib.range 1 count)) (_: divider glyph);
in {
  programs.waybar = {
    enable = true;
    systemd.enable = true; # started with graphical-session.target (uwsm)

    # Main bar settings
    settings = [
      (dividers "left_div" 8 ""
        // dividers "left_inv" 2 ""
        // dividers "right_div" 5 ""
        // dividers "right_inv" 1 ""
        // {
          layer = "top";
          mode = "dock";
          height = 0;
          width = 0;
          spacing = 0;
          reload_style_on_change = true;

          # Layout
          "modules-left" = [
            "custom/user"
            "custom/left_div#1"
            "hyprland/workspaces"
            "custom/right_div#1"
            "hyprland/window"
          ];

          "modules-center" = [
            "hyprland/language"
            "custom/left_div#2"
            "temperature"
            "custom/left_div#3"
            "memory"
            "custom/left_div#4"
            "cpu"
            "custom/left_inv#1"
            "custom/left_div#5"
            "custom/distro"
            "custom/right_div#2"
            "custom/right_inv#1"
            "idle_inhibitor"
            "clock#time"
            "custom/right_div#3"
            "clock#date"
            "custom/right_div#4"
            "network"
            "bluetooth"
            "custom/right_div#5"
          ];

          "modules-right" = [
            "mpris"
            "custom/left_div#6"
            "group/pulseaudio"
            "custom/left_div#7"
            "backlight"
            "custom/left_div#8"
            "battery"
            "custom/left_inv#2"
            "custom/power"
          ];

          # Custom modules
          "custom/user" = {
            format = "󰍜";
            min-length = 4;
            max-length = 4;
            tooltip-format = "Notifications";
            on-click = "swaync-client -t -sw";
            on-click-right = "swaync-client -d -sw";
          };

          "custom/distro" = {
            format = "";
            tooltip = false;
          };

          "custom/power" = {
            format = "󰤄";
            on-click = "kitty -e ~/.config/waybar/scripts/power";
            tooltip-format = "Power Menu";
          };

          # Hyprland modules
          "hyprland/workspaces" = {
            format = "{icon}";
            format-icons = {
              active = "";
              default = "";
            };
            persistent-workspaces."*" = 5;
            on-scroll-up = "hyprctl dispatch workspace +1";
            on-scroll-down = "hyprctl dispatch workspace -1";
            cursor = true;
          };

          "hyprland/window" = {
            format = "{}";
            rewrite = {
              "" = "Desktop";
              "kitty" = "Terminal";
              "zsh" = "Terminal";
              "~" = "Terminal";
            };
            swap-icon-label = false;
            max-length = 60;
          };

          "hyprland/language" = {
            "format-en" = " en";
          };

          # System modules
          temperature = {
            # AMD k10temp (Tctl); the path stays stable across reboots, unlike hwmonN
            hwmon-path-abs = "/sys/devices/pci0000:00/0000:00:18.3/hwmon";
            input-filename = "temp1_input";
            critical-threshold = 90;
            interval = 10;
            format = "{icon} {temperatureC}°C";
            format-critical = "󰀦 {temperatureC}°C";
            format-icons = ["󱃃" "󰔏" "󱃂"];
            min-length = 8;
            max-length = 8;
            tooltip-format = "Temperature in Fahrenheit: {temperatureF}°F";
          };

          memory = {
            interval = 10;
            format = "󰘚 {percentage}%";
            format-warning = "󰀧 {percentage}%";
            format-critical = "󰀧 {percentage}%";
            states = {
              warning = 75;
              critical = 90;
            };
            min-length = 7;
            max-length = 7;
            tooltip-format = "Memory Used: {used:0.0f}/{total:0.0f} GiB";
          };

          cpu = {
            interval = 10;
            format = "󰍛 {usage}%";
            format-warning = "󰀨 {usage}%";
            format-critical = "󰀨 {usage}%";
            states = {
              warning = 75;
              critical = 90;
            };
            min-length = 7;
            max-length = 7;
            tooltip = false;
          };

          idle_inhibitor = {
            format = "{icon}";
            format-icons = {
              activated = "󰈈";
              deactivated = "󰈉";
            };
            min-length = 3;
            max-length = 3;
            tooltip-format-activated = "<b>Idle Inhibitor</b>: Activated";
            tooltip-format-deactivated = "<b>Idle Inhibitor</b>: Deactivated";
            start-activated = false;
          };

          "clock#time" = {
            format = "{:%H:%M}";
            min-length = 5;
            max-length = 5;
            tooltip-format = "<b>Standard Time</b>: <span text_transform='lowercase'>{:%I:%M %p}</span>";
          };

          "clock#date" = {
            format = "󰸗 {:%d-%m}";
            min-length = 8;
            max-length = 8;
            tooltip-format = "{calendar}";
            calendar = {
              mode = "month";
              mode-mon-col = 6;
              format = {
                months = "<span alpha='100%'><b>{}</b></span>";
                days = "<span alpha='90%'>{}</span>";
                weekdays = "<span alpha='80%'><i>{}</i></span>";
                today = "<span alpha='100%'><b><u>{}</u></b></span>";
              };
            };
            actions."on-click" = "mode";
          };

          network = {
            interval = 10;
            format = "󰤨";
            format-ethernet = "󰈀";
            format-wifi = "{icon}";
            format-disconnected = "󰤯";
            format-disabled = "󰤮";
            format-icons = ["󰤟" "󰤢" "󰤥" "󰤨"];
            min-length = 2;
            max-length = 2;
            on-click = "kitty -e ~/.config/waybar/scripts/network";
            on-click-right = "~/.config/waybar/scripts/network off";
            tooltip-format = "<b>Gateway</b>: {gwaddr}";
            tooltip-format-ethernet = "<b>Interface</b>: {ifname}";
            tooltip-format-wifi = "<b>Network</b>: {essid}\n<b>IP Addr</b>: {ipaddr}/{cidr}\n<b>Strength</b>: {signalStrength}%\n<b>Frequency</b>: {frequency} GHz";
            tooltip-format-disconnected = "Wi-Fi Disconnected";
            tooltip-format-disabled = "Wi-Fi Disabled";
          };

          bluetooth = {
            format = "󰂯";
            format-disabled = "󰂲";
            format-off = "󰂲";
            format-on = "󰂰";
            format-connected = "󰂱";
            min-length = 2;
            max-length = 2;
            on-click = "kitty -e ~/.config/waybar/scripts/bluetooth";
            on-click-right = "~/.config/waybar/scripts/bluetooth off";
            tooltip-format = "Device Addr: {device_address}";
            tooltip-format-disabled = "Bluetooth Disabled";
            tooltip-format-off = "Bluetooth Off";
            tooltip-format-on = "Bluetooth Disconnected";
            tooltip-format-connected = "Device: {device_alias}";
            tooltip-format-enumerate-connected = "Device: {device_alias}";
            tooltip-format-connected-battery = "Device: {device_alias}\nBattery: {device_battery_percentage}%";
            tooltip-format-enumerate-connected-battery = "Device: {device_alias}\nBattery: {device_battery_percentage}%";
          };

          mpris = {
            format = "{player_icon} {title} - {artist}";
            format-paused = "{status_icon} {title} - {artist}";
            tooltip-format = "Playing: {title} - {artist}";
            tooltip-format-paused = "Paused: {title} - {artist}";
            player-icons."default" = "󰐊";
            status-icons."paused" = "󰏤";
            max-length = 1000;
          };

          # PulseAudio group
          "group/pulseaudio" = {
            orientation = "horizontal";
            modules = ["pulseaudio#output" "pulseaudio#input"];
            drawer."transition-left-to-right" = false;
          };

          "pulseaudio#output" = {
            format = "{icon} {volume}%";
            format-muted = "{icon} {volume}%";
            format-icons = {
              default = ["󰕿" "󰖀" "󰕾"];
              default-muted = "󰝟";
              headphone = "󰋋";
              headphone-muted = "󰟎";
              headset = "󰋎";
              headset-muted = "󰋐";
            };
            min-length = 7;
            max-length = 7;
            on-click = "~/.config/waybar/scripts/volume output mute";
            on-scroll-up = "~/.config/waybar/scripts/volume output raise";
            on-scroll-down = "~/.config/waybar/scripts/volume output lower";
            tooltip-format = "<b>Output Device</b>: {desc}";
          };

          "pulseaudio#input" = {
            format = "{format_source}";
            format-source = "󰍬 {volume}%";
            format-source-muted = "󰍭 {volume}%";
            min-length = 7;
            max-length = 7;
            on-click = "~/.config/waybar/scripts/volume input mute";
            on-scroll-up = "~/.config/waybar/scripts/volume input raise";
            on-scroll-down = "~/.config/waybar/scripts/volume input lower";
            tooltip-format = "<b>Input Device</b>: {desc}";
          };

          backlight = {
            format = "{icon} {percent}%";
            format-icons = ["" "" "" "" "" "" "" "" ""];
            min-length = 7;
            max-length = 7;
            on-scroll-up = "~/.config/waybar/scripts/backlight up";
            on-scroll-down = "~/.config/waybar/scripts/backlight down";
            tooltip-format = "Screen Brightness";
          };

          battery = {
            states = {
              warning = 20;
              critical = 10;
            };
            format = "{icon} {capacity}%";
            format-time = "{H}h {M}min";
            format-icons = ["󰂎" "󰁻" "󰁼" "󰁽" "󰁾" "󰁿" "󰂀" "󰂁" "󰂂" "󰁹"];
            format-charging = "󰉁 {capacity}%";
            min-length = 7;
            max-length = 7;
            tooltip-format = "<b>Discharging</b>: {time}";
            tooltip-format-charging = "<b>Charging</b>: {time}";
            events = {
              on-discharging-warning = "notify-send 'Battery Low (20%)' -u critical -i 'battery-020' -h string:x-canonical-private-synchronous:battery";
              on-discharging-critical = "notify-send 'Battery Critical (10%)' -u critical -i 'battery-010' -h string:x-canonical-private-synchronous:battery";
              on-charging-100 = "notify-send 'Battery Full (100%)' -i 'battery-100-charged' -h string:x-canonical-private-synchronous:battery";
            };
          };
        })
    ];

    # Style  (Wallpaper greenleaves theme — transparent + blurred bar)
    style = ''
      /* =========================================================
         Greenleaves palette — sampled from wallpaper
         ─────────────────────────────────────────
         White wildflowers on black, pale sage-green stems.
         Layers (darkest → lightest):
           leaf-dark   #232d1e  near-black moss shadow      ← mantle tier
           fern        #35452b  dark stem green             ← base tier
           moss        #46583a  mid-dark stem               ← surface0 tier
           sage-mid    #5a7048  medium sage                 ← medium layer
           sage        #74895f  lighter sage
           sage-light  #97ab7e  desaturated light sage      ← accent
           pale-sage   #bccba3  pale stem highlight
           cream-mist  #d3ddc2  flower shadow cream
           cream       #e6ecd8  flower cream
           flower      #f4f7ee   brightest petal white      ← foreground
           grey-stem   #9aa38e  mirror body grey-green
         ========================================================= */

      /* Raw palette */
      @define-color leaf-dark    #232d1e;
      @define-color fern         #35452b;
      @define-color moss         #46583a;
      @define-color sage-mid     #5a7048;
      @define-color sage         #74895f;
      @define-color sage-light   #97ab7e;
      @define-color pale-sage    #bccba3;
      @define-color cream-mist   #d3ddc2;
      @define-color cream        #e6ecd8;
      @define-color flower       #f4f7ee;
      @define-color grey-stem    #9aa38e;

      /* Semantic aliases */
      @define-color accent      @sage-light;
      @define-color main-br     @sage;
      @define-color main-bg     alpha(#141a10, 0.55);
      @define-color main-fg     @flower;
      @define-color hover-bg    alpha(@moss, 0.60);
      @define-color hover-fg    alpha(@flower, 0.70);
      @define-color outline     alpha(@leaf-dark, 0.70);

      /* State colors — bright enough to pop on green */
      @define-color warning     #e8c44a;
      @define-color critical    #e05050;
      @define-color charging    #40c8b0;

      /* =========================================================
         Reset & base
         ========================================================= */
      * {
        all: initial;
        color: @main-fg;
        font-family: "CommitMono Nerd Font", "Commit Mono Nerd Font", monospace;
        font-weight: bold;
        font-size: 18px;
      }

      #window label,
      #mpris,
      tooltip label {
        font-weight: normal;
      }

      #workspaces button.active label,
      #workspaces button.focused label,
      #custom-distro {
        font-size: 20px;
      }

      #custom-power {
        font-size: 18px;
      }

      #custom-left_div,
      #custom-left_inv,
      #custom-right_div,
      #custom-right_inv {
        font-size: 22px;
      }

      /* =========================================================
         Bar shell
         ========================================================= */
      .module {
        margin-bottom: -1px;
      }

      /* Outer wrapper: fully transparent so the blur layer shows through */
      #waybar {
        background: transparent;
      }

      /* Inner box: frosted-glass panel */
      #waybar > box {
        margin: 4px;
        border-radius: 10px;
        background-color: alpha(#0d1208, 0.52);

        /* Blur comes from the hl.layer_rule for "waybar" in hyprland.nix */
      }

      button {
        border-radius: 16px;
        min-width: 16px;
        padding: 0 10px;
      }
      button:hover {
        background-color: @hover-bg;
        color: @hover-fg;
      }

      tooltip {
        border: 2px solid alpha(@sage, 0.60);
        border-radius: 10px;
        background-color: alpha(#1a2412, 0.82);
      }
      tooltip > box {
        padding: 0 6px;
      }

      /* =========================================================
         Left modules
         ========================================================= */

      /* Workspaces  (leaf-dark) */
      #custom-left_div.1,
      #custom-right_div.1 {
        color: @leaf-dark;
      }
      #workspaces {
        padding: 0 1px;
        background-color: @leaf-dark;
      }
      #workspaces button.active label,
      #workspaces button.focused label {
        color: @flower;
      }

      /* Window title */
      #window {
        margin: 0 12px;
      }

      /* =========================================================
         Center modules
         ========================================================= */

      /* Indicator */
      #keyboard-state label,
      #language {
        margin-right: 12px;
        color: @hover-fg;
      }

      /*
        Divider color logic — powerline arrows blend adjacent backgrounds:
          • A divider's `color`      = the module on the POINTED-TO side
          • A divider's `background` = the module on the flat/open side
          • No `background` set      = transparent (bar glass background shows)

        CENTER tier order (dark → light → accent → light → dark):
          transparent → [fern:temp] → [moss:mem] → [sage-mid:cpu]
          → transparent → [sage-light:distro] → transparent
          → [sage-mid:time+idle] → [moss:date] → [fern:tray] → transparent

        RIGHT tier order (right to left, dark → mid → light):
          transparent ← [fern:volume] ← [moss:backlight] ← [sage-mid:battery] ← transparent
      */

      /* Temperature  (fern) */
      #custom-left_div.2 {
        color: @fern;
      }
      #temperature {
        background-color: @fern;
      }

      /* Memory  (moss) — bridge from fern → moss */
      #custom-left_div.3 {
        background-color: @fern;
        color: @moss;
      }
      #memory {
        background-color: @moss;
      }

      /* CPU  (sage-mid) — bridge from moss → sage-mid */
      #custom-left_div.4 {
        background-color: @moss;
        color: @sage-mid;
      }
      #cpu {
        background-color: @sage-mid;
      }
      /* left_inv#1: inverse arrow cpu → transparent */
      #custom-left_inv.1 {
        color: @sage-mid;
      }

      /* Distro icon — sage-light accent pill */
      /* left_div#5 & right_div#2: transparent → sage-light → transparent */
      #custom-left_div.5,
      #custom-right_div.2 {
        color: @sage-light;
      }
      #custom-distro {
        padding: 0 10px 0 5px;
        background-color: @sage-light;
        color: @leaf-dark;
      }

      /* Idle inhibitor + Time  (sage-mid) */
      /* right_inv#1: transparent → azure */
      #custom-right_inv.1 {
        color: @sage-mid;
      }
      #idle_inhibitor {
        background-color: @sage-mid;
      }
      #clock.time {
        padding-right: 6px;
        background-color: @sage-mid;
      }

      /* Date  (moss) — bridge from sage-mid → moss */
      #custom-right_div.3 {
        background-color: @moss;
        color: @sage-mid;
      }
      #clock.date {
        padding-left: 6px;
        background-color: @moss;
      }

      /* Tray: network / bluetooth  (fern) — bridge from moss → fern */
      #custom-right_div.4 {
        background-color: @fern;
        color: @moss;
      }
      #network {
        background-color: @fern;
        padding: 0 6px 0 4px;
      }
      #bluetooth {
        background-color: @fern;
        padding: 0 5px;
      }
      /* right_div#5: fern → transparent */
      #custom-right_div.5 {
        color: @fern;
      }

      /* =========================================================
         Right modules
         ========================================================= */

      /* Media info */
      #mpris {
        padding: 0 12px;
      }

      /* Volume  (fern) — transparent → royal */
      #custom-left_div.6 {
        color: @fern;
      }
      #pulseaudio,
      #wireplumber {
        background-color: @fern;
      }

      /* Backlight  (moss) — bridge from fern → moss */
      #custom-left_div.7 {
        background-color: @fern;
        color: @moss;
      }
      #backlight {
        background-color: @moss;
      }

      /* Battery  (sage-mid) — bridge from moss → sage-mid */
      #custom-left_div.8 {
        background-color: @moss;
        color: @sage-mid;
      }
      #battery {
        background-color: @sage-mid;
      }
      /* left_inv#2: azure → transparent */
      #custom-left_inv.2 {
        color: @sage-mid;
      }

      /* Power menu */
      #custom-power {
        border-radius: 16px;
        padding: 0 19px 0 16px;
        color: @sage-light;
      }
      #custom-power:hover {
        background-color: alpha(@sage-mid, 0.70);
        color: @flower;
      }

      /* =========================================================
         States
         ========================================================= */

      #custom-user:hover,
      #idle_inhibitor:hover,
      #clock.date:hover,
      #network:hover,
      #bluetooth:hover,
      #mpris:hover,
      #pulseaudio:hover,
      #wireplumber:hover {
        color: @hover-fg;
      }

      /* Inactive states */
      #idle_inhibitor.deactivated,
      #mpris.paused,
      #pulseaudio.output.muted,
      #pulseaudio.input.source-muted,
      #wireplumber.muted {
        color: @hover-fg;
      }

      #memory.warning,
      #cpu.warning,
      #battery.warning {
        color: @warning;
      }

      #temperature.critical,
      #memory.critical,
      #cpu.critical,
      #battery.critical {
        color: @critical;
      }

      #battery.charging {
        color: @charging;
      }
    '';
  };

  # Scripts
  home.file = {
    ".config/waybar/scripts/backlight".source = ./scripts/backlight;
    ".config/waybar/scripts/bluetooth".source = ./scripts/bluetooth;
    ".config/waybar/scripts/network".source = ./scripts/network;
    ".config/waybar/scripts/power".source = ./scripts/power;
    ".config/waybar/scripts/volume".source = ./scripts/volume;
  };
}
