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
          CREATE TABLE tasks(id TEXT PRIMARY KEY,host TEXT,status TEXT,created_at INTEGER,updated_at INTEGER,error TEXT,result_count INTEGER);
          CREATE TABLE candidates(id TEXT PRIMARY KEY,task_id TEXT,url TEXT,host TEXT,kind TEXT,title TEXT,status TEXT,access_state TEXT,created_at INTEGER,quality_evidence TEXT,playback_verification TEXT);
        """)
        self.db.execute("INSERT INTO sites VALUES(?,?,?,?,?)", ("media.example","Media","https://media.example","FMHY / Movies",100))
        self.db.execute("INSERT INTO tasks VALUES(?,?,?,?,?,?,?)", ("task-1","media.example","completed",100,110,None,2))
        self.db.execute("INSERT INTO candidates VALUES(?,?,?,?,?,?,?,?,?,?,?)", (
            "candidate-1","task-1","https://media.example/a.m3u8?token=secret","media.example",
            "direct-media","Film A","validated","PUBLIC",105,"{}",
            json.dumps({"state":"PLAYER_CONFIRMED","decoded_width":3840,"decoded_height":2160})
        ))
        self.db.execute("INSERT INTO candidates VALUES(?,?,?,?,?,?,?,?,?,?,?)", (
            "candidate-2","task-1","https://media.example/b.mp4","media.example",
            "direct-media","Film B","validated","PUBLIC",106,"{}","{}"
        ))

    def tearDown(self): self.db.close()

    def test_resolution_buckets_use_decoded_dimensions(self):
        self.assertEqual(resolution_bucket(3840,2160),"4K")
        self.assertEqual(resolution_bucket(1920,1080),"1080P")
        self.assertEqual(resolution_bucket(0,0),"未知")

    def test_stats_distinguish_candidate_preflight_and_playback(self):
        result = build_stats(self.db)
        summary = result["summary"]
        self.assertEqual(summary["discovered_sites"],1)
        self.assertEqual(summary["video_candidates"],2)
        self.assertEqual(summary["preflight_passed"],2)
        self.assertEqual(summary["playback_confirmed"],1)
        self.assertEqual(summary["actual_quality"]["4K"],1)

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
