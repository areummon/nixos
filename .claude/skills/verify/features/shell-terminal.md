# Shell and terminal

zsh (vi mode, autosuggestions, syntax highlighting, fzf/eza/zoxide/direnv) with a starship prompt, kitty (MesloLG, everforest dark hard), and neovim with plugins from unstable plus Lua config and LuaSnip snippets. zsh's login profile also starts the Hyprland session.

Owners: `desktop/shell/zsh.nix`, `desktop/shell/starship.nix`, `desktop/apps/kitty/kitty.nix`, `desktop/apps/neovim/` (`neovim.nix`, `init.lua`, `lua/`, `LuaSnip/`), direnv in `home-manager/home.nix`, `fd` (used by `sd` and Telescope) in `desktop/apps/fd/fd.nix`. Login shell: `users.users.moka.shell` in `nixos/configuration.nix`.

## Sub-features

- `zsh-aliases`: `update` (`sudo nixos-rebuild switch`), `sd` (fzf cd), plus the functions `opencode` and `codex-opencode`.
- `zsh-keys`: vi mode, history prefix search on Up/Down, `^E` end-of-line.
- `zsh-login`: `profileExtra` runs `exec systemd-cat -t uwsm_start uwsm start default` on TTY login when `uwsm check may-start && uwsm select` succeeds.
- `zsh-integrations`: eza replaces `ls` (plus `ll`, `la`, `lt`), zoxide adds `z`/`zi`, and fzf adds Ctrl-R, Ctrl-T, and Alt-C. History is in `~/.local/share/zsh/history`.
- `starship`: `~/.config/starship.toml`.
- `kitty`: `~/.config/kitty/kitty.conf`.
- `neovim`: `~/.config/nvim/{init.lua,lua/,LuaSnip/}` plus the plugin pack. `vi`/`vim` alias to nvim. Leader is Space, localleader `,`. Telescope is on `<leader>ff/fg/fb/fh`, while `<leader>fc` runs `TypstWatch` and `<leader>fr` opens the PDF in zathura. LSP enables rust_analyzer, hls, clangd, zls, and tinymist, but the module ships only `tinymist` (and `ripgrep`); the other servers start only when their binary is on PATH, for example from a direnv devshell.

## How to get to it (user POV)

- Open kitty (SUPER+Q). zsh loads `~/.zshrc`, and the prompt is starship.
- Run `nvim`.

## Driving it with verify

Preconditions: `$V build` after the edit.

- **zsh.** Run `$V diff-live .zshrc`. Then `zsh -n "$(cat $($V run)/home-files.path)/.zshrc"` exits 0, which is a syntax check only.
- **Login hook.** Run `$V diff-live .zprofile`.
- **Prompt.** Run `$V diff-live .config/starship.toml`.
- **kitty.** Run `$V diff-live .config/kitty/kitty.conf`.
- **neovim Lua.** Run `$V diff-live .config/nvim/init.lua`. For files in `lua/` or `LuaSnip/`, `$V ls .config/nvim` and then `$V file .config/nvim/lua/keymaps.lua`.
- **neovim loads.** Run `XDG_CONFIG_HOME=$(cat $($V run)/home-files.path)/.config nvim --headless +qa 2>&1`. Output must be empty. nvim exits 0 even on `E5113` Lua errors, so judge by the output, not the exit code. Plugins come from the live profile, so this tests Lua config against the installed plugins. To check keymaps, run the same command with `+'lua io.write(vim.inspect({vim.g.mapleader, vim.g.maplocalleader, vim.fn.maparg(" ff","n")}))'` before `+qa`, which prints `{ " ", ",", "<Cmd>Telescope find_files<CR>" }`.

## Gotchas

- The `update` alias (`sudo nixos-rebuild switch`) is how the user applies changes, after updating the flake. Agents must never run it.
- Home paths start with a dot (`.zshrc`). XDG files are under `.config/`.
- `nvim/lua` and `nvim/LuaSnip` are `recursive = true` sources, linked file by file from git-tracked files. A new untracked Lua file is silently missing; check `$V doctor`.
- The built `init.lua` is not the repo file verbatim: it ends with a `vim.opt.runtimepath:append("/nix/store/...")` line. Compare with `diff-live`, not against the repo file.
- `ls` is aliased to `eza`, so `ls -l` flags behave differently in scripts run from an interactive zsh. Use `stat` or `command ls`.
- kitty's theme is checked by the `checkKittyTheme` activation step, which runs at switch time, not build time. A misspelled `themeFile` builds fine, so report a theme change as unverified until after the switch.
