{
  inputs,
  pkgs,
  lib,
  config,
  ...
}: {
  wayland.windowManager.hyprland = {
    enable = true;
    systemd.enable = false;
    xwayland.enable = true;
    settings = {};
    configType = "lua";
    extraConfig = ''
      ------------------
      ---- MONITORS ----
      ------------------

      hl.monitor({
          output = "eDP-1",
          mode = "1920x1200@60",
          position = "0x0",
          scale = 1,
      })


      -------------------
      ---- AUTOSTART ----
      -------------------

      hl.on("hyprland.start", function()
          hl.exec_cmd("waybar")
          hl.exec_cmd("fcitx5 -d")
          hl.exec_cmd("sleep 1 && hyprctl setcursor McMojave 40")
      end)


      -------------------------------
      ---- ENVIRONMENT VARIABLES ----
      -------------------------------

      -- No environment variables were present in the original
      -- Nix configuration.


      -----------------------
      ---- LOOK AND FEEL ----
      -----------------------

      hl.config({
          general = {
              gaps_in = 5,
              gaps_out = 10,
              border_size = 2,

              col = {
                  active_border = {
                      colors = {
                          "rgba(121212aa)",
                          "rgba(121212aa)",
                      },
                      angle = 45,
                  },

                  inactive_border = "rgba(121212aa)",
              },

              resize_on_border = true,
              allow_tearing = false,
              layout = "dwindle",
          },

          decoration = {
              rounding = 12,

              active_opacity = 0.80,
              inactive_opacity = 0.80,

              shadow = {
                  enabled = true,
                  range = 16,

                  -- Hyprland 0.56 limits this to 1-4.
                  -- Original value was 5.
                  render_power = 4,

                  color = "rgba(0,0,0,0.35)",
              },

              blur = {
                  enabled = true,
                  size = 2,
                  passes = 3,
                  vibrancy = 0.1696,
                  new_optimizations = true,
                  ignore_opacity = true,
              },
          },

          animations = {
              enabled = true,
          },

          dwindle = {
              preserve_split = true,
          },

          master = {
              new_status = "master",
          },

          input = {
              kb_layout = "us",
              follow_mouse = 1,
              sensitivity = 0,

              touchpad = {
                  natural_scroll = true,
              },
          },

          misc = {
              disable_hyprland_logo = true,
              disable_splash_rendering = false,
              mouse_move_enables_dpms = false,
              vrr = 1,
          },
      })

      ----------------
      ---- RENDER ----
      ----------------

      -----------------------
      ---- ANIMATIONS -------
      -----------------------

      hl.curve("easeOutQuint", {
          type = "bezier",
          points = {
              { 0.23, 1 },
              { 0.32, 1 },
          },
      })

      hl.curve("easeInOutCubic", {
          type = "bezier",
          points = {
              { 0.65, 0.05 },
              { 0.36, 1 },
          },
      })

      hl.curve("linear", {
          type = "bezier",
          points = {
              { 0, 0 },
              { 1, 1 },
          },
      })

      hl.curve("almostLinear", {
          type = "bezier",
          points = {
              { 0.5, 0.5 },
              { 0.75, 1 },
          },
      })

      hl.curve("quick", {
          type = "bezier",
          points = {
              { 0.15, 0 },
              { 0.1, 1 },
          },
      })


      hl.animation({
          leaf = "global",
          enabled = true,
          speed = 10,
          bezier = "default",
      })

      hl.animation({
          leaf = "border",
          enabled = true,
          speed = 5.39,
          bezier = "easeOutQuint",
      })

      hl.animation({
          leaf = "windows",
          enabled = true,
          speed = 4.79,
          bezier = "easeOutQuint",
      })

      hl.animation({
          leaf = "windowsIn",
          enabled = true,
          speed = 4.1,
          bezier = "easeOutQuint",
          style = "popin 87%",
      })

      hl.animation({
          leaf = "windowsOut",
          enabled = true,
          speed = 1.49,
          bezier = "linear",
          style = "popin 87%",
      })

      hl.animation({
          leaf = "fadeIn",
          enabled = true,
          speed = 1.73,
          bezier = "almostLinear",
      })

      hl.animation({
          leaf = "fadeOut",
          enabled = true,
          speed = 1.46,
          bezier = "almostLinear",
      })

      hl.animation({
          leaf = "fade",
          enabled = true,
          speed = 3.03,
          bezier = "quick",
      })

      hl.animation({
          leaf = "layers",
          enabled = true,
          speed = 3.81,
          bezier = "easeOutQuint",
      })

      hl.animation({
          leaf = "layersIn",
          enabled = true,
          speed = 4,
          bezier = "easeOutQuint",
          style = "fade",
      })

      hl.animation({
          leaf = "layersOut",
          enabled = true,
          speed = 1.5,
          bezier = "linear",
          style = "fade",
      })

      hl.animation({
          leaf = "fadeLayersIn",
          enabled = true,
          speed = 1.79,
          bezier = "almostLinear",
      })

      hl.animation({
          leaf = "fadeLayersOut",
          enabled = true,
          speed = 1.39,
          bezier = "almostLinear",
      })

      hl.animation({
          leaf = "workspaces",
          enabled = true,
          speed = 1.94,
          bezier = "almostLinear",
          style = "fade",
      })

      hl.animation({
          leaf = "workspacesIn",
          enabled = true,
          speed = 1.21,
          bezier = "almostLinear",
          style = "fade",
      })

      hl.animation({
          leaf = "workspacesOut",
          enabled = true,
          speed = 1.94,
          bezier = "almostLinear",
          style = "fade",
      })


      ----------------
      ----  INPUT  ----
      ----------------

      hl.gesture({
          fingers = 3,
          direction = "horizontal",
          action = "workspace",
      })

      hl.gesture({
          fingers = 3,
          direction = "down",
          mods = "ALT",
          action = "close",
      })

      hl.gesture({
          fingers = 4,
          direction = "pinch",
          action = "fullscreen",
      })

      hl.device({
          name = "epic-mouse-v1",
          sensitivity = 0.5,
      })


      ---------------------
      ---- KEYBINDINGS ----
      ---------------------

      local mainMod = "SUPER"


      -- Screenshot
      hl.bind(
          mainMod .. " + SHIFT + A",
          hl.dsp.exec_cmd("hyprshot -m region")
      )


      -- Terminal
      hl.bind(
          mainMod .. " + Q",
          hl.dsp.exec_cmd("kitty")
      )


      -- Close active window
      hl.bind(
          mainMod .. " + C",
          hl.dsp.window.close()
      )


      -- Exit Hyprland
      hl.bind(
          mainMod .. " + M",
          hl.dsp.exec_cmd("uwsm stop")
      )


      -- Toggle floating
      hl.bind(
          mainMod .. " + V",
          hl.dsp.window.float({
              action = "toggle",
          })
      )


      -- Application launcher
      hl.bind(
          mainMod .. " + R",
          hl.dsp.exec_cmd("wofi")
      )


      -- Pseudo tile
      hl.bind(
          mainMod .. " + P",
          hl.dsp.window.pseudo()
      )


      -- Toggle split
      hl.bind(
          mainMod .. " + J",
          hl.dsp.layout("togglesplit")
      )


      -- Firefox
      hl.bind(
          mainMod .. " + SHIFT + F",
          hl.dsp.exec_cmd("firefox")
      )


      -- Brave
      hl.bind(
          mainMod .. " + SHIFT + D",
          hl.dsp.exec_cmd("com.brave.Browser")
      )


      ---------------------
      ---- WORKSPACES ----
      ---------------------

      -- Switch to workspace
      for i = 1, 10 do
          local key = i % 10

          hl.bind(
              mainMod .. " + " .. key,
              hl.dsp.focus({
                  workspace = i,
              })
          )

          -- Move active window to workspace
          hl.bind(
              mainMod .. " + SHIFT + " .. key,
              hl.dsp.window.move({
                  workspace = i,
              })
          )
      end


      -------------------------
      ---- ACTIVE WINDOW ------
      -------------------------

      hl.bind(
          mainMod .. " + SHIFT + L",
          hl.dsp.focus({
              direction = "right",
          })
      )

      hl.bind(
          mainMod .. " + SHIFT + H",
          hl.dsp.focus({
              direction = "left",
          })
      )

      hl.bind(
          mainMod .. " + SHIFT + J",
          hl.dsp.focus({
              direction = "down",
          })
      )

      hl.bind(
          mainMod .. " + SHIFT + K",
          hl.dsp.focus({
              direction = "up",
          })
      )


      -----------------------
      ---- SCRATCHPAD -------
      -----------------------

      hl.bind(
          mainMod .. " + S",
          hl.dsp.workspace.toggle_special("magic")
      )

      hl.bind(
          mainMod .. " + SHIFT + S",
          hl.dsp.window.move({
              workspace = "special:magic",
          })
      )

      -- Proton VPN scratchpad: hide/show without terminating the app
      hl.bind(
          mainMod .. " + O",
          hl.dsp.workspace.toggle_special("protonvpn")
      )

      hl.bind(
          mainMod .. " + SHIFT + O",
          hl.dsp.window.move({
              workspace = "special:protonvpn",
          })
      )


      -----------------------------
      ---- WORKSPACE SCROLL -------
      -----------------------------

      hl.bind(
          mainMod .. " + mouse_down",
          hl.dsp.focus({
              workspace = "e+1",
          })
      )

      hl.bind(
          mainMod .. " + mouse_up",
          hl.dsp.focus({
              workspace = "e-1",
          })
      )


      -----------------------------
      ---- MOUSE WINDOW BINDS -----
      -----------------------------

      hl.bind(
          mainMod .. " + mouse:272",
          hl.dsp.window.drag(),
          {
              mouse = true,
          }
      )

      hl.bind(
          mainMod .. " + mouse:273",
          hl.dsp.window.resize(),
          {
              mouse = true,
          }
      )


      -------------------------------
      ---- MULTIMEDIA KEYBINDS ------
      -------------------------------

      -- Volume
      hl.bind(
          "XF86AudioRaiseVolume",
          hl.dsp.exec_cmd(
              "wpctl set-volume -l 1 @DEFAULT_AUDIO_SINK@ 5%+"
          ),
          {
              locked = true,
              repeating = true,
          }
      )

      hl.bind(
          "XF86AudioLowerVolume",
          hl.dsp.exec_cmd(
              "wpctl set-volume @DEFAULT_AUDIO_SINK@ 5%-"
          ),
          {
              locked = true,
              repeating = true,
          }
      )

      hl.bind(
          "XF86AudioMute",
          hl.dsp.exec_cmd(
              "wpctl set-mute @DEFAULT_AUDIO_SINK@ toggle"
          ),
          {
              locked = true,
              repeating = true,
          }
      )

      hl.bind(
          "XF86AudioMicMute",
          hl.dsp.exec_cmd(
              "wpctl set-mute @DEFAULT_AUDIO_SOURCE@ toggle"
          ),
          {
              locked = true,
              repeating = true,
          }
      )


      -- Brightness
      hl.bind(
          "XF86MonBrightnessUp",
          hl.dsp.exec_cmd(
              "brightnessctl s 10%+"
          ),
          {
              locked = true,
              repeating = true,
          }
      )

      hl.bind(
          "XF86MonBrightnessDown",
          hl.dsp.exec_cmd(
              "brightnessctl s 10%-"
          ),
          {
              locked = true,
              repeating = true,
          }
      )


      -- Media
      hl.bind(
          "XF86AudioNext",
          hl.dsp.exec_cmd("playerctl next"),
          {
              locked = true,
          }
      )

      hl.bind(
          "XF86AudioPause",
          hl.dsp.exec_cmd("playerctl play-pause"),
          {
              locked = true,
          }
      )

      hl.bind(
          "XF86AudioPlay",
          hl.dsp.exec_cmd("playerctl play-pause"),
          {
              locked = true,
          }
      )

      hl.bind(
          "XF86AudioPrev",
          hl.dsp.exec_cmd("playerctl previous"),
          {
              locked = true,
          }
      )


      --------------------------------
      ---- WINDOWS AND WORKSPACES ----
      --------------------------------


      -- Brave
      hl.window_rule({
          match = {
              title = "(.*)(Brave)$",
          },
          opaque = true,
      })


      -- Firefox
      hl.window_rule({
          match = {
              title = "(.*)(Firefox)$",
          },
          opaque = true,
      })


      -- LibreWolf
      hl.window_rule({
          match = {
              title = "(.*)(LibreWolf)$",
          },
          opaque = true,
      })


      -- Ignore maximize requests
      hl.window_rule({
          name = "suppress-maximize",
          match = {
              class = ".*",
          },
          suppress_event = "maximize",
      })


      -- Fix some dragging issues with XWayland
      hl.window_rule({
          name = "fix-xwayland-drags",
          match = {
              class = "^$",
              title = "^$",
              xwayland = true,
              float = true,
              fullscreen = false,
              pin = false,
          },
          no_focus = true,
      })


      -- Remove maximum-size restrictions
      hl.window_rule({
          name = "remove-max-size",
          match = {
              class = ".*",
          },
          no_max_size = true,
      })


      --------------------
      ---- LAYER RULES ---
      --------------------

      -- bar-0
      hl.layer_rule({
          match = {
              namespace = "bar-0",
          },
          blur = true,
      })


      -- Wofi
      hl.layer_rule({
          match = {
              namespace = "wofi",
          },
          blur = true,
          ignore_alpha = 0.4,
      })


      -- Waybar
      hl.layer_rule({
          match = {
              namespace = "waybar",
          },
          blur = true,
          ignore_alpha = 0,
      })
    '';
  };
}
