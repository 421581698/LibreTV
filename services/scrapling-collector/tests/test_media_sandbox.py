from __future__ import annotations

import json
import unittest
from pathlib import Path


class MediaSandboxPolicyTests(unittest.TestCase):
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
