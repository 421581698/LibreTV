# AI Workspace — Free Claude Code

This directory is an **independent service project** hosted in the LibreTV repository.
It is not part of the LibreTV Next.js application and is not mounted into the video
player, Friday V3, or the existing navigation.

## Separation boundary

- Separate container/process and persistent data directory.
- Separate hostname and deployment target (for example, `ai.example.com`).
- No imports from LibreTV application code and no shared runtime state.
- No changes to the LibreTV routes, UI, player, Friday V3, or Cloudflare Worker.
- The LibreTV site may later link to this service, but does not proxy its terminal,
  browser sessions, or model-provider credentials.

## Upstream

The service is built from the upstream
[Alishahryar1/free-claude-code](https://github.com/Alishahryar1/free-claude-code)
project. The upstream snapshot is pinned in `UPSTREAM_REF` and is licensed
AGPL-3.0-only. This directory contains deployment/integration glue, not a copied
or rewritten version of the upstream application.

Before distributing a modified upstream build, preserve its notices, provide the
Corresponding Source as required by AGPL-3.0, and display the required legal notices
in interactive interfaces. Review the upstream license and all provider terms.

## Current status

This is the isolated deployment scaffold. The container build contract is defined,
but a public deployment is **not enabled** by this commit. Before exposing the
browser/admin UI, complete and test the upstream server's bind/port configuration,
persistent FCC config location, authentication, reverse-proxy headers, and
container runtime isolation.

## Security requirements before public deployment

1. Put the service behind HTTPS and an access-control layer (SSO or strong
   authentication); do not expose an unauthenticated admin or coding session.
2. Keep provider credentials in the deployment secret manager or private runtime
   environment. Never put keys in this repository, browser code, build args, or
   image layers.
3. Run coding agents in disposable, non-root workspaces with CPU/memory/time
   limits, restricted filesystem mounts, and controlled outbound network access.
4. Do not mount the LibreTV source tree or production secrets into agent sessions.
5. Persist only the FCC configuration/workspaces that are intentionally retained;
   back them up and define retention/deletion policy.
6. Verify the upstream's supported remote/browser deployment mode before routing
   internet traffic to it.

## Local build

From the repository root:

```sh
docker build -f ai-workspace/Dockerfile -t libretv-ai-workspace .
```

Run only in a trusted development environment until the public-deployment
requirements above have been completed. The upstream server's actual bind address,
port, and data directory must be configured according to the pinned upstream
release; this scaffold intentionally does not guess those settings.

## Files

- `Dockerfile`: reproducible build from the pinned upstream source.
- `UPSTREAM_REF`: exact upstream commit used by the build.
- `.env.example`: non-secret build/deployment metadata only.
- `SECURITY.md`: deployment security checklist.
