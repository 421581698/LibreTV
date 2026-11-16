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

    def test_html_sanitizer_removes_scripts_forms_and_sensitive_attributes(self):
        source = '<html><script>secret()</script><form><input value="private"></form><a id="play" class="media" href="https://x/?token=secret" onclick="run()">Watch</a></html>'
        cleaned = ai_rules.sanitize_html_sample(source)
        self.assertNotIn("secret", cleaned)
        self.assertNotIn("onclick", cleaned)
        self.assertNotIn("href=", cleaned)
        self.assertIn('class="media"', cleaned)
        self.assertIn('id="play"', cleaned)
        self.assertIn("Watch", cleaned)

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
