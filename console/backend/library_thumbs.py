"""Preview thumbnails for the LuxAlgo catalogue — made here, kept here.

Why (measured 26 Sep 2026): every catalogue card carries a 1600×1000 PNG on LuxAlgo's S3. The files
are SMALL (~29 KB) but latency-bound — about **0.8 s to first byte** for each one from this machine —
and a browser opens only six connections per host. Sixty cards therefore meant ten rounds of ~0.8 s
before the grid filled, and the Indicators modal sat there mostly empty while it waited. The pictures
were never the problem; asking S3 sixty times from the browser was.

So the console fetches each one ONCE, shrinks it to the size actually painted, keeps it on disk, and
serves it from localhost. The first open pays for the fetches — concurrently, 8 at a time — and every
open after that is a local file read.

Resizing is done by a CLI (`vips`, then `magick`/`convert`, then `ffmpeg`) because this backend is
deliberately stdlib-only; when none of them is installed the original bytes are served instead, which
is slower but never wrong.
"""

from __future__ import annotations

import hashlib
import os
import re
import shutil
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

# Only LuxAlgo's own buckets are ever fetched: the URL arrives from the page, and a local tool that
# fetches whatever it is handed is a hole, not a feature. Two of them show up in the catalogue —
# the designed cards (`luxalgo-production`) and, for rows published before that pass, a raw screen
# recording bucket whose keys contain SPACES (`luxalgo-images-production.s3.us-east-1.amazonaws.com`,
# "Screenshot 2026-06-04 at 3.13.58 PM.png"). Measured 27 Sep: refusing the second host left four
# cards on page one with no picture at all.
ALLOWED_HOSTS = (
    "luxalgo-production.s3.amazonaws.com",
    "luxalgo-images-production.s3.us-east-1.amazonaws.com",
)
MAX_BYTES = 4_000_000            # a card is ~30 KB; nothing legitimate here is bigger than a few MB

CACHE_DIR = Path(os.environ.get("TRADERS_AGENT_THUMBS")
                 or Path.home() / ".local" / "share" / "traders-agent" / "thumbs")

DEFAULT_WIDTH = 320
MAX_WIDTH = 1600
FETCH_TIMEOUT = 20.0
# S3 answers a 29 KB card in ~1–2 s and this link runs ~80 KB/s (both measured 27 Sep), so the count
# is the cost, not the bytes: sixteen at a time turns a page of sixty from four minutes into seconds.
WORKERS = 16

_SLUG_RE = re.compile(r"[^a-z0-9._-]+")
_POOL = ThreadPoolExecutor(max_workers=WORKERS, thread_name_prefix="thumb")
_LOCK = threading.Lock()
_IN_FLIGHT: set[str] = set()


def _safe_slug(slug: str) -> str:
    slug = _SLUG_RE.sub("-", (slug or "").strip().lower()).strip("-")
    return slug[:80] or "row"


def _clamp(width: int) -> int:
    try:
        width = int(width)
    except (TypeError, ValueError):
        width = DEFAULT_WIDTH
    return max(80, min(MAX_WIDTH, width))


def _allowed(url: str) -> bool:
    """LuxAlgo's two buckets only, over https, by EXACT host. A "contains luxalgo" rule on any S3 host let someone
    else's bucket (or an S3 website endpoint that redirects) through (audit SEC-8)."""
    if not isinstance(url, str) or not url.startswith("https://"):
        return False
    return any(url.startswith(f"https://{host}/") for host in ALLOWED_HOSTS)


def _kind(raw: bytes) -> str | None:
    """The picture type by its first bytes, never by name. Only these reach vips / ImageMagick / ffmpeg."""
    if raw[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if raw[:3] == b"\xff\xd8\xff":
        return "jpg"
    if raw[:4] == b"RIFF" and raw[8:12] == b"WEBP":
        return "webp"
    return None


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):          # a 30x from the bucket is an answer, not a path to follow
        return None


def _tag(url: str) -> str:
    """A short tag of WHERE the picture came from.

    Without it a slug's cached file would outlive its artwork: LuxAlgo replaces a card's PNG at the
    same slug, and an immutable local copy would keep showing the old chart forever. The URL carries
    the upload's own timestamp, so tagging with it means a new picture is simply a new file — the
    stale one is never served again."""
    return hashlib.sha256((url or "").encode("utf-8")).hexdigest()[:8]


def cache_path(slug: str, url: str, width: int) -> Path:
    return CACHE_DIR / f"{_safe_slug(slug)}-{_tag(url)}-{_clamp(width)}.jpg"


def _converter() -> tuple[str, list[str]] | None:
    """The resizer this machine actually has, as (argv prefix, args template)."""
    if shutil.which("vips"):
        return "vips", ["vips", "thumbnail", "{src}", "{dst}", "{width}"]
    if shutil.which("magick"):
        return "magick", ["magick", "{src}", "-resize", "{width}x", "-quality", "72", "{dst}"]
    if shutil.which("convert"):
        return "convert", ["convert", "{src}", "-resize", "{width}x", "-quality", "72", "{dst}"]
    if shutil.which("ffmpeg"):
        return "ffmpeg", ["ffmpeg", "-y", "-loglevel", "error", "-i", "{src}",
                          "-vf", "scale={width}:-1", "-q:v", "5", "{dst}"]
    return None


def _fetch(url: str) -> bytes | None:
    # Raw-recording keys carry spaces ("Screenshot 2026-06-04 at 3.13.58 PM.png") — urllib refuses a
    # URL with a space in it, so quote the unsafe characters and keep the ones that mean structure.
    safe = urllib.parse.quote(url, safe=":/?&=#%+,;@[]~")
    request = urllib.request.Request(safe, headers={"User-Agent": "traders-agent-console/1.0"})
    opener = urllib.request.build_opener(_NoRedirect)
    try:
        with opener.open(request, timeout=FETCH_TIMEOUT) as response:  # noqa: S310
            if response.status != 200:
                return None
            raw = response.read(MAX_BYTES + 1)
            return raw if len(raw) <= MAX_BYTES else None
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError, ValueError):
        return None


def _shrink(src: Path, dst: Path, width: int) -> bool:
    tool = _converter()
    if tool is None:
        return False
    _name, argv = tool
    cmd = [part.format(src=str(src), dst=str(dst), width=width) for part in argv]
    try:
        done = subprocess.run(cmd, capture_output=True, timeout=30)  # noqa: S603
    except (OSError, subprocess.SubprocessError):
        return False
    return done.returncode == 0 and dst.exists() and dst.stat().st_size > 0


_KEY_LOCKS: dict[str, threading.Lock] = {}


def _key_lock(name: str) -> threading.Lock:
    with _LOCK:
        if len(_KEY_LOCKS) > 512:
            _KEY_LOCKS.clear()
        return _KEY_LOCKS.setdefault(name, threading.Lock())


def thumb(slug: str, url: str, width: int = DEFAULT_WIDTH) -> tuple[bytes, str] | None:
    """The bytes to send for one card. `None` means "no preview, say so" — never a stand-in image."""
    width = _clamp(width)
    dst = cache_path(slug, url, width)
    try:
        if dst.exists() and dst.stat().st_size > 0:
            return dst.read_bytes(), "image/jpeg"
    except OSError:
        pass
    if not _allowed(url):
        return None
    # One build per picture at a time: the modal and the background warmer ask for the same key together, and the
    # second used to read the first's half-written file, which the browser then kept for a year (audit BE-10).
    with _key_lock(dst.name):
        try:
            if dst.exists() and dst.stat().st_size > 0:
                return dst.read_bytes(), "image/jpeg"
        except OSError:
            pass
        raw = _fetch(url)
        kind = _kind(raw) if raw else None
        if raw is None or kind is None:
            return None
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        fd, name = tempfile.mkstemp(dir=str(CACHE_DIR), prefix=".src-", suffix="." + kind)
        tmp_src = Path(name)
        tmp_dst = tmp_src.with_name(tmp_src.name + ".jpg")
        try:
            with os.fdopen(fd, "wb") as fh:
                fh.write(raw)
            if _shrink(tmp_src, tmp_dst, width):
                os.replace(tmp_dst, dst)                  # atomic: nobody ever reads a partial file
                return dst.read_bytes(), "image/jpeg"
            # No converter on this machine: the original is bigger but it is the real picture.
            return raw, ("image/" + ("jpeg" if kind == "jpg" else kind))
        except OSError:
            return raw, ("image/" + ("jpeg" if kind == "jpg" else kind))
        finally:
            for f in (tmp_src, tmp_dst):
                try:
                    f.unlink()
                except OSError:
                    pass


def _build(key: str, slug: str, url: str, width: int) -> None:
    """One job. A transient failure must not leave a permanent hole: retry twice, then let it go.

    Four rows of 806 came back empty from the first cold warm and all four fetched fine a minute
    later (measured 27 Sep) — S3 under a sixteen-way burst, not a broken URL. Without this the card
    would simply have no picture until somebody opened it again."""
    try:
        for wait in (0.0, 2.0, 6.0):
            if wait:
                time.sleep(wait)
            if thumb(slug, url, width) is not None:
                return
    finally:
        with _LOCK:
            _IN_FLIGHT.discard(key)


def warm(items, width: int = DEFAULT_WIDTH) -> int:
    """Fetch/convert a batch in the background. Deduplicates by cache key, so a second call is free."""
    width = _clamp(width)
    queued = 0
    for slug, url in items:
        if not slug or not _allowed(url or ""):
            continue
        key = cache_path(slug, url, width).name[:-4]
        dst = cache_path(slug, url, width)
        if dst.exists():
            continue
        with _LOCK:
            if key in _IN_FLIGHT:
                continue
            _IN_FLIGHT.add(key)
        _POOL.submit(_build, key, slug, url, width)
        queued += 1
    return queued


def stats() -> dict:
    """What the cache is holding — enough to answer "why is it slow?" without guessing."""
    files = 0
    total = 0
    newest = None
    try:
        for path in CACHE_DIR.glob("*.jpg"):
            files += 1
            total += path.stat().st_size
            mtime = path.stat().st_mtime
            newest = mtime if newest is None else max(newest, mtime)
    except OSError:
        pass
    with _LOCK:
        pending = len(_IN_FLIGHT)
    tool = _converter()
    return {
        "dir": str(CACHE_DIR),
        "files": files,
        "bytes": total,
        "newest": newest,
        "queued": pending,
        "resizer": tool[0] if tool else None,
    }
