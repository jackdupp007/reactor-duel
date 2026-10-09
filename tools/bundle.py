#!/usr/bin/env python3
"""Bundle www/src/*.js (in name order) into www/game.js, wrapped in one function so they share a scope."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
parts = sorted((ROOT / "www" / "src").glob("*.js"))
body = "\n".join(f"// ---- {p.name} ----\n{p.read_text()}" for p in parts)
out = "// Built by tools/bundle.py from www/src. Edit the files there, not this one.\n(() => {\n'use strict';\n" + body + "\n})();\n"
(ROOT / "www" / "game.js").write_text(out)
print(f"game.js: {len(parts)} files, {len(out):,} bytes")
