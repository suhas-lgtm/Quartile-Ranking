"""
Publishing only some files (--only) must touch those files and nothing else.

In October 2026 `publish_data.py --to-dir site/public/data --only sif` deleted
171 other data files and rewrote manifest.json with 0 funds; the Neon upload
path rewrote the live manifest the same way. This runs the local mode in a
temporary folder (no Neon) and checks nothing outside the subset changes.

Run:  python tests/test_publish_safety.py        (or python -m pytest tests -q)
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')


def _run(src: str, out: str, *args: str) -> subprocess.CompletedProcess:
    env = dict(os.environ, MF_OUTPUT_DIR=src, PYTHONIOENCODING='utf-8')
    env.pop('DATABASE_URL', None)                      # never reach Neon from a test
    return subprocess.run([sys.executable, os.path.join(ROOT, 'scripts', 'publish_data.py'), '--to-dir', out, *args],
                          cwd=ROOT, env=env, capture_output=True, text=True, timeout=120)


def test_partial_local_write_keeps_everything_else():
    with tempfile.TemporaryDirectory() as src, tempfile.TemporaryDirectory() as out:
        # the new build: the SIF file (plus meta.json, which every build writes)
        json.dump({'plans': [], 'as_of': '2026-10-09'}, open(os.path.join(src, 'sif.json'), 'w'))
        json.dump({'as_of': '2026-10-09', 'categories': [{'slug': 'flexi-cap', 'asset_class': 'Equity'}]},
                  open(os.path.join(src, 'meta.json'), 'w'))
        # what is already there: other data and a full manifest
        os.makedirs(os.path.join(out, 'equity', 'flexi-cap'))
        keep = os.path.join(out, 'equity', 'flexi-cap', 'risk.json')
        open(keep, 'w').write('{"funds": [1]}')
        manifest = os.path.join(out, 'manifest.json')
        open(manifest, 'w').write('{"version": 1, "funds": {"101762": "equity/flexi-cap"}}')
        before = open(manifest).read()

        r = _run(src, out, '--only', 'sif')
        assert r.returncode == 0, r.stdout + r.stderr
        assert os.path.exists(os.path.join(out, 'sif.json')), 'the subset was not written'
        assert os.path.exists(keep), 'another data file was deleted by a partial write'
        assert open(manifest).read() == before, 'the manifest was rewritten by a partial write'


def test_same_folder_for_source_and_target_is_refused():
    with tempfile.TemporaryDirectory() as d:
        json.dump({}, open(os.path.join(d, 'sif.json'), 'w'))
        r = _run(d, d)
        assert r.returncode != 0, 'writing the tree into its own source must be refused'
        assert os.path.exists(os.path.join(d, 'sif.json'))


def test_partial_neon_upload_never_prunes_or_rewrites_the_manifest():
    # The upload path cannot run without Neon here; check the guard is in the code itself.
    src = open(os.path.join(ROOT, 'scripts', 'publish_data.py'), encoding='utf-8').read()
    i = src.index('if args.only:')
    j = src.index('prune_remote(sb, keep, apply=args.prune)')
    assert i < j, 'the --only guard must come before the prune'
    guard = src[i:j]
    assert 'return 0' in guard, 'a partial upload must return before the prune and the manifest'
    assert '"health.json"' in src, 'health.json must survive the daily prune'


if __name__ == '__main__':
    fails = 0
    for name, fn in sorted(globals().items()):
        if name.startswith('test_') and callable(fn):
            try:
                fn()
                print(f'  PASS  {name}')
            except AssertionError as exc:
                fails += 1
                print(f'  FAIL  {name}: {exc}')
    print()
    print('partial publishing is safe' if not fails else f'{fails} test(s) FAILED')
    sys.exit(1 if fails else 0)
