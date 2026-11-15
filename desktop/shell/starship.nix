{
  pkgs,
  lib,
  config,
  ...
}: {
  programs.starship = {
    enable = true;
    package = pkgs.starship;
    enableZshIntegration = true;
    settings = {
      format = lib.concatStrings [
        "[](#5a7048)"
        "$os"
        "$username"
        "[](bg:#97ab7e fg:#5a7048)"
        "$directory"
        "[](fg:#97ab7e bg:#bccba3)"
        "$git_branch"
        "$git_status"
        "[](fg:#bccba3 bg:#f4f7ee)"
        "$c"
        "$elixir"
        "$elm"
        "$golang"
        "$gradle"
        "$haskell"
        "$java"
        "$julia"
        "$nodejs"
        "$nim"
        "$rust"
        "$scala"
        "[](fg:#f4f7ee bg:#35452b)"
        "$docker_context"
        "[](fg:#35452b bg:#232d1e)"
        "$time"
        "[ ](fg:#232d1e)"
        "$line_break$character"
      ];
      line_break = {
        disabled = false;
      };
      username = {
        show_always = true;
        style_user = "bg:#46583a";
        style_root = "bg:#46583a";
        format = "[$user ]($style)";
        disabled = true;
      };
      os = {
        style = "bg:#5a7048";
        disabled = false;
      };
      directory = {
        style = "bg:#97ab7e";
        format = "[ $path ]($style)";
        truncation_length = 3;
        truncation_symbol = "…/";
        substitutions = {
          "Documents" = "󰈙 ";
          "Downloads" = " ";
          "Music" = " ";
          "Pictures" = " ";
        };
      };
      c = {
        symbol = " ";
        style = "bg:#f4f7ee";
        format = "[ $symbol ($version) ]($style)";
      };
      docker_context = {
        symbol = " ";
        style = "bg:#35452b";
        format = "[ $symbol $context ]($style)";
      };
      elixir = {
        symbol = " ";
        style = "bg:#f4f7ee";
        format = "[ $symbol ($version) ]($style)";
      };
      elm = {
        symbol = " ";
        style = "bg:#f4f7ee";
        format = "[ $symbol ($version) ]($style)";
      };
      git_branch = {
        symbol = "";
        style = "bg:#bccba3 fg:#3d4a30";
        format = "[ $symbol $branch ]($style)";
      };
      git_status = {
        style = "bg:#bccba3 fg:#3d4a30";
        format = "[$all_status$ahead_behind ]($style)";
      };
      golang = {
        symbol = " ";
        style = "bg:#f4f7ee";
        format = "[ $symbol ($version) ]($style)";
      };
      gradle = {
        style = "bg:#f4f7ee";
        format = "[ $symbol ($version) ]($style)";
      };
      haskell = {
        symbol = " ";
        style = "bg:#f4f7ee";
        format = "[ $symbol ($version) ]($style)";
      };
      java = {
        symbol = " ";
        style = "bg:#f4f7ee";
        format = "[ $symbol ($version) ]($style)";
      };
      julia = {
        symbol = " ";
        style = "bg:#f4f7ee";
        format = "[ $symbol ($version) ]($style)";
      };
      nodejs = {
        symbol = "";
        style = "bg:#f4f7ee";
        format = "[ $symbol ($version) ]($style)";
      };
      nim = {
        symbol = "󰆥 ";
        style = "bg:#f4f7ee";
        format = "[ $symbol ($version) ]($style)";
      };
      rust = {
        symbol = " ";
        style = "bg:#f4f7ee";
        format = "[ $symbol ($version) ]($style)";
      };
      scala = {
        symbol = " ";
        style = "bg:#f4f7ee";
        format = "[ $symbol ($version) ]($style)";
      };
      time = {
        disabled = false;
        time_format = "%R"; # Hour:Minute Format
        style = "bg:#232d1e";
        format = "[ ♥ $time ]($style)";
      };
      character = {
        disabled = false;
        success_symbol = "[‣](bold fg:#b8e6a8)";
        error_symbol = "[‣](bold fg:#ff9999)";
        vimcmd_symbol = "[◂](bold fg:#b8e6a8)";
        vimcmd_replace_one_symbol = "[◂](bold fg:#5a7048)";
        vimcmd_replace_symbol = "[◂](bold fg:#5a7048)";
        vimcmd_visual_symbol = "[◂](bold fg:#ffdc9e)";
      };
    };
  };
}
