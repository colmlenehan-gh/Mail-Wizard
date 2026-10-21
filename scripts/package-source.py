"""Produce a reproducible source ZIP without dependencies, runtime state or credentials."""
from pathlib import Path
import zipfile

root = Path(__file__).resolve().parent.parent
output = root / 'dist/mail-wizard-source.zip'
excluded = {'node_modules', '.git', '.openai', 'release', '__pycache__'}
with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for path in sorted(root.rglob('*')):
        relative = path.relative_to(root)
        if not path.is_file() or any(part in excluded for part in relative.parts):
            continue
        if path == output or path.suffix in {'.log', '.mwbackup', '.eml'} or path.name.startswith('.env'):
            continue
        info = zipfile.ZipInfo('mail-wizard/' + relative.as_posix(), date_time=(2026, 10, 21, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o100644 << 16
        archive.writestr(info, path.read_bytes())
print(output)
