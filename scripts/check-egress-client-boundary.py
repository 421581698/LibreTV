#!/usr/bin/env python3
"""Fail CI when new direct outbound HTTP clients bypass reviewed adapters."""
from __future__ import annotations

import ast
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "scrapling-engine" / "app"
HTTPX_ADAPTERS = {"supervisor.py", "media_downloader.py"}
SCRAPLING_ADAPTERS = {"scraper.py", "spider.py", "robots.py"}
HTTP_CLIENT_ROOTS = {"httpx", "requests", "aiohttp", "urllib3"}


def inspect_file(path: Path) -> list[str]:
    source = path.read_text(encoding="utf-8")
    try:
        tree = ast.parse(source, filename=str(path))
    except SyntaxError as exc:
        return [f"{path.relative_to(ROOT)}:{exc.lineno}: cannot parse Python source: {exc.msg}"]

    relative = path.relative_to(APP)
    filename = relative.name
    errors: list[str] = []
    httpx_aliases: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                root = alias.name.split(".", 1)[0]
                if root in HTTP_CLIENT_ROOTS:
                    if root != "httpx" or filename not in HTTPX_ADAPTERS:
                        errors.append(
                            f"{relative}:{node.lineno}: direct {root} import is outside an approved adapter"
                        )
                    if root == "httpx":
                        httpx_aliases.add(alias.asname or root)
                if alias.name == "scrapling.fetchers":
                    if filename not in SCRAPLING_ADAPTERS:
                        errors.append(
                            f"{relative}:{node.lineno}: Scrapling network fetcher import is outside an approved adapter"
                        )
        elif isinstance(node, ast.ImportFrom):
            module = node.module or ""
            root = module.split(".", 1)[0]
            if root in HTTP_CLIENT_ROOTS:
                if root != "httpx" or filename not in HTTPX_ADAPTERS:
                    errors.append(
                        f"{relative}:{node.lineno}: direct {module} import is outside an approved adapter"
                    )
            if module == "scrapling.fetchers" and filename not in SCRAPLING_ADAPTERS:
                errors.append(
                    f"{relative}:{node.lineno}: Scrapling network fetcher import is outside an approved adapter"
                )
            if module == "httpx" and filename in HTTPX_ADAPTERS:
                httpx_aliases.update(alias.asname or alias.name for alias in node.names)
        elif isinstance(node, ast.Call):
            # Catch common dynamic-import escapes with literal module names.
            if isinstance(node.func, ast.Name) and node.func.id == "__import__" and node.args:
                arg = node.args[0]
                if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
                    if arg.value.split(".", 1)[0] in HTTP_CLIENT_ROOTS:
                        errors.append(f"{relative}:{node.lineno}: dynamic network-client import is forbidden")
            if (
                isinstance(node.func, ast.Attribute)
                and node.func.attr == "import_module"
                and node.args
                and isinstance(node.args[0], ast.Constant)
                and isinstance(node.args[0].value, str)
                and node.args[0].value.split(".", 1)[0] in HTTP_CLIENT_ROOTS
            ):
                errors.append(f"{relative}:{node.lineno}: dynamic network-client import is forbidden")

            call_name = None
            if isinstance(node.func, ast.Attribute) and isinstance(node.func.value, ast.Name):
                if node.func.value.id in httpx_aliases:
                    call_name = node.func.attr
            if call_name in {"Client", "AsyncClient"}:
                keywords = {item.arg: item.value for item in node.keywords if item.arg}
                trust_env = keywords.get("trust_env")
                proxy = keywords.get("proxy")
                if not isinstance(trust_env, ast.Constant) or trust_env.value is not False:
                    errors.append(
                        f"{relative}:{node.lineno}: httpx {call_name} must set trust_env=False"
                    )
                if proxy is None or (isinstance(proxy, ast.Constant) and proxy.value in (None, "")):
                    errors.append(
                        f"{relative}:{node.lineno}: httpx {call_name} must receive an explicit egress proxy"
                    )
    return errors


def main() -> int:
    errors: list[str] = []
    for path in sorted(APP.rglob("*.py")):
        errors.extend(inspect_file(path))
    if errors:
        print("Outbound-client boundary violations:", file=sys.stderr)
        print("\\n".join(f"- {error}" for error in errors), file=sys.stderr)
        return 1
    print("Outbound-client import boundary passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
