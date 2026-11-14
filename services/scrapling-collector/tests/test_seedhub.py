import unittest

from seedhub import parse_catalog_html, parse_detail_html


class SeedHubCatalogParserTests(unittest.TestCase):
    def test_extracts_only_seedhub_title_pages_and_poster(self):
        html = """
        <a href="/movies/130096/"><img data-src="https://www.seedhub.cc/posters/a.jpg"><span>生化危机：爆发夜</span></a>
        <a href="https://evil.example/movies/2/">Ignore me</a>
        <a href="/share/magnet-link/">Do not index shares</a>
        """
        items = parse_catalog_html(html, "https://www.seedhub.cc/categories/1/movies/", "movies")
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["title"], "生化危机：爆发夜")
        self.assertEqual(items[0]["source_url"], "https://www.seedhub.cc/movies/130096/")
        self.assertEqual(items[0]["poster_url"], "https://www.seedhub.cc/posters/a.jpg")
        self.assertNotIn("magnet", items[0]["source_url"])

    def test_rejects_untrusted_page_origin(self):
        with self.assertRaises(ValueError):
            parse_catalog_html('<a href="/movies/1/">Title</a>', "https://evil.example/", "movies")

    def test_rejects_unknown_category(self):
        with self.assertRaises(ValueError):
            parse_catalog_html('<a href="/movies/1/">Title</a>', "https://www.seedhub.cc/", "torrent")


class SeedHubDetailParserTests(unittest.TestCase):
    def test_extracts_title_description_poster_and_stills_without_outbound_links(self):
        html = """
        <html><head>
          <meta property="og:title" content="生化危机：爆发夜 Resident Evil - SeedHub">
          <meta property="og:image" content="https://sh1.pcie.pppoe.top/poster.jpg">
        </head><body>
          <h1>生化危机：爆发夜</h1>
          <div>导演：扎克·克雷格</div><div>编剧：谢伊·哈顿</div>
          <div>主演：奥斯汀·艾布拉姆斯 / 保罗·沃尔特·豪泽</div>
          <div>类型：恐怖 / 惊悚 / 科幻</div>
          <div>制片国家/地区：美国</div><div>语言：英语</div>
          <div>首播：2026-09-16</div><div>集数：1</div><div>单集片长：90分钟</div>
          <h2>生化危机：爆发夜的简介</h2><p>故事聚焦医疗速递员布莱恩，意外深陷病毒浩劫。</p>
          <h2>生化危机：爆发夜的图片</h2>
          <img alt="点击查看图片" src="https://sh1.pcie.pppoe.top/still-1.jpg">
          <a href="https://files.example/share/secret">外部资源链接</a>
        </body></html>
        """
        result = parse_detail_html(html, "https://www.seedhub.cc/movies/130096/")
        self.assertEqual(result["title"], "生化危机：爆发夜 Resident Evil")
        self.assertIn("医疗速递员布莱恩", result["description"])
        self.assertEqual(result["metadata"]["director"], "扎克·克雷格")
        self.assertEqual(result["metadata"]["writers"], "谢伊·哈顿")
        self.assertEqual(result["metadata"]["episode_count"], "1")
        self.assertEqual(result["metadata"]["runtime"], "90分钟")
        self.assertEqual(result["poster_url"], "https://sh1.pcie.pppoe.top/poster.jpg")
        self.assertEqual(result["still_urls"], ["https://sh1.pcie.pppoe.top/still-1.jpg"])
        self.assertFalse(result["external_resource_links_extracted"])
        self.assertNotIn("files.example", str(result))

    def test_rejects_non_seedhub_or_non_detail_urls(self):
        for url in (
            "https://evil.example/movies/130096/",
            "https://www.seedhub.cc/categories/1/movies/",
            "http://www.seedhub.cc/movies/130096/",
        ):
            with self.subTest(url=url), self.assertRaises(ValueError):
                parse_detail_html("<h1>Title</h1>", url)


if __name__ == "__main__":
    unittest.main()
