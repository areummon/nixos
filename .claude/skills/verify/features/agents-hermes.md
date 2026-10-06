# Hermes agent

Hermes (NousResearch, flake input `hermes-agent`) runs as an always-on user service: a Discord gateway on the `default` profile with a model fallback chain. Two sandboxed profiles run on daily timers: `news` writes a verified tech digest to the career vault and posts it to a Discord channel ID around 09:30, and `jobs` discovers listings around 08:30 (no posting) and verifies them and posts to `#job-search` around 09:00. Timers are `Persistent=true` with a random delay (5m for news, 15m for jobs).

Owners: `desktop/apps/agents/hermes-agent-local.nix` (gateway and main settings), `hermes-agent-news.nix` and `hermes-news-soul.md`, `hermes-agent-jobs.nix` and `hermes-jobs-soul.md`. The home-manager module comes from `inputs.hermes-agent.homeManagerModules.default`, imported in `home-manager/home.nix`.

## Sub-features

- `hermes-gateway`: `hermes-agent.service` (`hermes gateway`), with hardening and environment in `systemd.user.services.hermes-agent.Service`.
- `hermes-settings`: main `~/.hermes/config.yaml` from `services.hermes-agent.settings` (model, fallbacks, `gateway.multiplex_profiles`, discord, approvals, redaction, `terminal.backend = "local"`). Activation merges these keys into the existing file, so keys Hermes wrote at runtime survive. `environmentFiles` (`~/.secrets/{openrouter,discord}.env`) are merged into `~/.hermes/.env`.
- `hermes-news`: `profiles/news/{config.yaml,SOUL.md}`, plus `hermes-news-digest.service` and `.timer`.
- `hermes-jobs`: `profiles/jobs/{config.yaml,SOUL.md}`, plus `hermes-jobs-discovery` and `hermes-jobs-verification` services and timers. Activation also creates `career_vault/Job Search/{Inbox (mode 700),Active}`.
- `hermes-profile-env`: activation steps copy `~/.secrets/{news,jobs}-profile.env` to `~/.hermes/profiles/<p>/.env`.

## How to get to it (user POV)

- Mention the bot in Discord. The gateway answers in a thread.
- Wait for the daily timers, or check `systemctl --user list-timers 'hermes-*'`.
- Run `hermes -p news chat` or `hermes -p jobs chat` interactively.

## Driving it with verify

Preconditions: `$V build` after the edit. Don't read `~/.secrets/` or any `.env` file.

- **Gateway unit.** Run `$V file .config/systemd/user/hermes-agent.service`. `ExecStart=.../bin/hermes gateway` and the `Environment=` lines match the edit.
- **Main settings.** Run `$V eval home-manager.users.moka.services.hermes-agent.settings`. The JSON shows the intended model, fallback, or approval values.
- **Profile config.** Run `nix build --no-link --print-out-paths '.#nixosConfigurations.nixos.config.home-manager.users.moka.services.hermes-agent.hermesHomeFiles."profiles/news/config.yaml"'`, then `diff -u ~/.hermes/profiles/news/config.yaml <path>`. Only the intended YAML keys differ. Use the same pattern for `jobs`. For `SOUL.md`, diff the live file against the repo file directly: `diff -u ~/.hermes/profiles/news/SOUL.md desktop/apps/agents/hermes-news-soul.md`.
- **Timer schedule.** Run `$V file .config/systemd/user/hermes-news-digest.timer`. `OnCalendar=`, `RandomizedDelaySec=`, and `Persistent=true` hold the expected values.
- **Job prompt.** Run `$V file .config/systemd/user/hermes-news-digest.service`, then `cat` the script path from `ExecStart=`. The prompt text matches the edit.
- **Runtime (post-switch).** Run `systemctl --user status hermes-agent` and `journalctl --user -u hermes-news-digest`. Read only. Don't start the oneshot units.

## Gotchas

- Hermes profile files aren't `home.file` entries, so `$V ls` and `diff-live` don't see them. The `hermesAgentSetup` activation step copies them into `~/.hermes/` as real mode-600 files.
- The oneshot units carry `ConditionPathExists` on the profile `.env`. Without the secret file they skip silently. Activation prints a `hermes-agent: ... missing` warning.
- Starting a unit to test it spends model quota, writes to `~/Documents/career_vault`, and posts to Discord. Treat it as a production action.
- Model names (`gpt-6-luna`, `meituan/longcat-2.0:free` and the rest) aren't validated by the build. A typo builds fine and only fails at runtime.
- `terminal.backend = "docker"` applies only to the `news` and `jobs` profiles and uses podman's docker compatibility (`virtualisation.podman.dockerCompat` in `nixos/configuration.nix`). The gateway uses the `local` backend.
- The news digest and jobs verification post only when the reply has non-whitespace text. Both SOULs tell the model to reply with nothing when there is nothing to report.
- The gateway unit's `Environment` is `lib.mkForce`, so it replaces the module's list, and it points `OBSIDIAN_VAULT_PATH` at `study_vault`, not the career vault.
