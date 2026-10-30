"""The latency pass (19 Oct 2026): static caching, stale-while-revalidate, the catalogue warm.

Measured before it, on the live desk: every pane open re-downloaded the whole vendored graph — 180
assets, 7.2 MB — because every static response said `Cache-Control: no-store`; and every Library read
after ~2 s paid a fresh WAN round trip to LuxAlgo's MCP (0.45–0.68 s per call measured; the drawer's
first open 3.4 s; the catalogue's cold walk 16.5 s).

The pins below hold the three fixes and, just as importantly, hold their EDGES: the app's own files
must keep revalidating (a sloppy "has a dash and a hex-ish tail" rule would freeze `script-highlight.js`
for a year), a stale read must survive a refresh that fails, and the warm must never walk when the
disk copy is fresh.
"""

import http.client
import json
import os
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest import mock

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

import server as srv  # noqa: E402


class FakeBridge:
    """Counts calls and can be told to fail, so the SWR path is testable without a network."""

    def __init__(self, fail=False):
        self.calls = 0
        self.fail = fail
        self.connected = True
        self.lock = threading.Lock()

    def call(self, tool, args):
        with self.lock:
            self.calls += 1
            n = self.calls
        if self.fail:
            raise srv.MCPUnavailable("bridge down", detail="test")
        return ({"n": n}, f"raw {n}")


class TheStaticCachePolicy(unittest.TestCase):
    def test_the_document_is_never_cached(self):
        self.assertEqual(srv.static_cache_control("index.html"), "no-store")

    def test_a_bundler_hash_may_be_cached_forever(self):
        self.assertTrue(srv.static_cache_control("chunk-UNUVPQFW.js").startswith("public"),
                        "content-hashed chunks are new names on every build")

    def test_app_files_revalidate_instead(self):
        for name in ("app.js", "styles.css", "script-highlight.js", "chart-bridge.js",
                     "desk.js", "vela.global.min.js", "pinets.min.browser.es.js"):
            self.assertEqual(srv.static_cache_control(name), "no-cache",
                             f"{name} changes per commit and must stay revalidated")

    def test_if_none_match_accepts_star_lists_and_exact_tags(self):
        self.assertTrue(srv._etag_matches('*', '"abc-1"'))
        self.assertTrue(srv._etag_matches('"other-2", "abc-1"', '"abc-1"'))
        self.assertTrue(srv._etag_matches('  "abc-1"  ', '"abc-1"'))
        self.assertFalse(srv._etag_matches(None, '"abc-1"'))
        self.assertFalse(srv._etag_matches('"abc-2"', '"abc-1"'))


class StaticOverHttp(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        front = Path(cls.tmp.name) / "frontend"
        (front / "vendor" / "vela" / "dist").mkdir(parents=True)
        (front / "index.html").write_text("<!doctype html><title>console</title>", encoding="utf-8")
        (front / "app.js").write_text("console.log('app')", encoding="utf-8")
        (front / "vendor" / "vela" / "dist" / "chunk-UNUVPQFW.js").write_text("export{}", encoding="utf-8")
        cls._orig = srv.Handler.static
        srv.Handler.static = srv.StaticFiles(str(front))
        cls.httpd = srv.Server(("127.0.0.1", 0), srv.Handler)
        cls.port = cls.httpd.server_address[1]
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        srv.Handler.static = cls._orig
        cls.tmp.cleanup()

    def get(self, path, headers=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        conn.request("GET", path, headers=headers or {})
        res = conn.getresponse()
        body = res.read()
        out = (res.status, dict(res.getheaders()), body)
        conn.close()
        return out

    def test_a_file_arrives_with_its_etag_and_policy(self):
        status, headers, body = self.get("/app.js")
        self.assertEqual(status, 200)
        self.assertEqual(headers.get("Cache-Control"), "no-cache")
        self.assertTrue(headers.get("ETag"))
        self.assertEqual(body, b"console.log('app')")

    def test_the_tag_comes_back_as_a_304_without_the_body(self):
        _, headers, _ = self.get("/app.js")
        status, again, body = self.get("/app.js", {"If-None-Match": headers["ETag"]})
        self.assertEqual(status, 304)
        self.assertEqual(body, b"")
        self.assertEqual(again.get("ETag"), headers["ETag"])

    def test_a_changed_file_is_served_again(self):
        _, headers, _ = self.get("/app.js")
        path = Path(srv.Handler.static.root) / "app.js"
        original = path.read_text(encoding="utf-8")
        self.addCleanup(path.write_text, original, encoding="utf-8")   # the other tests share this server
        time.sleep(0.01)
        path.write_text("console.log('app2')", encoding="utf-8")
        os.utime(path, None)
        status, _, body = self.get("/app.js", {"If-None-Match": headers["ETag"]})
        self.assertEqual(status, 200)
        self.assertIn(b"app2", body, "a revalidated file that changed must be re-sent")

    def test_the_hashed_vendor_chunk_is_immutable_and_the_document_is_not(self):
        _, chunk, _ = self.get("/vendor/vela/dist/chunk-UNUVPQFW.js")
        self.assertTrue(chunk.get("Cache-Control", "").startswith("public"))
        _, doc, _ = self.get("/")
        self.assertEqual(doc.get("Cache-Control"), "no-store")
        status, _, _ = self.get("/", {"If-None-Match": doc.get("ETag", '"x"')})
        self.assertEqual(status, 200, "index.html must never be answered 304: a new build must land")


class StaleWhileRevalidate(unittest.TestCase):
    def setUp(self):
        self.bridge = FakeBridge()
        self._b = mock.patch.object(srv, "BRIDGE", self.bridge)
        self._b.start()
        srv.CACHE._data.clear()
        srv._REFRESHING.clear()
        self.addCleanup(self._b.stop)

    def _wait(self, cond, limit=3.0):
        end = time.time() + limit
        while time.time() < end:
            if cond():
                return True
            time.sleep(0.02)
        return False

    def test_first_read_blocks_and_the_second_does_not(self):
        p1, _, c1 = srv.mcp_call("t", {}, "search", "k-fresh", 5.0)
        p2, _, c2 = srv.mcp_call("t", {}, "search", "k-fresh", 5.0)
        self.assertEqual((c1, c2), (False, True))
        self.assertEqual(self.bridge.calls, 1, "a fresh hit must not touch the bridge")
        self.assertEqual(p1, p2)

    def test_a_stale_read_answers_instantly_and_refreshes_behind_it(self):
        srv.mcp_call("t", {}, "search", "k-stale", 0.05)
        time.sleep(0.08)
        before = time.time()
        payload, _, cached = srv.mcp_call("t", {}, "search", "k-stale", 0.05)
        elapsed = time.time() - before
        self.assertTrue(cached, "a stale answer is still an answer")
        self.assertLess(elapsed, 0.05, "the reader must not wait for the refresh")
        self.assertEqual(payload, {"n": 1}, "the stale copy is what was served")
        self.assertTrue(self._wait(lambda: self.bridge.calls == 2), "the refresh must run behind it")
        payload2, _, _ = srv.mcp_call("t", {}, "search", "k-stale", 0.05)
        self.assertEqual(payload2, {"n": 2})

    def test_five_readers_start_one_refresh(self):
        srv.mcp_call("t", {}, "search", "k-once", 0.05)
        time.sleep(0.08)
        threads = [threading.Thread(target=srv.mcp_call, args=("t", {}, "search", "k-once", 0.05))
                   for _ in range(5)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        self.assertTrue(self._wait(lambda: self.bridge.calls >= 2))
        time.sleep(0.2)
        self.assertEqual(self.bridge.calls, 2, "five readers, one refresh")

    def test_a_failing_refresh_never_takes_the_stale_read_with_it(self):
        srv.mcp_call("t", {}, "search", "k-bad", 0.05)
        time.sleep(0.08)
        self.bridge.fail = True
        payload, _, cached = srv.mcp_call("t", {}, "search", "k-bad", 0.05)
        self.assertTrue(cached)
        self.assertEqual(payload, {"n": 1})

    def test_the_windows_are_the_ones_the_table_asks_for(self):
        self.assertGreaterEqual(srv.TTL["source"], 3600.0, "an indicator's source is immutable in practice")
        self.assertGreaterEqual(srv.TTL["families"], 3600.0)
        self.assertGreaterEqual(srv.TTL["search"], 30.0, "the old 1.5 s re-asked upstream every click")
        self.assertGreaterEqual(srv._keep_for(1.5), srv.STALE_KEEP_MIN)


class TheCatalogueWarm(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self._root = mock.patch.object(srv, "AGENTS_ROOT", self.tmp.name)
        self._root.start()
        self.addCleanup(self._root.stop)
        self.walked = []
        self._walk = mock.patch.object(srv, "ep_catalogue",
                                      lambda params: self.walked.append(params) or {"rows": [1]})
        self._walk.start()
        self.addCleanup(self._walk.stop)
        self.bridge = FakeBridge()
        self._b = mock.patch.object(srv, "BRIDGE", self.bridge)
        self._b.start()
        self.addCleanup(self._b.stop)

    def _write(self, age):
        path = os.path.join(self.tmp.name, "catalogue.json")
        with open(path, "w", encoding="utf-8") as fh:
            json.dump({"rows": [{"slug": "x"}], "fetched_at": time.time() - age}, fh)

    def test_a_fresh_disk_copy_is_not_walked_again(self):
        self._write(60)
        srv.warm_catalogue(wait_for_bridge=0.1)
        self.assertEqual(self.walked, [])

    def test_a_missing_or_stale_copy_is_walked_once(self):
        srv.warm_catalogue(wait_for_bridge=0.1)
        self.assertEqual(len(self.walked), 1)
        self._write(srv.CATALOGUE_TTL + 60)
        srv.warm_catalogue(wait_for_bridge=0.1)
        self.assertEqual(len(self.walked), 2)

    def test_no_session_means_no_walk_and_no_trouble(self):
        self.bridge.connected = False
        srv.warm_catalogue(wait_for_bridge=0.1)
        self.assertEqual(self.walked, [])

    def test_main_starts_the_warm_beside_the_connect(self):
        src = (BACKEND / "server.py").read_text(encoding="utf-8")
        self.assertIn('Thread(target=warm_catalogue, name="catalogue-warm"', src,
                      "the warm only pays off if start-up actually runs it")


if __name__ == "__main__":
    unittest.main()
