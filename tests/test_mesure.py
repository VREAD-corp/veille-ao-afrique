"""Runs the browser-side checks of static/mesure.js (bots, webdriver, prerender, octave_notrack) under Node."""
import shutil
import subprocess
from pathlib import Path

import pytest


@pytest.mark.skipif(not shutil.which("node"), reason="node not installed")
def test_mesure_js_skips_bots_tests_and_prerender():
    script = Path(__file__).with_name("mesure_check.mjs")
    r = subprocess.run(["node", str(script)], capture_output=True, text=True, timeout=60)
    assert r.returncode == 0, r.stderr + r.stdout


@pytest.mark.skipif(not shutil.which("node"), reason="node not installed")
def test_backend_burst_screen_and_reclass():
    script = Path(__file__).with_name("burst_check.mjs")
    r = subprocess.run(["node", str(script)], capture_output=True, text=True, timeout=60)
    assert r.returncode == 0, r.stderr + r.stdout
    assert "burst: ok" in r.stdout
