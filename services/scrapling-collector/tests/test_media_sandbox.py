from __future__ import annotations

import json
import unittest
from pathlib import Path


class MediaSandboxPolicyTests(unittest.TestCase):
    def test_browser_playback_uses_dedicated_fixture_secrets(self):
        harness = Path(__file__).with_name("browser_playback_acceptance.py").read_text(encoding="utf-8")
        self.assertIn('os.environ.get("BROWSER_MEDIA_ACCEPTANCE_URL"', harness)
        self.assertIn('os.environ.get("BROWSER_MEDIA_ACCEPTANCE_ALLOWED_HOSTS"', harness)
        self.assertNotIn('os.environ.get("MEDIA_ACCEPTANCE_URL"', harness)
        self.assertNotIn('os.environ.get("MEDIA_ACCEPTANCE_ALLOWED_HOSTS"', harness)

    def test_workflows_pass_dedicated_browser_fixture_environment(self):
        repository_root = Path(__file__).resolve().parents[2]
        workflow_paths = [
            repository_root / ".github/workflows/scrapling-collector.yml",
            repository_root / ".github/workflows/collector-live-acceptance.yml",
        ]
        for workflow_path in workflow_paths:
            workflow = workflow_path.read_text(encoding="utf-8")
            self.assertIn('-e BROWSER_MEDIA_ACCEPTANCE_URL=', workflow)
            self.assertIn('-e BROWSER_MEDIA_ACCEPTANCE_ALLOWED_HOSTS=', workflow)
            self.assertNotIn('-e MEDIA_ACCEPTANCE_URL="$BROWSER_MEDIA_ACCEPTANCE_URL"', workflow)
            self.assertNotIn('-e MEDIA_ACCEPTANCE_ALLOWED_HOSTS="$BROWSER_MEDIA_ACCEPTANCE_ALLOWED_HOSTS"', workflow)

    def test_probe_seccomp_profile_denies_socket_creation_and_io(self):
        profile_path = Path(__file__).resolve().parents[1] / "seccomp-no-socket.json"
        profile = json.loads(profile_path.read_text(encoding="utf-8"))
        denied = {
            name
            for rule in profile.get("syscalls", [])
            if rule.get("action") == "SCMP_ACT_ERRNO"
            for name in rule.get("names", [])
        }
        self.assertEqual(profile.get("defaultAction"), "SCMP_ACT_ALLOW")
        self.assertTrue({"socket", "socketcall", "socketpair", "connect", "bind", "listen", "accept", "accept4"}.issubset(denied))
        self.assertTrue({"sendto", "recvfrom", "sendmsg", "recvmsg", "shutdown"}.issubset(denied))


if __name__ == "__main__":
    unittest.main()
