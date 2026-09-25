"""Run several asset scripts one after another in background Blender (used by co_launch.launch(a, b, ...)).

Usage: python co_chain.py <blender.exe> textures.py golem.py ...
Each script gets its own log in test-output/blender-logs/; this driver prints one line per script.
"""
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
LOGS = os.path.join(ROOT, 'test-output', 'blender-logs')


def main():
    exe, scripts = sys.argv[1], sys.argv[2:]
    os.makedirs(LOGS, exist_ok=True)
    flags = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
    failed = []
    for script in scripts:
        base = os.path.splitext(os.path.basename(script))[0]
        log_path = os.path.join(LOGS, base + '.log')
        t0 = time.time()
        with open(log_path, 'w', encoding='utf-8') as logf:
            code = subprocess.call([exe, '--background', '--factory-startup', '--python-exit-code', '3',
                                    '--python', os.path.join(HERE, script)],
                                   stdout=logf, stderr=subprocess.STDOUT, cwd=ROOT, creationflags=flags)
        print(f'{script}: exit {code} in {time.time() - t0:.0f}s', flush=True)
        if code != 0:
            failed.append(script)
    print('CHAIN DONE' if not failed else f'CHAIN FAILED: {", ".join(failed)}', flush=True)
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
