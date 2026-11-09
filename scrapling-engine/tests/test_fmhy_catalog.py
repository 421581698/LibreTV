from app.fmhy_catalog import parse_fmhy_markdown, parse_official_source_file_list


def test_parser_keeps_category_section_marker_and_primary_link() -> None:
    markdown = """# Streaming Sites

## Stream Aggregators

* 🌟 **[Example](https://example.com/)**, [2](https://example.net/) - Movies / TV
"""
    entries = parse_fmhy_markdown("video.md", markdown)
    assert len(entries) == 1
    entry = entries[0]
    assert entry.title == "Example"
    assert entry.category == "video"
    assert entry.section_path == ("Streaming Sites", "Stream Aggregators")
    assert entry.marker == "🌟"
    assert entry.safety_status == "unverified"
    assert entry.links[0].is_primary is True
    assert entry.links[0].role == "primary"
    assert entry.links[1].role == "mirror"
    assert entry.links[0].domain == "example.com"


def test_parser_classifies_resource_repository_and_community_links() -> None:
    markdown = (
        "* [First](https://first.example/) or [Second](https://second.example/) "
        "/ [GitHub](https://github.com/example/project) / "
        "[Discord](https://discord.gg/example) - Free streaming\\n"
    )
    entries = parse_fmhy_markdown("video.md", markdown)
    assert [link.role for link in entries[0].links] == [
        "primary", "alternate", "repository", "community",
    ]
    assert sum(link.is_primary for link in entries[0].links) == 1


def test_parser_drops_unsafe_schemes_credentials_and_local_ip_literals() -> None:
    markdown = (
        "* [Good](https://example.com/) [Bad](javascript:alert(1)) "
        "[Credential](https://user:pass@example.org/) [Local](http://127.0.0.1/)\\n"
    )
    entries = parse_fmhy_markdown("video.md", markdown)
    assert [link.domain for link in entries[0].links] == ["example.com"]


def test_unsafe_source_is_flagged_and_keeps_plain_text_entries() -> None:
    markdown = """# Unsafe Sites

* ExampleFake - Listed for malware reports
* [Bad Mirror](https://bad.example/) - Reported malicious
"""
    entries = parse_fmhy_markdown("unsafe.md", markdown)
    assert len(entries) == 2
    assert all(entry.safety_status == "flagged_unsafe" for entry in entries)
    assert entries[0].links == ()
    assert entries[1].links[0].is_primary is True


def test_parser_ignores_code_fences_and_non_bullet_navigation() -> None:
    markdown = """# Index

[Navigation](https://example.net/)

~~~md
* [Code Sample](https://code.example/)
~~~

* [Actual](https://actual.example/)
"""
    entries = parse_fmhy_markdown("video.md", markdown)
    assert [entry.title for entry in entries] == ["Actual"]


def test_fmhy_markers_are_not_misclassified_as_primary_sites() -> None:
    markdown = """# Indexes

* 🌐 [Third Party Index](https://index.example/)
* ↪️ [Internal Section](https://www.reddit.com/r/example/wiki/section)
"""
    entries = parse_fmhy_markdown("video.md", markdown, "a" * 40)

    assert entries[0].marker == "🌐"
    assert entries[0].links[0].role == "index"
    assert entries[0].links[0].is_primary is False
    assert entries[1].marker == "↪️"
    assert entries[1].links[0].role == "navigation"
    assert entries[1].links[0].is_primary is False
    assert entries[0].source_url.endswith("/docs/video.md#L3")
    assert "a" * 40 in entries[0].source_url


def test_parser_preserves_parentheses_inside_markdown_urls() -> None:
    entries = parse_fmhy_markdown(
        "video.md",
        "* [Nested URL](https://example.com/watch_(extended)/episode_(1)) - Example\\n",
    )

    assert entries[0].links[0].canonical_url == (
        "https://example.com/watch_(extended)/episode_(1)"
    )


def test_parser_classifies_named_mirror_and_ordered_list_items() -> None:
    entries = parse_fmhy_markdown(
        "video.md",
        "1. [Primary](https://primary.example/) or [Mirror](https://mirror.example/)\\n",
    )

    assert len(entries) == 1
    assert [link.role for link in entries[0].links] == ["primary", "mirror"]



def test_official_source_manifest_parser_reads_only_safe_markdown_paths() -> None:
    route_source = """const files = (
      [
        'video.md',
        'audio.md',
        'unsafe.md'
      ] as const
    ).map((file) => file)
    """
    assert parse_official_source_file_list(route_source) == (
        "video.md", "audio.md", "unsafe.md",
    )


def test_official_source_manifest_parser_rejects_duplicate_or_unsafe_paths() -> None:
    duplicate = "const files = ([ 'video.md', 'video.md' ] as const)"
    unsafe = "const files = ([ '../secrets.md' ] as const)"
    with pytest.raises(RuntimeError, match="duplicate"):
        parse_official_source_file_list(duplicate)
    with pytest.raises(RuntimeError, match="unsupported"):
        parse_official_source_file_list(unsafe)
