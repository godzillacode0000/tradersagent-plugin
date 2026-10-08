"""Pins the preview-cache work: the local thumbnail endpoint, and the sync list that ships it.

Two lessons, both measured on 26 Sep 2026:

  1. **Why the grid was slow.** Each catalogue card carries a 1600×1000 PNG on LuxAlgo's S3: ~29 KB,
     but ~0.8 s to first byte from this machine, and a browser opens only six connections per host.
     Sixty cards = ten rounds of 0.8 s, so the Indicators modal looked empty while it filled. Small
     files, expensive LATENCY — the fix is to fetch each one once, shrink it, keep it, and serve it
     from localhost.
  2. **A new backend module must be added to tools/sync-live.sh**, whose copy list is explicit. Miss
     it and the live server dies on `ModuleNotFoundError` at start-up while systemd restarts it
     forever — which is exactly what happened when `library_thumbs.py` first shipped.
"""

import os
import re
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
BACKEND = os.path.join(ROOT, "console", "backend")
SERVER = os.path.join(BACKEND, "server.py")
THUMBS = os.path.join(BACKEND, "library_thumbs.py")
SYNC = os.path.join(ROOT, "tools", "sync-live.sh")
APP = os.path.join(ROOT, "console", "frontend", "app.js")
DRAWER = os.path.join(ROOT, "console", "frontend", "drawer.js")
CSS = os.path.join(ROOT, "console", "frontend", "styles.css")

# Live-machine launchers: never copied by design (see the sync script's own note).
NOT_SYNCED = {"mvp_server.py"}


def read(path: str) -> str:
    with open(path, encoding="utf-8") as fh:
        return fh.read()


class TheSyncListCoversEveryModule(unittest.TestCase):
    def test_sync_live_names_every_backend_module(self):
        sync = read(SYNC)
        found = re.search(r"console/backend/\{([^}]+)\}", sync)
        if found is None:
            self.fail("the sync script must name the backend modules it copies")
        listed = set(found.group(1).split(","))
        present = {n for n in os.listdir(BACKEND)
                   if n.endswith(".py") and n not in NOT_SYNCED}
        missing = sorted(present - listed)
        self.assertEqual(
            missing, [],
            f"{missing} would break the live server on start-up (ModuleNotFoundError) — "
            "add them to tools/sync-live.sh",
        )

    def test_sync_live_mirrors_every_vendor_directory(self):
        """Every vendored browser family must be mirrored, not just pinets.

        A family the sync skips stays at its old release in the live tree — and that is not merely
        stale: releases rename their content-hashed `chunk-*.js` files (the vela 0.7.3 -> 0.8.1 move
        renamed six), so the new entry files import chunks the old tree never had. A live tree that
        skips the family is a page that dies at boot with "Failed to fetch dynamically imported
        module".
        """
        sync = read(SYNC)
        found = re.search(r"for fam in ([^;]+);\s*do", sync)
        if found is None:
            self.fail("the sync script must mirror the vendored families it copies")
        listed = set(found.group(1).split())
        vendor = os.path.join(ROOT, "console", "frontend", "vendor")
        present = {n for n in os.listdir(vendor) if os.path.isdir(os.path.join(vendor, n))}
        missing = sorted(present - listed)
        self.assertEqual(
            missing, [],
            f"{missing} would stay at their old release in the live tree — "
            "add them to tools/sync-live.sh's vendor loop",
        )

    def test_the_thumb_cache_module_is_stdlib_only(self):
        """The console's rule: no third-party imports (the resizer is a CLI, not a Python dep)."""
        src = read(THUMBS)
        allowed = {"__future__", "hashlib", "os", "re", "shutil", "subprocess", "threading", "time",
                   "urllib", "concurrent", "pathlib", "tempfile"}
        for line in src.splitlines():
            match = re.match(r"^(?:import|from)\s+([a-zA-Z_][\w.]*)", line)
            if match:
                self.assertIn(match.group(1).split(".")[0], allowed,
                              f"unexpected import in library_thumbs.py: {line.strip()}")


class TheEndpointIsLocalAndCheap(unittest.TestCase):
    def test_the_route_exists_and_serves_bytes(self):
        src = read(SERVER)
        self.assertIn('"/api/library/thumb"', src, "the page needs a local URL to point <img> at")
        self.assertIn("def _library_thumb(", src)
        self.assertIn("max-age=31536000", src, "a picture for a slug never changes: let it be cached")
        self.assertIn('"/api/library/warm"', src, "the page warms the page it just laid out")

    def test_the_server_warms_the_catalogue_at_boot(self):
        """Filling in while you watch is the complaint; the warmer is the answer to it."""
        src = read(SERVER)
        self.assertIn("def warm_catalogue_thumbs(", src)
        self.assertIn("threading.Thread(", src.split("def warm_catalogue_thumbs(", 1)[1],
                      "warming must never block the server from listening")
        self.assertIn('TRADERS_AGENT_THUMB_WARM', src, "and it must be switchable off")
        self.assertIn('name="thumb-warmer", daemon=True', src)

    def test_only_luxalgo_is_ever_fetched(self):
        """The URL arrives from the page; a local tool that fetches whatever it is handed is a hole."""
        src = read(THUMBS)
        self.assertIn("ALLOWED_HOSTS = (", src)
        self.assertIn("luxalgo-images-production.s3.us-east-1.amazonaws.com", src,
                      "the catalogue's older rows live in a second LuxAlgo bucket (spaces in the key)")
        self.assertIn("def _allowed(", src)
        body = src.split("def thumb(", 1)[1]
        self.assertIn("if not _allowed(url):", body, "thumb() must refuse a foreign URL, not fetch it")
        # behaviour, not a string: https only, exact hosts only (a "contains luxalgo" rule let other buckets in)
        import importlib.util
        spec = importlib.util.spec_from_file_location("library_thumbs_allow", THUMBS)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        self.assertTrue(mod._allowed("https://luxalgo-production.s3.amazonaws.com/a.png"))
        for url in ("http://luxalgo-production.s3.amazonaws.com/a.png",
                    "https://luxalgo-evil.s3.amazonaws.com/a.png",
                    "https://attacker-luxalgo.s3.eu-west-1.amazonaws.com/a.svg",
                    "https://luxalgo.s3-website-us-east-1.amazonaws.com/a",
                    "https://evil.com/luxalgo-production.s3.amazonaws.com/", "", None):
            self.assertFalse(mod._allowed(url), url)

    def test_the_second_bucket_is_actually_fetched(self):
        """Refusing it was a live bug: four cards on page one had no picture (measured 27 Sep)."""
        import importlib.util
        spec = importlib.util.spec_from_file_location("library_thumbs_probe", THUMBS)
        if spec is None or spec.loader is None:
            self.fail("library_thumbs.py must be importable")
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        self.assertTrue(mod._allowed(
            "https://luxalgo-images-production.s3.us-east-1.amazonaws.com/Screenshot 2026-06-04 at 3.13.58 PM.png"))
        self.assertTrue(mod._allowed("https://luxalgo-production.s3.amazonaws.com/library/cards/a-b.png"))
        for foreign in ("https://evil.example.com/a.png", "http://luxalgo-production.s3.amazonaws.com/x.png",
                        "https://s3.amazonaws.com/other-bucket/x.png", ""):
            self.assertFalse(mod._allowed(foreign), f"{foreign!r} must not be fetched")

    def test_space_in_a_key_is_quoted_not_refused(self):
        src = read(THUMBS)
        self.assertIn('urllib.parse.quote(url, safe=":/?&=#%+,;@[]~")', src)

    def test_the_cache_key_carries_the_picture_identity(self):
        """Artwork gets replaced at the same slug; an immutable local copy must not outlive it."""
        src = read(THUMBS)
        self.assertIn("def _tag(url: str) -> str:", src)
        self.assertIn('f"{_safe_slug(slug)}-{_tag(url)}-{_clamp(width)}.jpg"', src)

    def test_the_warmer_walks_the_whole_catalogue_by_default(self):
        """The operator's ask: every card cached, not just the first page."""
        src = read(SERVER)
        self.assertIn("def warm_catalogue_thumbs(pages: int = 0) -> None:", src)
        self.assertIn("limit = pages or MAX_WARM_PAGES", src)
        self.assertIn("MAX_WARM_PAGES = 40", src, "a runaway page walk needs a guard rail")
        self.assertIn('_env_int("TRADERS_AGENT_THUMB_WARM_PAGES", 0)', src)
        self.assertIn('out["warmer"] = dict(_WARM)', src, "progress must be observable, not guessed")

    def test_the_resizer_is_a_cli_with_a_honest_fallback(self):
        src = read(THUMBS)
        for tool in ("vips", "magick", "convert", "ffmpeg"):
            self.assertIn(f'"{tool}"', src, f"{tool} is part of the fallback chain")
        self.assertIn('return raw, ("image/"', src,
                      "no converter on a machine must serve the real picture, not a blank tile")

    def test_a_missing_preview_is_a_404_not_a_placeholder(self):
        src = read(SERVER)
        block = src.split("def _library_thumb(", 1)[1].split("def _serve_static", 1)[0]
        self.assertIn("if got is None:", block)
        self.assertIn("no_preview", block, "no picture is a fact; say so instead of faking one")


class ThePageUsesIt(unittest.TestCase):
    def test_rows_point_at_the_local_endpoint(self):
        app, drawer = read(APP), read(DRAWER)
        self.assertIn("function thumbUrl(", app)
        self.assertIn("thumbUrl(r.slug, r.image_url, 160)", drawer,
                      "a row paints the local thumb (160 px), and the star keeps the raw URL")
        self.assertIn("thumbUrl(row.slug, shot, DETAIL_SHOT_W)", app, "the Details view asks bigger")
        self.assertIn("const DETAIL_SHOT_W = 960;", app)

    def test_the_rows_are_thumbnails(self):
        """The ⌗ modal's wide picture cards are gone with it; the drawer's rows carry 160 px thumbs."""
        css = read(CSS)
        self.assertIn(".drow__shot { width: 52px; height: 34px; object-fit: cover;", css,
                      "the row thumb is a small, fixed tile — a list of names, not a wall of pictures")
        self.assertNotIn(".ind-card__shot", css, "the modal's card pictures went with the modal")

    def test_the_warmer_warms_the_width_the_row_paints(self):
        src = read(SERVER)
        self.assertIn("WARM_WIDTH = 480", src)
        self.assertIn("library_thumbs.warm(pairs, WARM_WIDTH)", src)

    def test_a_row_without_a_picture_loses_its_img_not_its_tile(self):
        drawer = read(DRAWER)
        self.assertIn("list.addEventListener('error'", drawer,
                      "a 404 preview must not leave the browser's broken-image glyph behind")
        self.assertIn("if (img && img.tagName === 'IMG') img.remove();", drawer)


if __name__ == "__main__":
    unittest.main()
