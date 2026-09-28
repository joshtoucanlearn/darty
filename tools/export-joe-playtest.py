"""Export the DARTY Quick Play runtime into Joe's existing website."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument('destination', type=Path)
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
destination = args.destination.resolve()
if destination == root or root in destination.parents:
    raise SystemExit('Choose an output directory outside the game checkout.')
if destination.exists():
    marker = destination / 'playtest-build.json'
    if not marker.is_file() or json.loads(marker.read_text()).get('game') != 'DARTY':
        raise SystemExit('Destination is not a recognised DARTY export; refusing to replace it.')
    shutil.rmtree(destination)
destination.mkdir(parents=True)

files = [root / 'controller-ui.js', root / 'career-mode/js/club-database.js',
         root / 'career-mode/js/original-names.js', root / 'match-engine/match.html']
files += [p for p in (root / 'quick-play').iterdir() if p.suffix in {'.html', '.js', '.css'}]
files += list((root / 'match-engine').glob('*.js'))
for folder in ['match-engine/assets', 'match-engine/vendor']:
    files += [p for p in (root / folder).rglob('*') if p.is_file()]
hashes = {}
for source in sorted(set(files)):
    relative = source.relative_to(root)
    target = destination / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, target)
    hashes[str(relative)] = hashlib.sha256(target.read_bytes()).hexdigest()

intro = (root / 'darty.html').read_text()
old = '<a class="secondary" href="index.html">Career and more game modes</a>'
assert old in intro
intro = intro.replace(old, '<a class="secondary" href="../arcade/">Back to Joe\'s arcade</a>')
for name in ['index.html', 'darty.html']:
    (destination / name).write_text(intro)
sha = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()
(destination / 'playtest-build.json').write_text(json.dumps({
    'game': 'DARTY', 'sourceRepository': 'joshtoucanlearn/darty', 'sourceCommit': sha,
    'mode': 'Quick Play', 'careerConnected': False, 'files': hashes,
}, indent=2) + '\n')
print(f'Exported {len(hashes)} unchanged runtime files and the playtest entry page to {destination}')
