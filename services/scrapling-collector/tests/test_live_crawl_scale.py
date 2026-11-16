import unittest

from live_crawl_scale import summarize_results


class LiveCrawlScaleTests(unittest.TestCase):
    def _result(self, job_id, pages=1, candidates=1, status="succeeded"):
        return {
            "id": job_id,
            "status": status,
            "result": {
                "pages_visited": pages,
                "count": candidates,
            },
        }

    def test_pass_requires_every_job_to_cover_at_least_one_page(self):
        report = summarize_results(
            [self._result("job-a"), self._result("job-b")],
            2,
            "run-1",
            ["job-a", "job-b"],
        )
        self.assertEqual(report["status"], "passed")
        self.assertTrue(report["job_coverage_ok"])
        self.assertTrue(report["page_coverage_ok"])
        self.assertEqual(report["observed_pages_visited"], 2)

    def test_aggregate_page_count_cannot_hide_a_job_with_zero_pages(self):
        report = summarize_results(
            [
                self._result("job-a", pages=0, candidates=0),
                self._result("job-b", pages=2, candidates=1),
            ],
            2,
            "run-2",
            ["job-a", "job-b"],
        )
        self.assertEqual(report["status"], "incomplete_or_failed")
        self.assertFalse(report["page_coverage_ok"])
        self.assertEqual(report["jobs_without_page_coverage"], ["job-a"])

    def test_duplicate_or_missing_job_status_records_fail_coverage(self):
        report = summarize_results(
            [self._result("job-a"), self._result("job-a")],
            2,
            "run-3",
            ["job-a", "job-b"],
        )
        self.assertEqual(report["status"], "incomplete_or_failed")
        self.assertFalse(report["job_coverage_ok"])
        self.assertEqual(report["duplicate_job_count"], 1)
        self.assertEqual(report["missing_job_ids"], ["job-b"])

    def test_failed_or_unfinished_jobs_cannot_pass(self):
        failed = summarize_results(
            [
                self._result("job-a"),
                {"id": "job-b", "status": "failed", "result": None},
            ],
            2,
            "run-4",
            ["job-a", "job-b"],
        )
        self.assertEqual(failed["status"], "incomplete_or_failed")
        self.assertEqual(failed["failed_or_cancelled_jobs"], 1)

        unfinished = summarize_results(
            [self._result("job-a"), {"id": "job-b", "status": "running", "result": None}],
            2,
            "run-5",
            ["job-a", "job-b"],
        )
        self.assertEqual(unfinished["status"], "incomplete_or_failed")
        self.assertEqual(unfinished["unfinished_jobs"], 1)

    def test_malformed_metrics_are_treated_as_zero_not_accepted(self):
        report = summarize_results(
            [{"id": "job-a", "status": "succeeded", "result": "{bad-json"}],
            1,
            "run-6",
            ["job-a"],
        )
        self.assertEqual(report["status"], "incomplete_or_failed")
        self.assertFalse(report["page_coverage_ok"])
        self.assertFalse(report["candidate_yield_ok"])


if __name__ == "__main__":
    unittest.main()
