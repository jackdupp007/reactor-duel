#!/usr/bin/env python3
"""Split GLB files into glTF JSON (geometry embedded as base64) plus separate texture files.

The artifact host can't serve .glb, so the game loads <name>.json with <name>-texN.jpg beside it.
Usage: python3 to-json.py <glb-dir> <out-dir>
"""
import base64
import json
import struct
import sys
from pathlib import Path

src, out = Path(sys.argv[1]), Path(sys.argv[2])
out.mkdir(parents=True, exist_ok=True)
for f in sorted(src.glob("*.glb")):
    name = f.stem
    b = f.read_bytes()
    jl = struct.unpack("<I", b[12:16])[0]
    j = json.loads(b[20:20 + jl])
    off = 20 + jl
    bl = struct.unpack("<I", b[off:off + 4])[0]
    BIN = b[off + 8:off + 8 + bl]
    image_views = {im["bufferView"] for im in j.get("images", []) if "bufferView" in im}
    for i, im in enumerate(j.get("images", [])):
        bv = j["bufferViews"][im["bufferView"]]
        data = BIN[bv.get("byteOffset", 0):bv.get("byteOffset", 0) + bv["byteLength"]]
        ext = "jpg" if im.get("mimeType") == "image/jpeg" else "png"
        tex = f"{name}-tex{i}.{ext}"
        (out / tex).write_bytes(data)
        j["images"][i] = {"uri": tex, "mimeType": im.get("mimeType")}
    views, remap, buf = [], {}, bytearray()
    for i, bv in enumerate(j["bufferViews"]):
        if i in image_views:
            continue
        while len(buf) % 4:
            buf.append(0)
        data = BIN[bv.get("byteOffset", 0):bv.get("byteOffset", 0) + bv["byteLength"]]
        nbv = dict(bv, byteOffset=len(buf), buffer=0)
        buf += data
        remap[i] = len(views)
        views.append(nbv)
    for a in j["accessors"]:
        if "bufferView" in a:
            a["bufferView"] = remap[a["bufferView"]]
    j["bufferViews"] = views
    j["buffers"] = [{"byteLength": len(buf), "uri": "data:application/octet-stream;base64," + base64.b64encode(bytes(buf)).decode()}]
    j.pop("extensionsUsed", None)
    j.pop("extensionsRequired", None)
    (out / f"{name}.json").write_text(json.dumps(j, separators=(",", ":")))
    print(f"{name}.json  {len(buf) / 1024:.0f} KB geometry, {len(j.get('images', []))} textures")
