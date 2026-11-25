# Upstream Scrapling baseline

LibreTV uses the upstream Scrapling package as a dependency; it does not copy or maintain a private fork of the framework.

- Upstream repository: https://github.com/D4Vinci/Scrapling
- Requested upstream snapshot: `8864137216e652d9e859223181ef141d34ff1386`
- Snapshot date/message: 2026-11-23, `docs: remove a sponsor`
- Runtime package version: `scrapling[fetchers]==0.5.1`
- Published package provenance commit: `3a4bb5b0a008233c85269a0a38a6d08edd4ce329`
- PyPI wheel SHA-256: `c9eb0ef22a05e00e19827a179544fea2bc91b663585f637d428453d3b00ceb17`
- License: BSD-3-Clause
- Target runtime: Linux x86_64, CPython 3.12.11, installed with uv.

The requested 2026-11-23 commit is seven commits ahead of the 0.5.1 release commit. Comparing those commits shows changes limited to documentation, sponsor assets, and a stale-issue workflow; no Scrapling Python package source files changed. Therefore the pinned 0.5.1 wheel is the matching published runtime artifact for this source snapshot, while the exact requested commit is retained here as provenance.

The collector installs the `fetchers` extra because its runtime imports `scrapling.fetchers` and `scrapling.spiders`. Browser binaries are installed during the image build with `scrapling install`.

Install dependencies in this service with:

```sh
uv pip install --system -r requirements.txt
```

The upstream package supports Python 3.12. The collector CI verifies x86_64, CPython 3.12.11, the exact Scrapling package version, and the fetcher/spider imports before running the service tests.
