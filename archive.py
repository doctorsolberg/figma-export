import errno
import hashlib
import json
import os
import re
import sys
import tempfile
import unicodedata
import zipfile
import zlib
from pathlib import Path
from urllib.parse import urlsplit
from lock import verify_lock

def sync_directory(directory):
    fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    except OSError as exc:
        if exc.errno not in {errno.EINVAL, errno.ENOTSUP, errno.EBADF}:
            raise
    finally:
        os.close(fd)

def main():
    directory, filename, key,u,title,ext,parts=sys.argv[1:]; parts=json.loads(parts)
    root=Path(directory).resolve(strict=True)
    supplied_stage=Path(filename)
    # Canonicalize the parent (e.g. macOS /tmp), but do not resolve the staged file itself.
    stage=supplied_stage.parent.resolve(strict=True)/supplied_stage.name
    verify_lock(root)
    if not isinstance(parts,list) or len(parts)>24 or not parts or any(not isinstance(x,str) or not x for x in parts): raise ValueError('bad folder')
    url=urlsplit(u)
    if url.scheme!='https' or url.netloc not in {'figma.com','www.figma.com'} or not re.fullmatch(r'[A-Za-z0-9]+',key) or url.path.split('/')[2:3]!=[key] or url.query or url.fragment: raise ValueError('bad Figma reference')
    if ext not in {'.fig','.deck','.jam','.make','.buzz','.site'} or stage.suffix!=ext or not stage.is_file() or stage.parent != root or stage.is_symlink() or not re.fullmatch(r'\.playwright-[0-9a-f-]+',stage.stem): raise ValueError('bad staging path')
    def segment(s):
        s=''.join('_' if c in '/\\:' or ord(c)<32 else c for c in s).strip().lstrip('.')
        return s.encode('utf-8')[:160].decode('utf-8',errors='ignore') or '_'
    try:
        with zipfile.ZipFile(stage) as z:
            if z.getinfo('meta.json').file_size > 16 * 1024 * 1024:
                raise ValueError('oversized metadata')
            meta = json.loads(z.read('meta.json'))
            name = meta.get('file_name') if isinstance(meta,dict) else None
            if ('canvas.fig' not in z.namelist() or not isinstance(name,str)
                    or unicodedata.normalize('NFC',name) != unicodedata.normalize('NFC',title)
                    or z.testzip() is not None):
                raise ValueError('archive integrity or Figma title mismatch')
    except (ValueError, KeyError, zipfile.BadZipFile, NotImplementedError, RuntimeError, zlib.error, EOFError) as exc:
        print(str(exc),file=sys.stderr)
        sys.exit(3)
    with stage.open('rb') as f:
        digest=hashlib.file_digest(f,'sha256').hexdigest()
        os.fsync(f.fileno())
    report=root/'backup-report.json'; d=json.loads(report.read_text())
    folder=root
    for part in parts:
        folder=folder/segment(part)
        try:
            folder.mkdir()
            sync_directory(folder.parent)
        except FileExistsError:
            if not folder.is_dir(): raise
        if folder.is_symlink(): raise ValueError('symlink in backup path')
    for i in range(101):
        suffix='' if i==0 else f' [{key}]' if i==1 else f' [{key}]-{i}'
        out=folder/(segment(title)+suffix+ext)
        try:
            os.link(stage,out)
            break
        except FileExistsError:
            if not out.is_symlink() and out.is_file() and out.stat().st_size==stage.stat().st_size:
                with out.open('rb') as f:
                    if hashlib.file_digest(f,'sha256').hexdigest()==digest: break
    else:
        raise ValueError('no available filename')
    sync_directory(folder)
    d['files'][key]={'title':title,'url':u,'status':'saved','path':str(out.relative_to(root)), 'bytes':out.stat().st_size,'sha256':digest,'source':'figma-export'}
    f=tempfile.NamedTemporaryFile('w',encoding='utf-8',dir=root,prefix='.report-',delete=False)
    previous = Path(f.name + '.bak')
    try:
        with f:
            json.dump(d,f,ensure_ascii=False,indent=2); f.write('\n'); f.flush(); os.fsync(f.fileno())
        os.link(report,previous,follow_symlinks=False)
        os.replace(previous,root/'backup-report.json.bak')
        os.replace(f.name,report)
        sync_directory(root)
    finally:
        Path(f.name).unlink(missing_ok=True)
        previous.unlink(missing_ok=True)
    stage.unlink()
    print(str(out))
if __name__=='__main__': main()
