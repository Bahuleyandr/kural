param(
  [switch]$WithClone,
  [switch]$WithLocalModels,
  [switch]$SkipRuntimeProvision,
  [switch]$SkipModelProvision,
  [switch]$SkipSmoke,
  [string]$Python = $env:KURAL_DESKTOP_BUILD_PYTHON,
  [string]$LocalModelsRoot = $env:KURAL_LOCAL_MODELS_ROOT,
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$TauriArgs
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Resolve-Path (Join-Path $ScriptDir "..")
$RuntimeDir = Join-Path $ScriptDir "runtime"
$RuntimePython = Join-Path $RuntimeDir "python"
$RuntimeModels = Join-Path $RuntimeDir "models"
$ConfigPath = Join-Path $ScriptDir "target\tauri-installer.conf.json"

if (-not $Python) {
  $candidate = "D:\Dev\Tools\kural-local-models\.venv\Scripts\python.exe"
  if (Test-Path $candidate) {
    $Python = $candidate
  } else {
    $Python = "python"
  }
}

if (-not $LocalModelsRoot) {
  $candidateModels = "D:\Dev\Tools\kural-models"
  if (Test-Path $candidateModels) {
    $LocalModelsRoot = $candidateModels
  }
}

New-Item -ItemType Directory -Force -Path $RuntimeModels | Out-Null

if (-not $SkipRuntimeProvision) {
  $runtimeArgs = @(
    (Join-Path $ScriptDir "scripts\provision-backend-runtime.py"),
    "--target",
    $RuntimePython,
    "--python",
    $Python
  )
  if ($WithClone) {
    $runtimeArgs += "--with-clone"
  }
  if ($WithLocalModels) {
    $runtimeArgs += "--with-local-models"
  }
  & $Python @runtimeArgs
}

$runtimePythonExe = Join-Path $RuntimePython "Scripts\python.exe"
if (-not (Test-Path $runtimePythonExe)) {
  $runtimePythonExe = Join-Path $RuntimePython "bin\python"
}
if (-not (Test-Path $runtimePythonExe)) {
  throw "Bundled runtime Python was not found in $RuntimePython"
}

$kokoroRuntimeDir = Join-Path $RuntimeModels "kokoro"
if (-not $SkipModelProvision) {
  $env:MODEL_CACHE_DIR = $kokoroRuntimeDir
  & $runtimePythonExe (Join-Path $RepoRoot "backend\scripts\download_models.py")
}

if ($WithLocalModels) {
  if (-not $LocalModelsRoot) {
    $LocalModelsRoot = Join-Path $RuntimeModels "local-source"
    & $runtimePythonExe (Join-Path $RepoRoot "backend\scripts\provision_local_models.py") --root $LocalModelsRoot
  }

  $asrSource = Join-Path $LocalModelsRoot "asr\faster-whisper-tiny"
  $argosSource = Join-Path $LocalModelsRoot "translation\argos\packages"
  $asrDest = Join-Path $RuntimeModels "asr\faster-whisper-tiny"
  $argosDest = Join-Path $RuntimeModels "translation\argos\packages"

  if (Test-Path $asrSource) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $asrDest) | Out-Null
    robocopy $asrSource $asrDest /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -le 7) { $global:LASTEXITCODE = 0 } else { exit $LASTEXITCODE }
  } else {
    Write-Warning "Faster-Whisper model source not found: $asrSource"
  }

  if (Test-Path $argosSource) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $argosDest) | Out-Null
    robocopy $argosSource $argosDest /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -le 7) { $global:LASTEXITCODE = 0 } else { exit $LASTEXITCODE }
  } else {
    Write-Warning "Argos package source not found: $argosSource"
  }
}

$configArgs = @(
  (Join-Path $ScriptDir "scripts\render-installer-config.py"),
  "--output",
  $ConfigPath,
  "--target",
  "windows"
)
if ($WithLocalModels) {
  $configArgs += "--with-local-models"
}
& $runtimePythonExe @configArgs

Push-Location (Join-Path $RepoRoot "frontend")
try {
  corepack pnpm run build:desktop
} finally {
  Pop-Location
}

Push-Location $ScriptDir
try {
  & npx "@tauri-apps/cli@^2" build --config $ConfigPath @TauriArgs
} finally {
  Pop-Location
}

if (-not $SkipSmoke) {
  & $runtimePythonExe (Join-Path $ScriptDir "scripts\smoke-release-artifacts.py")
}
