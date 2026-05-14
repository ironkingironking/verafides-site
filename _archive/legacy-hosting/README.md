# Legacy hosting archive

These files were kept for reference after moving verafides.ch to the GitHub-to-self-hosted deployment flow.

Active flow:

1. Decap CMS writes changes to `main` through the GitHub backend.
2. The production server runs `systemd/verafides-deploy-poll.timer`.
3. The timer calls `scripts/deploy-if-changed.sh`, which fast-forwards `/var/www/verafides` to `origin/main` and rebuilds Hugo.

Archived files here are not used by the active production path. They are retained only to preserve history while keeping the project root focused on the current deployment setup.
