import sqlite3
import unittest
import json
from stats import build_stats, resolution_bucket

class ResourceStatsTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.db.row_factory = sqlite3.Row
        self.db.executescript("""
          CREATE TABLE sites(host TEXT PRIMARY KEY,title TEXT,url TEXT,directory TEXT,discovered_at INTEGER);
          CREATE TABLE tasks(id TEXT PRIMARY KEY,host TEXT,status TEXT,created_at INTEGER,updated_at INTEGER,error TEXT,result_count INTEGER,pages_scheduled INTEGER DEFAULT 0,pages_visited INTEGER DEFAULT 0,pages_failed INTEGER DEFAULT 0,pages_changed INTEGER DEFAULT 0,pages_unchanged INTEGER DEFAULT 0);
          CREATE TABLE candidates(id TEXT PRIMARY KEY,task_id TEXT,url TEXT,host TEXT,kind TEXT,title TEXT,status TEXT,access_state TEXT,created_at INTEGER,quality_evidence TEXT,playback_verification TEXT);
          CREATE TABLE collector_jobs(id TEXT PRIMARY KEY,job_type TEXT,status TEXT,attempt INTEGER,max_attempts INTEGER,error TEXT,created_at INTEGER,updated_at INTEGER);
          CREATE TABLE playback_quality_samples(id TEXT PRIMARY KEY,host TEXT,sample_source TEXT,media_type TEXT,observed_seconds INTEGER,progressed_seconds REAL,decoded_width INTEGER,decoded_height INTEGER,selected_rendition_height INTEGER,selected_rendition_bitrate_kbps REAL,created_at INTEGER);
        """)
        self.db.execute("INSERT INTO collector_jobs VALUES(?,?,?,?,?,?,?,?)", ("job-1","crawl","queued",0,4,None,100,100))
        self.db.execute("INSERT INTO playback_quality_samples VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                        ("sample-1","media.example","player","hls",5,4,3840,2160,2160,8500,111))
        self.db.execute("INSERT INTO sites VALUES(?,?,?,?,?)", ("media.example","Media","https://media.example","FMHY / Movies",100))
        self.db.execute("INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?,?,?,?,?)", ("task-1","media.example","completed",100,110,None,2,3,2,1,1,1))
        self.db.execute("INSERT INTO candidates VALUES(?,?,?,?,?,?,?,?,?,?,?)", (
            "candidate-1","task-1","https://media.example/a.m3u8?token=secret","media.example",
            "direct-media","Film A","validated","PUBLIC",105,"{}",
            json.dumps({"state":"PLAYER_CONFIRMED","decoded_width":3840,"decoded_height":2160,
                        "observed_seconds":5,"progressed_seconds":4,"selected_rendition_bitrate_kbps":8500})
        ))
        self.db.execute("INSERT INTO candidates VALUES(?,?,?,?,?,?,?,?,?,?,?)", (
            "candidate-2","task-1","https://media.example/b.mp4","media.example",
            "direct-media","Film B","validated","PUBLIC",106,"{}","{}"
        ))

    def tearDown(self): self.db.close()

    def test_resolution_buckets_use_decoded_dimensions(self):
        self.assertEqual(resolution_bucket(3840,2160),"4K")
        self.assertEqual(resolution_bucket(1920,1080),"1080P")
        self.assertEqual(resolution_bucket(3840,1080),"1080P")
        self.assertEqual(resolution_bucket(7680,2160),"4K")
        self.assertEqual(resolution_bucket(2160,3840),"4K")
        self.assertEqual(resolution_bucket(3840,2000),"4K")
        self.assertEqual(resolution_bucket(3840,1600),"4K")
        self.assertEqual(resolution_bucket(4096,1716),"4K")
        self.assertEqual(resolution_bucket(3200,1800),"2K")
        self.assertEqual(resolution_bucket(2560,1600),"2K")
        self.assertEqual(resolution_bucket(2560,1440),"2K")
        self.assertEqual(resolution_bucket(2160,3840),"4K")
        self.assertEqual(resolution_bucket(7680,4320),"8K")
        self.assertEqual(resolution_bucket(0,0),"未知")

    def test_stats_distinguish_candidate_preflight_and_playback(self):
        result = build_stats(self.db)
        summary = result["summary"]
        self.assertEqual(summary["discovered_sites"],1)
        self.assertEqual(summary["video_candidates"],2)
        self.assertEqual(summary["preflight_passed"],2)
        self.assertEqual(summary["playback_confirmed"],1)
        self.assertEqual(summary["actual_quality"]["4K"],1)
        self.assertEqual(summary["playback_samples"],1)
        self.assertIsNotNone(result["sites"][0]["quality_score"])
        self.assertEqual(result["sites"][0]["quality_score_state"],"preliminary")
        self.assertEqual(summary["queue_jobs"]["queued"],1)
        self.assertEqual(summary["pages_visited"],2)
        self.assertEqual(summary["pages_failed"],1)
        self.assertEqual(summary["pages_changed"],1)
        self.assertEqual(result["sites"][0]["health_status"],"healthy")

    def test_candidate_breakdown_reports_extractor_kind_and_access_state(self):
        self.db.execute("ALTER TABLE candidates ADD COLUMN collected_by TEXT NOT NULL DEFAULT '[]'")
        self.db.execute("UPDATE candidates SET collected_by=? WHERE id=?",
                        (json.dumps(["spider", "browser"]), "candidate-1"))
        self.db.execute("UPDATE candidates SET collected_by=? WHERE id=?",
                        (json.dumps(["browser"]), "candidate-2"))
        result = build_stats(self.db)["summary"]
        self.assertEqual(result["candidate_records"], 2)
        self.assertEqual(result["candidate_kinds"]["direct-media"], 2)
        self.assertEqual(result["candidate_access_states"]["PUBLIC"], 2)
        self.assertEqual(result["candidate_collectors"]["spider"], 1)
        self.assertEqual(result["candidate_collectors"]["browser"], 2)
        self.assertEqual(result["candidate_collectors"]["unknown"], 0)

    def test_collector_preview_samples_do_not_count_as_real_playback(self):
        self.db.execute("INSERT INTO playback_quality_samples VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                        ("preview-1","media.example","collector_preview","hls",20,20,3840,2160,2160,12000,112))
        result = build_stats(self.db)
        site = result["sites"][0]
        self.assertEqual(site["playback_samples"],1)
        self.assertEqual(site["preview_samples"],1)
        self.assertEqual(site["actual_quality"]["4K"],1)
        self.assertIsNotNone(site["quality_score"])
        self.assertEqual(site["quality_score_state"],"preliminary")
        self.assertEqual(result["summary"]["playback_samples"],1)

    def test_quality_score_requires_three_real_playback_samples(self):
        self.db.execute(
            "UPDATE candidates SET playback_verification=? WHERE id=?",
            (json.dumps({"state":"PLAYER_CONFIRMED","decoded_width":1920,"decoded_height":1080,
                         "observed_seconds":5,"progressed_seconds":4,"selected_rendition_bitrate_kbps":4500}),
             "candidate-2")
        )
        self.db.execute("INSERT INTO candidates VALUES(?,?,?,?,?,?,?,?,?,?,?)", (
            "candidate-3","task-1","https://media.example/c.mp4","media.example",
            "direct-media","Film C","validated","PUBLIC",107,"{}",
            json.dumps({"state":"PLAYER_CONFIRMED","decoded_width":1280,"decoded_height":720,
                        "observed_seconds":5,"progressed_seconds":4,"selected_rendition_bitrate_kbps":2500})
        ))
        self.db.execute("INSERT OR REPLACE INTO playback_quality_samples VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                        ("quality-sample-2","media.example","player","mp4",5,4,1920,1080,1080,4500,112))
        self.db.execute("INSERT OR REPLACE INTO playback_quality_samples VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                        ("quality-sample-3","media.example","player","mp4",5,4,1280,720,720,2500,113))
        result = build_stats(self.db)
        self.assertIsNotNone(result["sites"][0]["quality_score"])
        self.assertEqual(result["sites"][0]["playback_samples"],3)
        self.assertEqual(result["summary"]["quality_ranking"][0]["host"],"media.example")
        self.assertEqual(result["sites"][0]["quality_score_state"],"scored")

    def test_site_detail_does_not_expose_media_urls_or_tokens(self):
        result = build_stats(self.db,"media.example")
        self.assertEqual(result["site"]["host"],"media.example")
        self.assertNotIn("url",result["recent_resources"][0])
        self.assertNotIn("secret",json.dumps(result))

    def test_duplicate_query_variants_count_once(self):
        self.db.execute("INSERT INTO candidates VALUES(?,?,?,?,?,?,?,?,?,?,?)", (
            "candidate-3","task-1","https://media.example/a.m3u8?token=rotated","media.example",
            "direct-media","Film A","validated","PUBLIC",108,"{}","{}"
        ))
        result = build_stats(self.db)
        self.assertEqual(result["summary"]["video_candidates"],2)

if __name__ == "__main__": unittest.main()
