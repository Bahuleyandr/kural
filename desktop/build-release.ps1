param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Forwarded)
$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Python = if ($env:KURAL_DESKTOP_BUILD_PYTHON) { $env:KURAL_DESKTOP_BUILD_PYTHON } else { "python" }
& $Python (Join-Path $ScriptDir "scripts\build_desktop.py") "release" @Forwarded
exit $LASTEXITCODE
