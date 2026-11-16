import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

os.environ.setdefault("SCRAPLING_API_TOKEN", "collector-ai-worker-test-token")
os.environ.setdefault("SCRAPLING_DB_PATH", str(Path(tempfile.gettempdir()) / "collector-ai-worker-test.sqlite3"))

import worker


class WorkerAIRuleTests(unittest.TestCase):
    def _run_crawl(self, active_rule=None, configured=True, spider_status="completed", candidate_count=0):
        payload = {"url": "https://catalog.example/", "mode": "http", "limit": 101}
        checkpoint = []
        with (
            patch.object(worker, "require_egress_firewall"),
            patch.object(worker, "crawl_site", return_value={
                "task_id": "task-ai-test",
                "diagnostics": {"http_spider": {"status": spider_status, "candidate_count": candidate_count}},
                "count": 0,
            }),
            patch.object(worker, "task_candidates", return_value={"candidates": []}),
            patch.object(worker, "task_page_sample", return_value="<html><a class='media'>watch</a></html>"),
            patch.object(worker.ai_rules, "is_configured", return_value=configured),
            patch.object(worker.ai_rules, "get_active_rule", return_value=active_rule),
            patch.object(worker, "submit_job", return_value={"id": "rule-job-1", "status": "queued"}) as submit,
        ):
            result = worker.handle(payload, lambda value: checkpoint.append(value) or True, lambda: False)
        return result, submit, checkpoint

    def test_initial_crawl_automatically_enqueues_rule_generation_when_gateway_is_configured(self):
        _, submit, checkpoint = self._run_crawl()
        submit.assert_called_once()
        args = submit.call_args.args
        self.assertEqual(args[0], "rule_generate")
        self.assertEqual(args[1]["host"], "catalog.example")
        self.assertEqual(args[1]["task_id"], "task-ai-test")
        self.assertEqual(args[1]["fixtures"], [args[1]["page_html"]])
        self.assertTrue(any(item.get("stage") == "ai_rule_job_enqueued" for item in checkpoint))

    def test_selector_miss_automatically_enqueues_repair_for_active_rule(self):
        active = {"version": 2, "rules": {"selectors": {"media": ".old"}}}
        _, submit, _ = self._run_crawl(active_rule=active)
        self.assertEqual(submit.call_args.args[0], "rule_repair")

    def test_no_model_gateway_means_no_ai_job_is_enqueued(self):
        _, submit, _ = self._run_crawl(configured=False)
        submit.assert_not_called()


if __name__ == "__main__":
    unittest.main()
