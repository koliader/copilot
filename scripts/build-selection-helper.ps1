$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root
python -m venv .helper-venv
if ($LASTEXITCODE) { throw 'venv failed' }
& .helper-venv/Scripts/python.exe -m pip install -r native/selection-helper/requirements.txt
if ($LASTEXITCODE) { throw 'pip failed' }
& .helper-venv/Scripts/python.exe -m PyInstaller --noconfirm --clean --onedir --name selection-helper --distpath resources/selection-helper --workpath build/helper --specpath build native/selection-helper/helper.py --collect-submodules comtypes
if ($LASTEXITCODE) { throw 'helper build failed' }
