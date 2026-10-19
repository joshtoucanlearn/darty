#!/usr/bin/env python3
"""Summarise match-lab reports: score and event counts per run."""
import json, sys, collections
for f in sys.argv[1:]:
    d = json.load(open(f))
    c = collections.Counter(e.get('type') for e in d.get('captureEvents', []))
    keys = ['pass', 'shot', 'save', 'goal', 'tackle', 'slideTackle', 'foul', 'hardHit', 'pop', 'freeKick', 'penalty']
    print(f"{f.split('/')[-1]:32} {d['score']['you']}-{d['score']['opp']}  " + '  '.join(f"{k}={c.get(k, 0)}" for k in keys) + f"  frames={d['frames']}")
    if d.get('intents') and '-v' in sys.argv[0:1] + sys.argv: pass
    if d.get('intents'):
        tot = sum(d['intents'].values())
        print('    decisions (per CPU tick with ball):', ', '.join(f"{k} {v*100/tot:.1f}%" for k, v in sorted(d['intents'].items(), key=lambda kv: -kv[1])[:10]))
