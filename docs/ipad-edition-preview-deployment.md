# iPad Edition Preview Deployment

The complete iPad product branch is deployed through the isolated Cloudflare Worker workflow at `.github/workflows/deploy-ipad-edition-preview.yml`.

This deployment is intentionally scoped to the iPad Edition Preview Worker and does not publish to the production Worker or include the separate iPhone product branch.
