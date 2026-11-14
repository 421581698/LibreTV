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
          <meta property="og:description" content="电影简介">
          <meta property="og:image" content="https://sh1.pcie.pppoe.top/poster.jpg">
        </head><body>
          <h1>生化危机：爆发夜</h1>
          <img alt="点击查看图片" src="https://sh1.pcie.pppoe.top/still-1.jpg">
          <a href="https://files.example/share/secret">外部资源链接</a>
        </body></html>
        """
        result = parse_detail_html(html, "https://www.seedhub.cc/movies/130096/")
        self.assertEqual(result["title"], "生化危机：爆发夜 Resident Evil")
        self.assertEqual(result["description"], "电影简介")
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
