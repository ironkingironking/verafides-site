# Legacy hosting archive

These files were kept for reference after moving verafides.ch to the GitHub-to-self-hosted deployment flow.

Active flow:

1. Decap CMS writes changes to `main` through the GitHub backend.
2. `.github/workflows/verafides-deploy.yml` runs on pushes to `main`.
3. The workflow calls `https://verafides.ch/api/deploy/verafides/$VERAFIDES_DEPLOY_TOKEN`.
4. `api/server.js` updates `/var/www/verafides` with a fast-forward merge and rebuilds the Hugo site.

The `scripts/deploy-if-changed.sh` script and `systemd/` files are retained as inactive fallback options for a server-side polling deploy.

Archived files here are not used by the active production path. They are retained only to preserve history while keeping the project root focused on the current deployment setup.
