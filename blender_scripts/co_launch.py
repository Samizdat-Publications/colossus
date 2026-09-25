"""Launch a COLOSSUS asset script in a separate background Blender, from inside the MCP-connected Blender.

The GUI Blender behind the MCP may be shared with other sessions, so asset scripts never build in its
open scene. From the MCP:

    import sys; sys.path.insert(0, r"<repo>/blender_scripts")
    import co_launch; result = co_launch.launch("golem.py")

launch() uses Popen and returns at once (a blocking call would hold the shared Blender's main thread).
Several scripts in one call run one after another in a single background process chain.
Logs: test-output/blender-logs/<script>.log (the last line is DONE or FAILED).
"""
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
LOGS = os.path.join(ROOT, 'test-output', 'blender-logs')


def blender_exe():
    try:
        import bpy
        return bpy.app.binary_path
    except ImportError:
        return os.environ.get('BLENDER_PATH', r'C:\Program Files\Blender Foundation\Blender 5.1\blender.exe')


def command(script, *args):
    return [blender_exe(), '--background', '--factory-startup', '--python-exit-code', '3',
            '--python', os.path.join(HERE, script), '--', *args]


def launch(*scripts):
    """Start the scripts (one after another) in background Blender processes. Returns immediately."""
    os.makedirs(LOGS, exist_ok=True)
    flags = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
    if len(scripts) == 1:
        script = scripts[0]
        base = os.path.splitext(os.path.basename(script))[0]
        log_path = os.path.join(LOGS, base + '.log')
        logf = open(log_path, 'w', encoding='utf-8')
        p = subprocess.Popen(command(script), stdout=logf, stderr=subprocess.STDOUT, cwd=ROOT, creationflags=flags)
        return {'pid': p.pid, 'log': log_path}
    # a chain: a tiny Python driver (outside Blender) runs each script in turn
    chain_log = os.path.join(LOGS, 'chain.log')
    logf = open(chain_log, 'w', encoding='utf-8')
    driver = os.path.join(HERE, 'co_chain.py')
    p = subprocess.Popen([sys.executable if not _in_blender() else _python_exe(), driver, blender_exe(), *scripts],
                         stdout=logf, stderr=subprocess.STDOUT, cwd=ROOT, creationflags=flags)
    return {'pid': p.pid, 'log': chain_log, 'scripts': list(scripts)}


def _in_blender():
    try:
        import bpy  # noqa: F401
        return True
    except ImportError:
        return False


def _python_exe():
    # Blender's bundled Python interpreter lives next to its site-packages
    import bpy
    base = os.path.dirname(bpy.app.binary_path)
    ver = '.'.join(bpy.app.version_string.split('.')[:2])
    cand = os.path.join(base, ver, 'python', 'bin', 'python.exe' if os.name == 'nt' else 'python3')
    return cand if os.path.exists(cand) else sys.executable
