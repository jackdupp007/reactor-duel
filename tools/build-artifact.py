#!/usr/bin/env python3
"""Build the claude.ai web version (artifact) from the app page www/index.html.

The app page is the master copy. The artifact host wraps the page in its own
<html>/<head>/<body>, and loads libraries and fonts from CDNs instead of local files,
so this script strips the document wrapper and swaps those references.

Usage: python3 tools/build-artifact.py <output.html>
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
src = (ROOT / "www" / "index.html").read_text()

swaps = [
    ('<script src="lib/three.min.js"></script>',
     '<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>'),
    ('<script src="lib/GLTFLoader.js"></script>',
     '<script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/GLTFLoader.js"></script>'),
    ('<link rel="stylesheet" href="fonts/fonts.css">',
     '<link rel="preconnect" href="https://fonts.googleapis.com">\n'
     '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
     '<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500'
     '&family=Saira+Condensed:wght@500;600;700&family=Saira:wght@400;500&display=swap" rel="stylesheet">'),
]
for old, new in swaps:
    if src.count(old) != 1:
        sys.exit(f"expected exactly one of: {old}")
    src = src.replace(old, new)

# Strip the document wrapper and meta tags; the artifact host provides its own.
for pattern in [r"<!doctype html>\s*", r"<html[^>]*>\s*", r"<head>\s*", r"</head>\s*", r"<body>\s*",
                r"\s*</body>", r"\s*</html>", r'<meta [^>]*>\s*']:
    src = re.sub(pattern, "", src, flags=re.IGNORECASE)

out = Path(sys.argv[1] if len(sys.argv) > 1 else "reactor-duel.html")
out.write_text(src.strip() + "\n")
print(f"wrote {out} ({len(src):,} bytes)")
