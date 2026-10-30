#requires -Version 5.1
[CmdletBinding()]
param([switch]$NoLaunch)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
if ($env:OS -ne 'Windows_NT' -or -not [Environment]::Is64BitOperatingSystem -or $env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') { throw 'Windows x64 is required.' }
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
# Generated standalone copies contain the source archive here.
$SourceArchive = '' # EMBED_SOURCE
$state = Join-Path $env:LOCALAPPDATA 'CopilotSelection-setup'
$work = Join-Path $state ('build-' + [guid]::NewGuid().ToString('N'))
$installDir = Join-Path $env:LOCALAPPDATA 'Programs\CopilotSelection'
$api = 'http://127.0.0.1:11434'
$model = 'qwen3.5:9b'
New-Item -ItemType Directory -Path $work -Force | Out-Null
Start-Transcript -Path (Join-Path $work 'install.log') | Out-Null
function Refresh-Path {
    $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User') + ';' + (Join-Path $env:LOCALAPPDATA 'Programs\Ollama')
}
function Run-Checked([string]$File, [string[]]$Arguments) {
    & $File @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$File failed with exit code $LASTEXITCODE" }
}
function Install-Package([string]$Id) {
    if (-not (Get-Command winget.exe -ErrorAction SilentlyContinue)) { throw 'Windows App Installer (winget) is required. Install/update App Installer from Microsoft Store and rerun this script.' }
    Run-Checked 'winget.exe' @('install','--id',$Id,'--exact','--source','winget','--accept-package-agreements','--accept-source-agreements','--silent','--disable-interactivity')
    Refresh-Path
}
function Test-Ollama {
    try { $t = Invoke-RestMethod "$api/api/tags" -TimeoutSec 3; return ($null -ne $t.PSObject.Properties['models']) } catch { return $false }
}
try {
    if (Get-Process CopilotSelection -ErrorAction SilentlyContinue) { throw 'Close Copilot Selection before installing.' }
    Write-Host '[1/6] Preparing source and build tools...'
    if ($SourceArchive) {
        $zip = Join-Path $work 'source.zip'
        [IO.File]::WriteAllBytes($zip, [Convert]::FromBase64String($SourceArchive))
        Expand-Archive -LiteralPath $zip -DestinationPath (Join-Path $work 'source')
        $source = Join-Path $work 'source'
    } else {
        $source = Split-Path $PSScriptRoot -Parent
        if (-not (Test-Path (Join-Path $source 'package.json'))) { throw 'Use the generated standalone install.ps1 or run scripts/install.ps1 from the checkout.' }
    }
    Refresh-Path
    # Use the same Node major as CI, without changing the user's system Node.
    $nodeVersion = '24.22.1'
    $nodeZipName = "node-v$nodeVersion-win-x64.zip"
    $nodeZip = Join-Path $work $nodeZipName
    $nodeBase = "https://nodejs.org/dist/v$nodeVersion"
    Invoke-WebRequest -UseBasicParsing "$nodeBase/$nodeZipName" -OutFile $nodeZip
    $sums = (Invoke-WebRequest -UseBasicParsing "$nodeBase/SHASUMS256.txt").Content
    $line = @($sums -split "`n" | Where-Object { $_.Trim().EndsWith(" $nodeZipName") })
    if ($line.Count -ne 1) { throw 'Node checksum entry not found.' }
    $expected = ($line[0].Trim() -split '\s+')[0]
    if ((Get-FileHash $nodeZip -Algorithm SHA256).Hash -ne $expected) { throw 'Node checksum mismatch.' }
    Expand-Archive -LiteralPath $nodeZip -DestinationPath $work
    $nodeDir = Join-Path $work "node-v$nodeVersion-win-x64"
    $python = Join-Path $env:LOCALAPPDATA 'Programs\Python\Python312\python.exe'
    if (-not (Test-Path $python)) { Install-Package 'Python.Python.3.12' }
    if (-not (Test-Path $python)) {
        $python = (& py.exe -3.12 -c 'import sys; print(sys.executable)')
        if ($LASTEXITCODE -ne 0 -or -not (Test-Path $python)) { throw 'Python 3.12 installation not found.' }
    }
    $env:Path = $nodeDir + ';' + (Split-Path $python -Parent) + ';' + $env:Path
    Write-Host '[2/6] Building and testing Copilot Selection...'
    Push-Location $source
    try {
        Remove-Item Env:ELECTRON_SKIP_BINARY_DOWNLOAD -ErrorAction SilentlyContinue
        Run-Checked 'npm.cmd' @('ci')
        Run-Checked 'npm.cmd' @('run','typecheck')
        Run-Checked 'npm.cmd' @('test')
        Run-Checked 'npm.cmd' @('run','dist')
        # Smoke-test the packaged helper, including its bundled Python runtime.
        $helperExe = Join-Path $source 'resources\selection-helper\selection-helper\selection-helper.exe'
        $info = New-Object Diagnostics.ProcessStartInfo
        $info.FileName = $helperExe
        $info.UseShellExecute = $false
        $info.CreateNoWindow = $true
        $info.RedirectStandardInput = $true
        $info.RedirectStandardOutput = $true
        $helper = New-Object Diagnostics.Process
        $helper.StartInfo = $info
        try {
            if (-not $helper.Start()) { throw 'Helper failed to start.' }
            $lineTask = $helper.StandardOutput.ReadLineAsync()
            if (-not $lineTask.Wait(15000)) { throw 'Helper handshake timeout.' }
            $hello = $lineTask.Result | ConvertFrom-Json
            if ($hello.type -ne 'ready' -or $hello.version -ne 1) { throw 'Invalid helper handshake.' }
            $helper.StandardInput.WriteLine('{"type":"shutdown"}')
            $helper.StandardInput.Close()
            if (-not $helper.WaitForExit(5000)) { throw 'Helper did not stop.' }
            if ($helper.ExitCode -ne 0) { throw 'Helper exited unsuccessfully.' }
        } finally { if ($helper.Id -and -not $helper.HasExited) { $helper.Kill() }; $helper.Dispose() }
        $version = (Get-Content package.json -Raw | ConvertFrom-Json).version
        $setup = Join-Path $source "release\Copilot Selection Setup $version.exe"
        if (-not (Test-Path $setup)) { throw 'Application installer was not produced.' }
    } finally { Pop-Location }
    Write-Host '[3/6] Preparing Ollama...'
    if (-not (Get-Command ollama.exe -ErrorAction SilentlyContinue)) { Install-Package 'Ollama.Ollama' }
    if (-not (Test-Ollama)) {
        Start-Process ollama.exe -ArgumentList 'serve' -WindowStyle Hidden -RedirectStandardOutput (Join-Path $work 'ollama.log') -RedirectStandardError (Join-Path $work 'ollama-error.log') | Out-Null
        $deadline = (Get-Date).AddSeconds(60)
        while (-not (Test-Ollama)) { if ((Get-Date) -gt $deadline) { throw 'Ollama did not start.' }; Start-Sleep 1 }
    }
    Write-Host '[4/6] Downloading and testing qwen3.5:9b (several GB)...'
    $oldHost = $env:OLLAMA_HOST
    try {
        $env:OLLAMA_HOST = $api
        Run-Checked 'ollama.exe' @('pull',$model)
        $body = @{model=$model;prompt='Reply with OK';stream=$false;think=$false;keep_alive=-1} | ConvertTo-Json
        $reply = Invoke-RestMethod "$api/api/generate" -Method Post -ContentType 'application/json' -Body $body -TimeoutSec 600
        if (-not $reply.done -or -not $reply.response) { throw 'Ollama returned no completed answer.' }
    } finally { $env:OLLAMA_HOST = $oldHost }
    Write-Host '[5/6] Installing application...'
    $p = Start-Process -FilePath $setup -ArgumentList @('/S',"/D=$installDir") -Wait -PassThru
    if ($p.ExitCode -ne 0) { throw "Application setup failed: $($p.ExitCode)" }
    $exe = Join-Path $installDir 'CopilotSelection.exe'
    if (-not (Test-Path $exe)) { throw 'Installed executable not found.' }
    $data = Join-Path $env:APPDATA 'copilot-selection'
    New-Item -ItemType Directory -Path $data -Force | Out-Null
    # Initialize only a fresh profile. Existing settings, models and providers are preserved.
    if (-not (Test-Path (Join-Path $data 'settings.json')) -and -not (Test-Path (Join-Path $data 'providers.json'))) {
        $utf8 = New-Object Text.UTF8Encoding($false)
        $provider = @(@{id='local-ollama';label='Ollama';preset='ollama';protocol='openai';baseUrl="$api/v1";hasKey=$false;allowFallback=$false;timeoutMs=300000})
        [IO.File]::WriteAllText((Join-Path $data 'providers.json'), (ConvertTo-Json -InputObject $provider -Depth 5), $utf8)
        $config = @{schemaVersion=1;inputMode='selection';roles=@{quick_answer=@{providerId='local-ollama';model=$model}};selection=@{target=@{providerId='local-ollama';model=$model}}}
        [IO.File]::WriteAllText((Join-Path $data 'settings.json'), ($config | ConvertTo-Json -Depth 6), $utf8)
    }
    Write-Host '[6/6] Installed. Select text and release Ctrl after completing first-run setup.'
    if (-not $NoLaunch) { Start-Process $exe }
    Write-Host "Build and install log: $work"
} finally { Stop-Transcript | Out-Null }
