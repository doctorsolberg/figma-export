import fcntl
import os
from pathlib import Path
import sys


LOCK_FD = 3


def verify_lock(root):
    try:
        descriptor = os.fstat(LOCK_FD)
        expected = os.stat(Path(root) / '.backup.lock', follow_symlinks=False)
        if (descriptor.st_dev, descriptor.st_ino) != (expected.st_dev, expected.st_ino):
            raise OSError('wrong file')
        fcntl.flock(LOCK_FD, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError as exc:
        raise ValueError('No valid inherited output lock descriptor') from exc


def main():
    if sys.version_info < (3, 11):
        sys.exit('python3 on PATH must be Python 3.11 or newer.')
    if sys.argv[1:2] == ['--verify']:
        verify_lock(sys.argv[2])
        return
    root, node, script, *args = sys.argv[1:]
    root = Path(root)
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    lock = os.open(root / '.backup.lock', os.O_NOFOLLOW | os.O_CREAT | os.O_RDWR, 0o600)
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        sys.exit('An export is already using this output directory.')
    # The new process owns the same advisory lock until it exits (including on a crash).
    if lock != LOCK_FD:
        os.dup2(lock, LOCK_FD, inheritable=True)
        os.close(lock)
    else:
        os.set_inheritable(lock, True)
    os.environ['FIGMA_EXPORT_INTERNAL'] = '1'
    os.execvp(node, [node, script, *args])


if __name__ == '__main__':
    main()
