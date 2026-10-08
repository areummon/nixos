# Desktop apps

Firefox (profile `moka` with forced search engines, privacy and telemetry prefs, a fixed toolbar, and browserpass), VS Code (extensions stay mutable), and mpv (SDR tone-mapping for HDR video). All three come from unstable.

Owners: `desktop/apps/firefox/firefox.nix`, `desktop/apps/vscode/vscode.nix`, `desktop/apps/mpv/mpv.nix`, imported from `desktop/apps/default.nix`.

## Sub-features

- `firefox-profile`: `programs.firefox` with `configPath` under XDG, so the profile lives at `~/.config/mozilla/firefox/moka/` (`user.js`, `search.json.mozlz4`) with `~/.config/mozilla/firefox/profiles.ini`, not under `~/.mozilla`. Search is forced: Google by default, DuckDuckGo in private windows, Bing hidden. `user.js` holds the startup, new-tab, telemetry, and `browser.uiCustomization.state` toolbar prefs.
- `firefox-browserpass`: `programs.browserpass` writes `~/.mozilla/native-messaging-hosts/com.github.browserpass.native.json`.
- `firefox-mime`: `xdg.mimeApps.defaultApplications` maps `text/html`, `text/xml`, `http`, and `https` to `firefox.desktop`.
- `vscode`: `programs.vscode` with `mutableExtensionsDir = true` and extension update checks on. The only generated file is `~/.vscode/extensions/.extensions-immutable.json`.
- `mpv`: `~/.config/mpv/mpv.conf` sets `tone-mapping=bt.2390`, `target-prim=bt.709`, `target-trc=bt.1886`, `hdr-compute-peak=no`, and `video-output-levels=full`. Home-manager writes each value length-prefixed, as `tone-mapping=%7%bt.2390`, so grep for the key, not the literal `key=value`.

## How to get to it (user POV)

- SUPER+SHIFT+F opens Firefox (see `desktop-hyprland.md`). The search bar and toolbar match the profile.
- Run `code` or `mpv <file>`.

## Driving it with verify

Preconditions: `$V build` after the edit.

- **Firefox profile.** Run `$V ls .config/mozilla`, then `$V diff-live .config/mozilla/firefox/moka/user.js` and `$V diff-live .config/mozilla/firefox/profiles.ini`. A pref edit shows as a `user_pref` hunk.
- **Firefox search.** `search.json.mozlz4` is compressed, so prove a search edit with `$V eval home-manager.users.moka.programs.firefox.profiles.moka.search.default` (or `.order`).
- **browserpass.** Run `$V ls .mozilla/native-messaging-hosts`.
- **Mime defaults.** Run `$V eval home-manager.users.moka.xdg.mimeApps.defaultApplications`.
- **mpv.** Run `$V diff-live .config/mpv/mpv.conf`.
- **VS Code.** Run `$V eval home-manager.users.moka.programs.vscode.mutableExtensionsDir`, which gives `true`.

## Gotchas

- `xdg.mimeApps.enable` is `false`, so the mime defaults never reach `~/.config/mimeapps.list`. The option evaluates, but nothing is written. Don't report a mime change as applied from the eval alone. `~/.config/mimeapps.list` is hand-managed (gThumb for PNG/JPEG, Firefox for `text/html` via `xdg-mime default`); check it with `xdg-mime query default <type>`.
- `$V diff-live .mozilla/firefox/...` fails with "No such file": the profile is under `.config/mozilla`. Only the browserpass host stays in `~/.mozilla`.
