"""Embed this checkout (no dependencies/secrets) into one Windows installer script."""
import base64
import io
from pathlib import Path
import zipfile
root = Path(__file__).resolve().parents[1]
paths = [root / x for x in ('package.json', 'package-lock.json', 'tsconfig.json', 'electron.vite.config.ts', 'vitest.config.ts', 'LICENSE')]
for directory in ('src', 'tests', 'native/selection-helper', 'resources'):
    paths.extend(p for p in (root / directory).rglob('*') if p.is_file() and '__pycache__' not in p.parts and 'selection-helper' not in p.relative_to(root / directory).parts)
paths.append(root / 'scripts/build-selection-helper.ps1')
buffer = io.BytesIO()
with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED) as z:
    for path in sorted(set(paths)):
        z.write(path, path.relative_to(root).as_posix())
script = (root / 'scripts/install.ps1').read_text()
script = script.replace("$SourceArchive = '' # EMBED_SOURCE", "$SourceArchive = '" + base64.b64encode(buffer.getvalue()).decode() + "'")
out = root / 'release/install.ps1'
out.parent.mkdir(exist_ok=True)
out.write_text(script, encoding='utf-8-sig')
print(f'{out}: {out.stat().st_size} bytes, {len(set(paths))} source files')
