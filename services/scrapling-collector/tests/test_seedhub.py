import unittest

from seedhub import parse_catalog_html


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


if __name__ == "__main__":
    unittest.main()
