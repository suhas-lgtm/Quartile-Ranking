"""
Run every tests/test_*.py (each runs on its own, no pytest needed) and fail if any fails.

    python tests/run_all.py

The daily GitHub run calls this before touching any data, and the Tests workflow
on every push, so a broken rule stops the run instead of reaching the dashboard.
"""

from __future__ import annotations

import glob
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))

if __name__ == '__main__':
    failed = []
    for path in sorted(glob.glob(os.path.join(HERE, 'test_*.py'))):
        name = os.path.basename(path)
        print(f'── {name}')
        r = subprocess.run([sys.executable, path], env=dict(os.environ, PYTHONIOENCODING='utf-8'))
        if r.returncode:
            failed.append(name)
    print()
    if failed:
        print(f'FAILED: {", ".join(failed)}')
        sys.exit(1)
    print('all test files passed')
