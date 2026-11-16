import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

os.environ.setdefault("SCRAPLING_API_TOKEN", "collector-ai-rule-test-token")

import ai_rules


class AIRuleTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.original = ai_rules.DB_PATH
        ai_rules.DB_PATH = str(Path(self.temp.name) / "rules.sqlite3")
        ai_rules.initialize()

    def tearDown(self):
        ai_rules.DB_PATH = self.original
        self.temp.cleanup()

    def test_rules_reject_code_urls_and_complex_selectors(self):
        for rules in (
            {"selectors": {"media": "a[href^='javascript:']"}},
            {"selectors": {"media": "div > a"}},
            {"selectors": {"media": "a", "unknown": ".x"}},
            {"selectors": {"media": "a"}, "exec": "import os"},
        ):
            with self.assertRaises(ValueError):
                ai_rules.validate_rules(rules)

    def test_fixture_validation_requires_matching_selector(self):
        rules = {"selectors": {"media": "a.media"}}
        passed, total = ai_rules.validate_fixtures(
            rules, ['<a class="media" href="/movie.mp4">play</a>', "<div>nothing</div>"]
        )
        self.assertEqual((passed, total), (1, 2))

    def test_unvalidated_rules_remain_draft_and_do_not_replace_active_version(self):
        active = ai_rules.save_version(
            "catalog.example", {"selectors": {"media": "a.media"}}, "test",
            ['<a class="media"></a>']
        )
        self.assertEqual(active["status"], "active")
        draft = ai_rules.save_version(
            "catalog.example", {"selectors": {"media": "video.player"}}, "ai",
            ["<div>no matching selector</div>"]
        )
        self.assertEqual(draft["status"], "draft")
        current = ai_rules.get_active_rule("catalog.example")
        self.assertEqual(current["version"], active["version"])
        self.assertEqual(current["rules"]["selectors"]["media"], "a.media")

    def test_partial_fixture_match_remains_draft_and_preserves_active_version(self):
        active = ai_rules.save_version(
            "partial-fixture.example", {"selectors": {"media": "a.media"}}, "test",
            ['<a class="media"></a>']
        )
        proposed = ai_rules.save_version(
            "partial-fixture.example", {"selectors": {"media": "video.player"}}, "ai",
            ['<video class="player"></video>', '<div class="different"></div>']
        )
        self.assertEqual(proposed["status"], "draft")
        self.assertEqual((proposed["fixture_passes"], proposed["fixture_total"]), (1, 2))
        self.assertEqual(ai_rules.get_active_rule("partial-fixture.example")["version"], active["version"])

    def test_title_only_fixture_match_cannot_activate_extraction_rule(self):
        result = ai_rules.save_version(
            "title-only.example", {"selectors": {"title": "h1"}}, "ai",
            ["<h1>Page title</h1>"]
        )
        self.assertEqual(result["status"], "draft")
        self.assertEqual((result["fixture_passes"], result["fixture_total"]), (0, 1))

    def test_version_increments_and_failure_diagnostic_is_recorded(self):
        first = ai_rules.save_version("site.example", {"selectors": {"title": "h1"}}, "manual")
        second = ai_rules.save_version("site.example", {"selectors": {"title": ".title"}}, "repair")
        self.assertEqual((first["version"], second["version"]), (1, 2))
        diagnostic = ai_rules.record_failure("site.example", "task-1", "selector_miss", {"count": 0})
        with ai_rules.connect() as connection:
            row = connection.execute(
                "SELECT host,failure_code,detail_json FROM collector_rule_diagnostics WHERE id=?",
                (diagnostic,),
            ).fetchone()
        self.assertEqual(row["host"], "site.example")
        self.assertEqual(row["failure_code"], "selector_miss")
        self.assertEqual(json.loads(row["detail_json"]), {"count": 0})

    def test_rule_version_history_and_validated_rollback_are_audited(self):
        first = ai_rules.save_version(
            "rollback.example", {"selectors": {"media": "a.old"}}, "manual",
            ['<a class="old"></a>'],
        )
        second = ai_rules.save_version(
            "rollback.example", {"selectors": {"media": "a.new"}}, "ai",
            ['<a class="new"></a>'],
        )
        history = ai_rules.list_versions("rollback.example")
        self.assertEqual([item["version"] for item in history], [2, 1])
        restored = ai_rules.activate_version("rollback.example", first["version"])
        self.assertEqual(restored["version"], first["version"])
        history_after_rollback = ai_rules.list_versions("rollback.example")
        self.assertTrue(next(item for item in history_after_rollback if item["version"] == first["version"])["is_active"])
        self.assertFalse(next(item for item in history_after_rollback if item["version"] == second["version"])["is_active"])
        with ai_rules.connect() as connection:
            event = connection.execute(
                "SELECT action,version,previous_version FROM collector_rule_events WHERE host=? ORDER BY created_at DESC LIMIT 1",
                ("rollback.example",),
            ).fetchone()
        self.assertEqual(event["action"], "rollback")
        self.assertEqual(event["version"], first["version"])
        audit = ai_rules.list_rule_events("rollback.example")
        self.assertEqual(audit[0]["action"], "rollback")
        self.assertEqual(audit[0]["version"], first["version"])
        self.assertEqual(audit[0]["previous_version"], second["version"])
        self.assertEqual(second["status"], "active")

    def test_rule_event_schema_additively_migrates_previous_version(self):
        with ai_rules.connect() as connection:
            connection.execute("DROP TABLE collector_rule_events")
            connection.execute("""CREATE TABLE collector_rule_events (
                id TEXT PRIMARY KEY, host TEXT NOT NULL, version INTEGER NOT NULL,
                action TEXT NOT NULL, created_at INTEGER NOT NULL
            )""")
        ai_rules.initialize()
        with ai_rules.connect() as connection:
            columns = {
                row[1] for row in connection.execute(
                    "PRAGMA table_info(collector_rule_events)"
                ).fetchall()
            }
        self.assertIn("previous_version", columns)

    def test_draft_rule_version_cannot_be_activated(self):
        draft = ai_rules.save_version(
            "draft-rollback.example", {"selectors": {"media": "video.missing"}}, "ai",
            ["<div>no media selector</div>"],
        )
        self.assertEqual(draft["status"], "draft")
        with self.assertRaises(ValueError):
            ai_rules.activate_version("draft-rollback.example", draft["version"])

    def test_failure_diagnostics_are_queryable_with_repair_link(self):
        diagnostic = ai_rules.record_failure(
            "diagnostics.example", "task-9", "selector_miss", {"candidate_count": 0}
        )
        repaired = ai_rules.save_version(
            "diagnostics.example", {"selectors": {"media": "a.media"}}, "ai",
            ['<a class="media"></a>'],
        )
        ai_rules.link_diagnostic_version(diagnostic, repaired["version"])
        records = ai_rules.list_diagnostics("diagnostics.example")
        self.assertEqual(records[0]["id"], diagnostic)
        self.assertEqual(records[0]["detail"], {"candidate_count": 0})
        self.assertEqual(records[0]["repair_version"], repaired["version"])

    def test_html_sanitizer_removes_scripts_forms_and_sensitive_attributes(self):
        source = '<html><script>secret()</script><form><input value="private"></form><a id="play" class="media" href="https://x/?token=secret" onclick="run()">Watch</a></html>'
        cleaned = ai_rules.sanitize_html_sample(source)
        self.assertNotIn("secret", cleaned)
        self.assertNotIn("onclick", cleaned)
        self.assertNotIn("href=", cleaned)
        self.assertIn('class="media"', cleaned)
        self.assertIn('id="play"', cleaned)
        self.assertIn("Watch", cleaned)

    def test_repair_links_existing_crawl_diagnostic_to_new_rule_version(self):
        diagnostic = ai_rules.record_failure("catalog.example", "task-2", "selector_miss")
        with patch.object(
            ai_rules, "generate_rules",
            return_value={"selectors": {"media": "a.media"}, "notes": "fixture repair"},
        ):
            result = ai_rules.diagnose_and_repair(
                "catalog.example",
                '<a class="media">Watch</a>',
                "selector_miss",
                "task-2",
                ['<a class="media">Watch</a>'],
                diagnostic,
            )
        with ai_rules.connect() as connection:
            row = connection.execute(
                "SELECT repair_version FROM collector_rule_diagnostics WHERE id=?",
                (diagnostic,),
            ).fetchone()
        self.assertEqual(result["diagnostic_id"], diagnostic)
        self.assertEqual(row["repair_version"], result["repair"]["version"])

    def test_generate_rules_sends_sanitized_json_contract_to_gateway(self):
        response_body = json.dumps({
            "choices": [{"message": {"content": json.dumps({
                "selectors": {"media": "a.media-card"},
                "notes": "fixture matched",
            })}}],
        }).encode("utf-8")

        class FakeResponse:
            status = 200
            def __enter__(self):
                return self
            def __exit__(self, *_args):
                return False
            def read(self, _limit):
                return response_body

        class FakeOpener:
            request = None
            def open(self, request, timeout):
                self.request = request
                self.timeout = timeout
                return FakeResponse()

        captured = {}
        def fake_post(endpoint, key, body):
            captured.update(endpoint=endpoint, key=key, body=body)
            return response_body
        with patch.object(
            ai_rules, "_model_endpoint",
            return_value=("https://llm.example/v1/chat/completions", "secret-key", "test-model"),
        ), patch.object(ai_rules, "_post_model_request", side_effect=fake_post):
            result = ai_rules.generate_rules(
                "catalog.example",
                '<script>do-not-send()</script><a class="media-card" href="https://x/?token=secret">Watch</a>',
                {"failure_code": "selector_miss"},
            )

        self.assertEqual(result["selectors"]["media"], "a.media-card")
        self.assertEqual(captured["endpoint"], "https://llm.example/v1/chat/completions")
        self.assertEqual(captured["key"], "secret-key")
        sent = json.loads(captured["body"])
        self.assertEqual(sent["model"], "test-model")
        self.assertEqual(sent["response_format"], {"type": "json_object"})
        prompt = json.loads(sent["messages"][1]["content"])
        self.assertNotIn("do-not-send", prompt["html_sample"])
        self.assertNotIn("token=secret", prompt["html_sample"])
        self.assertEqual(prompt["diagnostics"]["failure_code"], "selector_miss")

    def test_gateway_dns_rejects_mixed_public_and_private_answers(self):
        with patch.object(ai_rules.socket, "getaddrinfo", return_value=[
            (2, 1, 6, "", ("93.184.216.34", 443)),
            (2, 1, 6, "", ("127.0.0.1", 443)),
        ]):
            with self.assertRaises(RuntimeError):
                ai_rules._resolve_gateway_ip("llm.example")

    def test_model_gateway_rejects_nonstandard_ports(self):
        with patch.dict(os.environ, {
            "COLLECTOR_AI_GATEWAY_URL": "https://llm.example:8443",
            "COLLECTOR_AI_API_KEY": "test",
            "COLLECTOR_AI_MODEL": "test-model",
            "COLLECTOR_AI_ALLOWED_HOSTS": "llm.example",
        }):
            with self.assertRaises(RuntimeError):
                ai_rules._model_endpoint()

    def test_model_gateway_requires_explicit_https_host_allowlist(self):
        with patch.dict(os.environ, {
            "COLLECTOR_AI_GATEWAY_URL": "https://llm.example",
            "COLLECTOR_AI_API_KEY": "test",
            "COLLECTOR_AI_MODEL": "test-model",
            "COLLECTOR_AI_ALLOWED_HOSTS": "other.example",
        }):
            with self.assertRaises(RuntimeError):
                ai_rules._model_endpoint()


if __name__ == "__main__":
    unittest.main()
