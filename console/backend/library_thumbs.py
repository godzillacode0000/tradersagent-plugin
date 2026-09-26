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
import threading
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
_HOST_RULE = re.compile(r"^https?://(?:[a-z0-9-]+\.)*s3(?:[.-][a-z0-9-]+)*\.amazonaws\.com/", re.I)

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
    """LuxAlgo's own buckets only, and only over https. Anything else is refused, not fetched."""
    if not url.startswith("https://"):
        return False
    if any(url.startswith(f"https://{host}/") for host in ALLOWED_HOSTS):
        return True
    return bool(_HOST_RULE.match(url)) and "luxalgo" in url.split("//", 1)[1].split("/", 1)[0]


def cache_path(slug: str, width: int) -> Path:
    return CACHE_DIR / f"{_safe_slug(slug)}-{_clamp(width)}.jpg"


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
    try:
        with urllib.request.urlopen(request, timeout=FETCH_TIMEOUT) as response:  # noqa: S310
            if response.status != 200:
                return None
            return response.read()
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


def thumb(slug: str, url: str, width: int = DEFAULT_WIDTH) -> tuple[bytes, str] | None:
    """The bytes to send for one card. `None` means "no preview, say so" — never a stand-in image."""
    width = _clamp(width)
    dst = cache_path(slug, width)
    try:
        if dst.exists() and dst.stat().st_size > 0:
            return dst.read_bytes(), "image/jpeg"
    except OSError:
        pass
    if not _allowed(url):
        return None
    raw = _fetch(url)
    if raw is None:
        return None
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    tmp_png = dst.with_suffix(".src.png")
    try:
        tmp_png.write_bytes(raw)
        if _shrink(tmp_png, dst, width):
            return dst.read_bytes(), "image/jpeg"
        # No converter on this machine: the original is bigger but it is the real picture.
        return raw, "image/png"
    except OSError:
        return raw, "image/png"
    finally:
        try:
            tmp_png.unlink()
        except OSError:
            pass


def _build(key: str, slug: str, url: str, width: int) -> None:
    try:
        thumb(slug, url, width)
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
        key = f"{_safe_slug(slug)}-{width}"
        dst = CACHE_DIR / f"{key}.jpg"
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
