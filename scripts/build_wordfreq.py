#!/usr/bin/env python3
"""Builds assets/data/en-zipf.txt — English word frequencies used to spot hard words in passages.

Data: wordfreq by Robyn Speer (https://github.com/rspeer/wordfreq), CC BY-SA 4.0.
Format: one line per Zipf band ×10 (e.g. "42 word word …" = Zipf 4.2); words below Zipf 3.0 are left out
(anything not listed counts as rare). Run: pip install wordfreq && python3 scripts/build_wordfreq.py
"""
import collections, pathlib, re, site, sys
sys.path.append(site.getusersitepackages())
import wordfreq

bands = collections.defaultdict(list)
for w in wordfreq.top_n_list("en", 60000):
    if not re.fullmatch(r"[a-z]+(?:[-'][a-z]+)*", w):
        continue
    z = wordfreq.zipf_frequency(w, "en")
    if z < 3.0:
        break
    bands[int(round(z * 10))].append(w)
out = pathlib.Path(__file__).resolve().parent.parent / "assets" / "data" / "en-zipf.txt"
lines = ["# wordfreq (Robyn Speer), CC BY-SA 4.0 — https://github.com/rspeer/wordfreq — Zipf×10 then words"]
lines += [f"{b} {' '.join(ws)}" for b, ws in sorted(bands.items(), reverse=True)]
out.write_text("\n".join(lines) + "\n")
print(sum(len(v) for v in bands.values()), "words,", out.stat().st_size // 1024, "KB")
