# iPad Edition Preview Deployment

The isolated iPad Edition Preview Worker is a deployment target, not an automatically deployed environment. The workflow at `.github/workflows/deploy-ipad-edition-preview.yml` does not deploy on `push`.

A Preview deployment requires a manual `workflow_dispatch` on `feature/libretv-ipad-edition-product` with `confirm_preview_deploy=yes`. The workflow then requires a successful iPad Edition Verify run for the exact same commit, the configured Cloudflare Preview credentials, and a successful route smoke test and simulated Chromium visual audit.

The workflow targets only the dedicated iPad Edition Preview Worker. It does not publish to the production Worker. Until a successful deployment run and its artifacts are recorded for the current commit, Preview availability and visual acceptance must be reported as **not verified**. Simulated Chromium results do not replace physical iPad Safari acceptance.
