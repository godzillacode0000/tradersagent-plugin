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

    def test_the_thumb_cache_module_is_stdlib_only(self):
        """The console's rule: no third-party imports (the resizer is a CLI, not a Python dep)."""
        src = read(THUMBS)
        allowed = {"__future__", "hashlib", "os", "re", "shutil", "subprocess", "threading", "time",
                   "urllib", "concurrent", "pathlib"}
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
        self.assertIn('if not url.startswith("https://"):', src, "https only, even for a friendly host")

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
        self.assertIn('os.environ.get("TRADERS_AGENT_THUMB_WARM_PAGES", "0")', src)
        self.assertIn('out["warmer"] = dict(_WARM)', src, "progress must be observable, not guessed")

    def test_the_resizer_is_a_cli_with_a_honest_fallback(self):
        src = read(THUMBS)
        for tool in ("vips", "magick", "convert", "ffmpeg"):
            self.assertIn(f'"{tool}"', src, f"{tool} is part of the fallback chain")
        self.assertIn('return raw, "image/png"', src,
                      "no converter on a machine must serve the real picture, not a blank tile")

    def test_a_missing_preview_is_a_404_not_a_placeholder(self):
        src = read(SERVER)
        block = src.split("def _library_thumb(", 1)[1].split("def _serve_static", 1)[0]
        self.assertIn("if got is None:", block)
        self.assertIn("no_preview", block, "no picture is a fact; say so instead of faking one")


class ThePageUsesIt(unittest.TestCase):
    def test_cards_point_at_the_local_endpoint(self):
        app = read(APP)
        self.assertIn("function thumbUrl(", app)
        self.assertIn("shot: thumbUrl(r.slug, r.image_url, CARD_SHOT_W)", app,
                      "the card paints the local thumb and keeps the raw URL for the star")
        self.assertIn("thumbUrl(row.slug, shot, DETAIL_SHOT_W)", app, "the Details pane asks bigger")
        self.assertIn("const CARD_SHOT_W = 480;", app, "the card is ~430 px wide since 27 Sep")
        self.assertIn("const DETAIL_SHOT_W = 960;", app)

    def test_the_modal_takes_the_screen_and_the_cards_are_pictures(self):
        """The operator's ask, 27 Sep: a bigger surface and previews you can actually read."""
        css = read(CSS)
        self.assertIn("width: min(1720px, 100%); height: 100%;", css,
                      "the panel used to be min(920px, 72vh) with 96 px banners")
        self.assertIn(".ind-grid.is-pictures { grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));",
                      css, "a list with pictures gets wide cards, a list of names stays dense")
        self.assertIn("aspect-ratio: 16 / 10;", css, "the preview follows the card, not a fixed strip")
        self.assertNotIn("height: 96px;", css, "the old banner height must not come back")
        app = read(APP)
        self.assertIn("grid.classList.toggle('is-pictures'", app,
                      "the page must say which kind of list it just painted")

    def test_the_warmer_warms_the_width_the_card_paints(self):
        src = read(SERVER)
        self.assertIn("WARM_WIDTH = 480", src)
        self.assertIn("library_thumbs.warm(pairs, WARM_WIDTH)", src)

    def test_the_page_warms_what_it_laid_out(self):
        app = read(APP)
        block = app.split("function renderIndicators()", 1)[1].split("grid.innerHTML", 1)[0]
        self.assertIn("/api/library/warm", block,
                      "the page warms its own results, so the second open is a disk read")

    def test_a_row_without_a_picture_loses_its_img_not_its_tile(self):
        app = read(APP)
        self.assertIn("document.getElementById('ind-grid')?.addEventListener('error'", app,
                      "a 404 preview must not leave the browser's broken-image glyph behind")
        self.assertIn("if (img && img.tagName === 'IMG') img.remove();", app)


if __name__ == "__main__":
    unittest.main()
