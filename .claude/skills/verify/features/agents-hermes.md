# Hermes agent

Hermes (NousResearch, flake input `hermes-agent`) runs as an always-on user service: a Discord gateway on the `default` profile, on Anthropic `claude-opus-5-5` with `claude-sonnet-5-5` as the one fallback. The `news` and `jobs` profiles, with their daily timers, are paused: their modules stay in the repo but `desktop/apps/agents/default.nix` doesn't import them, so the build has no news/jobs units, timers, or profile files.

Owners: `desktop/apps/agents/hermes-agent-local.nix` (gateway and main settings). Paused: `hermes-agent-news.nix` and `hermes-news-soul.md`, `hermes-agent-jobs.nix` and `hermes-jobs-soul.md`. The home-manager module comes from `inputs.hermes-agent.homeManagerModules.default`, imported in `home-manager/home.nix`; it also puts `hermes` on PATH and sets `HERMES_HOME`.

## Sub-features

- `hermes-gateway`: `hermes-agent.service` (`hermes gateway`). The base unit comes from the upstream module (`WantedBy=default.target`, `UMask=0077`, `NoNewPrivileges`, restart); `systemd.user.services.hermes-agent.Service` adds hardening (`Delegate=true`, `ProtectSystem=full`, address-family limits) and a forced `Environment`.
- `hermes-settings`: main `~/.hermes/config.yaml` from `services.hermes-agent.settings` (model and fallback, `gateway.multiplex_profiles = false`, `memory.provider = ""`, `terminal.backend = "local"`, `web.extract_backend = "firecrawl"` on the keyless tier, discord with `require_mention`, approvals, `privacy.redact_pii`). Activation merges these keys into the existing file, so keys Hermes wrote at runtime survive. `environmentFiles` (`~/.secrets/{openrouter,discord}.env`) are written into `~/.hermes/.env`, which activation rewrites from scratch.
- `hermes-news` (paused): `profiles/news/{config.yaml,SOUL.md}`, plus `hermes-news-digest.service` and `.timer` (09:30, 5m random delay), posting a digest to a Discord channel ID.
- `hermes-jobs` (paused): `profiles/jobs/{config.yaml,SOUL.md}`, plus `hermes-jobs-discovery` (08:30, no posting) and `hermes-jobs-verification` (09:00, posts to `#job-search`) services and timers, 15m random delay. Activation also creates `career_vault/Job Search/{Inbox (mode 700),Active}`.
- `hermes-profile-env` (paused): activation steps copy `~/.secrets/{news,jobs}-profile.env` to `~/.hermes/profiles/<p>/.env`.

## How to get to it (user POV)

- Mention the bot in Discord. The gateway answers in a thread.
- To re-enable news/jobs, uncomment their imports in `desktop/apps/agents/default.nix`, set `gateway.multiplex_profiles = true`, and switch.

## Driving it with verify

Preconditions: `$V build` after the edit. Don't read `~/.secrets/` or any `.env` file.

- **Gateway unit.** Run `$V file .config/systemd/user/hermes-agent.service`. `ExecStart=.../bin/hermes gateway`, the four `Environment=` lines (`HERMES_HOME`, `HERMES_MANAGED`, `OBSIDIAN_VAULT_PATH`, `PATH`), `Delegate=true`, and `ProtectSystem=full` match the edit.
- **Main settings.** Run `$V eval home-manager.users.moka.services.hermes-agent.settings`. The JSON shows the intended model, fallback, or approval values.
- **Paused state.** Run `$V eval home-manager.users.moka.services.hermes-agent.hermesHomeFiles builtins.attrNames`, which gives `[]`, and `$V ls .config/systemd/user | grep hermes`, which lists only `hermes-agent.service` and its `default.target.wants` link.
- **Profile config (when re-enabled).** Run `nix build --no-link --print-out-paths '.#nixosConfigurations.nixos.config.home-manager.users.moka.services.hermes-agent.hermesHomeFiles."profiles/news/config.yaml"'`, then `diff -u ~/.hermes/profiles/news/config.yaml <path>`. Use the same pattern for `jobs`. For `SOUL.md`, diff the live file against the repo file: `diff -u ~/.hermes/profiles/news/SOUL.md desktop/apps/agents/hermes-news-soul.md`.
- **Timer schedule (when re-enabled).** Run `$V file .config/systemd/user/hermes-news-digest.timer`. `OnCalendar=`, `RandomizedDelaySec=`, and `Persistent=true` hold the expected values.
- **Runtime (post-switch).** Run `systemctl --user is-active hermes-agent` and `systemctl --user list-timers 'hermes-*'` (no timers while paused). Read only. Don't start any unit.

## Gotchas

- Hermes profile files aren't `home.file` entries, so `$V ls` and `diff-live` don't see them. The `hermesAgentSetup` activation step copies them into `~/.hermes/` as real mode-600 files. Pausing the profiles doesn't delete files an earlier activation copied.
- The news/jobs oneshot units carry `ConditionPathExists` on the profile `.env`. Without the secret file they skip silently.
- Starting a unit to test it spends model quota, writes to the vault, and posts to Discord. Treat it as a production action.
- Model names aren't validated by the build. A typo builds fine and only fails at runtime.
- `terminal.backend = "docker"` applies only to the paused `news` and `jobs` profiles and uses podman's docker compatibility (`virtualisation.podman.dockerCompat` in `nixos/configuration.nix`). The gateway uses the `local` backend.
- The news digest and jobs verification post only when the reply has non-whitespace text. Both SOULs tell the model to reply with nothing when there is nothing to report.
- The gateway unit's `Environment` is `lib.mkForce`, so it replaces the module's list, and it points `OBSIDIAN_VAULT_PATH` at `study_vault`, not the career vault.
