#!/usr/bin/env python3
"""Stamps a new version into index.html and version.json so browsers fetch fresh files after a deploy.

GitHub Pages lets browsers cache files for 10 minutes. Every asset URL in index.html carries ?v=<version>
(modules through the import map), and the running app compares itself with version.json on start.
Run before committing a release:  python3 scripts/stamp.py
"""
import json, pathlib, re, time

root = pathlib.Path(__file__).resolve().parent.parent
version = time.strftime("%Y%m%d%H%M", time.gmtime())
modules = sorted(p.name for p in (root / "assets").glob("*.js"))

html = (root / "index.html").read_text()
imports = {f"./assets/{m}": f"./assets/{m}?v={version}" for m in modules}
importmap = '<script type="importmap">' + json.dumps({"imports": imports}, indent=2) + "</script>"
html = re.sub(r'<script type="importmap">.*?</script>', lambda _: importmap, html, flags=re.S)
html = re.sub(r'(assets/(?:styles\.css|app\.js))\?v=[^"]*', rf"\1?v={version}", html)
html = re.sub(r'(<meta name="app-version" content=")[^"]*', rf"\g<1>{version}", html)
(root / "index.html").write_text(html)
(root / "version.json").write_text(json.dumps({"version": version}) + "\n")
print(version)
