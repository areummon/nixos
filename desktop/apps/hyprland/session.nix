{
  pkgs,
  lib,
  config,
  ...
}: {
  # Desktop session daemons, started with graphical-session.target (uwsm)

  # Graphical polkit prompts (nautilus mounts, NetworkManager, ...)
  services.hyprpolkitagent = {
    enable = true;
    package = pkgs.unstable.hyprpolkitagent;
  };

  # Clipboard history, picked with SUPER+SHIFT+V (wofi --dmenu)
  services.cliphist = {
    enable = true;
    package = pkgs.unstable.cliphist;
    allowImages = true;
  };

  # Notification daemon for notify-send (waybar scripts, battery events);
  # SUPER+N or the waybar menu icon toggles the notification center
  services.swaync = {
    enable = true;
    package = pkgs.unstable.swaynotificationcenter;
    settings = {
      positionX = "right";
      positionY = "top";
      control-center-margin-top = 10;
      control-center-margin-right = 10;
      timeout = 5;
      timeout-low = 3;
      timeout-critical = 0;
    };
    # Dark "liquid glass", matching waybar; the blur comes from the Hyprland
    # layer_rule for the swaync namespaces. Layered on top of the stock
    # stylesheet, which a custom style would otherwise replace.
    style = ''
      @import url("file://${config.services.swaync.package}/etc/xdg/swaync/style.css");

      @define-color glass-bg     alpha(#16181e, 0.55);
      @define-color glass-sheen  alpha(#ffffff, 0.10);
      @define-color glass-edge   alpha(#ffffff, 0.14);
      @define-color glass-rim    alpha(#ffffff, 0.34);
      @define-color glass-hover  alpha(#ffffff, 0.12);
      @define-color fg           #f5f5f7;
      @define-color fg-dim       alpha(#f5f5f7, 0.60);

      /* One corner radius everywhere (stock CSS uses 12px for inner parts) */
      :root {
        --border-radius: 20px;
      }

      /* The stock CSS highlights the whole row/group as a square on
         hover/focus; keep those transparent and highlight the card instead */
      .notification-row,
      .notification-row:focus,
      .notification-row:hover,
      .notification-group,
      .notification-group:focus,
      .notification-group:hover {
        background: transparent;
        box-shadow: none;
      }

      * {
        font-family: "CommitMono Nerd Font", monospace;
      }

      .notification-window,
      .control-center-window,
      .blank-window {
        background: transparent;
      }

      .notification-row .notification-background .notification,
      .control-center {
        background-color: @glass-bg;
        background-image: linear-gradient(to bottom, @glass-sheen, transparent 50%);
        border: 1px solid @glass-edge;
        border-top-color: @glass-rim;
        border-radius: 20px;
        box-shadow: inset 0 1px 1px alpha(#ffffff, 0.12);
        color: @fg;
      }

      .notification-row .notification-background {
        background: transparent;
      }

      .notification-row:focus .notification-background .notification,
      .notification-row:hover .notification-background .notification {
        background-color: alpha(#22252c, 0.65);
      }

      .notification .summary {
        color: @fg;
      }

      .notification .body,
      .notification .time {
        color: @fg-dim;
      }

      .notification.critical {
        border-color: alpha(#ff453a, 0.70);
      }

      .notification-row .notification-background .close-button {
        background: alpha(#ffffff, 0.12);
        border-radius: 999px;
        color: @fg;
      }

      .control-center .widget-title > button,
      .notification .notification-action,
      .widget-dnd > switch {
        background: alpha(#ffffff, 0.10);
        border: 1px solid @glass-edge;
        border-radius: 12px;
        color: @fg;
      }

      .control-center .widget-title > button:hover,
      .notification .notification-action:hover {
        background: @glass-hover;
      }

      .widget-dnd > switch:checked {
        background: alpha(#ffffff, 0.30);
      }
    '';
  };
}
