{
  pkgs,
  lib,
  config,
  ...
}: {
  programs.neovim = {
    enable = true;
    package = pkgs.neovim-unwrapped;
    viAlias = true;
    vimAlias = true;
    withRuby = false;
    withPython3 = false;
    plugins = with pkgs.vimPlugins; [
      nvim-autopairs
      lualine-nvim
      everforest
      vimtex
      trouble-nvim
      indent-blankline-nvim
      mini-icons
      mini-files
      plenary-nvim
      nvim-web-devicons
      telescope-nvim
      telescope-fzf-native-nvim
      # Treesitter
      nvim-treesitter
      nvim-treesitter-parsers.rust
      nvim-treesitter-parsers.python
      nvim-treesitter-parsers.c
      nvim-treesitter-parsers.haskell
      nvim-treesitter-parsers.zig
      # lsp
      nvim-lspconfig
      # cmp
      nvim-cmp
      cmp-nvim-lsp
      cmp_luasnip
      luasnip
    ];
    extraPackages = [
      pkgs.ripgrep
      pkgs.tinymist
    ];
    initLua =
      builtins.readFile ./init.lua
      + ''
        vim.opt.runtimepath:append("${./.}")
      '';
  };
  xdg.configFile."nvim/lua" = {
    source = ./lua;
    recursive = true;
  };
  xdg.configFile."nvim/LuaSnip" = {
    source = ./LuaSnip;
    recursive = true;
  };
}
