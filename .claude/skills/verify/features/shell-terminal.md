# Shell and terminal

zsh (vi mode, autosuggestions, syntax highlighting, fzf/eza/zoxide/direnv) with a starship prompt, kitty (MesloLG, everforest dark hard), and neovim with plugins from unstable plus Lua config and LuaSnip snippets. zsh's login profile also starts the Hyprland session.

Owners: `desktop/shell/zsh.nix`, `desktop/shell/starship.nix`, `desktop/apps/kitty/kitty.nix`, `desktop/apps/neovim/` (`neovim.nix`, `init.lua`, `lua/`, `LuaSnip/`), direnv in `home-manager/home.nix`. Login shell: `users.users.moka.shell` in `nixos/configuration.nix`.

## Sub-features

- `zsh-aliases`: `update` (`sudo nixos-rebuild switch`), `sd` (fzf cd), plus the functions `opencode` and `codex-opencode`.
- `zsh-keys`: vi mode, history prefix search on Up/Down, `^E` end-of-line.
- `zsh-login`: `profileExtra` runs `uwsm start` on TTY login.
- `starship`: `~/.config/starship.toml`.
- `kitty`: `~/.config/kitty/kitty.conf`.
- `neovim`: `~/.config/nvim/{init.lua,lua/,LuaSnip/}` plus the plugin pack.

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
- **neovim loads.** Run `XDG_CONFIG_HOME=$(cat $($V run)/home-files.path)/.config nvim --headless +qa 2>&1`. Output must be empty. nvim exits 0 even on `E5113` Lua errors, so judge by the output, not the exit code. Plugins come from the live profile, so this tests Lua config against the installed plugins.

## Gotchas

- The `update` alias (`sudo nixos-rebuild switch`) is how the user applies changes, after updating the flake. Agents must never run it.
- Home paths start with a dot (`.zshrc`). XDG files are under `.config/`.
- `nvim/lua` and `nvim/LuaSnip` are whole-directory sources. A new untracked Lua file is silently missing; check `$V doctor`.
- kitty's theme is checked by the `checkKittyTheme` activation step, which runs at switch time, not build time. A misspelled `themeFile` builds fine, so report a theme change as unverified until after the switch.
