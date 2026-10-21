"""Polite HTTP client (stdlib only): identifying User-Agent, cookies, a minimum delay between requests,
retries with back-off, and an optional on-disk cache for detail pages."""

from __future__ import annotations

import gzip
import hashlib
import http.cookiejar
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

CONTACT = "contact@jalonel.com"
USER_AGENT = (f"VeilleAOAfrique/1.0 (READ FRANCE SAS, Paris; +https://ao-afrique.jalonel.com/methode/; "
              f"contact: {CONTACT})")


class Polite:
    """One session per source. `delay` is the minimum time between two requests to the same host."""

    def __init__(self, delay: float = 3.0, timeout: int = 90, retries: int = 3, cache_dir: Path | None = None):
        self.delay = delay
        self.timeout = timeout
        self.retries = retries
        self.cache_dir = cache_dir
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))
        self._last = 0.0
        self.requests = 0

    def _wait(self) -> None:
        gap = time.monotonic() - self._last
        if gap < self.delay:
            time.sleep(self.delay - gap)
        self._last = time.monotonic()

    def fetch(self, url: str, data: dict | None = None, *, accept: str = "text/html", extra: dict | None = None) -> bytes:
        body = urllib.parse.urlencode(data).encode() if data is not None else None
        headers = {"User-Agent": USER_AGENT, "Accept": accept, "Accept-Language": "fr", "Accept-Encoding": "gzip",
                   **(extra or {})}
        if body is not None:
            headers["Content-Type"] = "application/x-www-form-urlencoded"
        last: Exception | None = None
        for attempt in range(self.retries):
            self._wait()
            self.requests += 1
            req = urllib.request.Request(url, data=body, headers=headers, method="POST" if body is not None else "GET")
            try:
                with self.opener.open(req, timeout=self.timeout) as resp:
                    raw = resp.read()
                    if resp.headers.get("Content-Encoding") == "gzip":
                        raw = gzip.decompress(raw)
                    return raw
            except urllib.error.HTTPError as exc:
                last = exc
                if 400 <= exc.code < 500 and exc.code != 429:
                    raise RuntimeError(f"HTTP {exc.code} for {url}") from exc
            except (urllib.error.URLError, TimeoutError, ConnectionError) as exc:
                last = exc
            time.sleep(min(60, 5 * 2 ** attempt))
        raise RuntimeError(f"request failed after {self.retries} attempts: {url}: {last}")

    def text(self, url: str, data: dict | None = None) -> str:
        return self.fetch(url, data).decode("utf-8", errors="replace")

    def json(self, url: str, params: dict | None = None, *, extra: dict | None = None):
        if params:
            url = f"{url}?{urllib.parse.urlencode(params)}"
        return json.loads(self.fetch(url, accept="application/json", extra=extra))

    def cached_text(self, url: str, max_age_s: float) -> str:
        """GET with an on-disk cache (detail pages: fetched once, then reused until max_age_s)."""
        if not self.cache_dir:
            return self.text(url)
        key = hashlib.sha1(url.encode()).hexdigest()
        path = self.cache_dir / f"{key}.html.gz"
        if path.exists() and time.time() - path.stat().st_mtime < max_age_s:
            return gzip.decompress(path.read_bytes()).decode("utf-8", errors="replace")
        raw = self.fetch(url)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        path.write_bytes(gzip.compress(raw))
        return raw.decode("utf-8", errors="replace")
