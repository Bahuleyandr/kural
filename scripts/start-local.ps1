param(
  [string]$ToolsRoot = $env:KURAL_TOOLS_ROOT,
  [string]$BackendPython = $env:KURAL_BACKEND_PYTHON,
  [string]$BackendHost = "127.0.0.1",
  [int]$BackendPort = 8000,
  [string]$FrontendHost = "127.0.0.1",
  [int]$FrontendPort = 3000,
  [switch]$Setup,
  [switch]$ProvisionModels,
  [switch]$InstallCloneRuntime,
  [switch]$NoFrontend
)

$ErrorActionPreference = "Stop"

function Resolve-DefaultToolsRoot {
  if ($ToolsRoot) {
    return $ToolsRoot
  }
  if (Test-Path "D:\Dev\Tools") {
    return "D:\Dev\Tools"
  }
  return Join-Path $env:USERPROFILE ".kural\tools"
}

function Require-Command($Name, $Hint) {
  $command = Get-Command $Name -ErrorAction SilentlyContinue
  if (-not $command) {
    throw "$Name is required. $Hint"
  }
  return $command.Source
}

function Wait-ForBackend($Url) {
  for ($i = 0; $i -lt 60; $i++) {
    try {
      Invoke-RestMethod -Uri $Url -TimeoutSec 2 | Out-Null
      return
    } catch {
      Start-Sleep -Seconds 1
    }
  }
  throw "Backend did not become healthy at $Url"
}

function Stop-IfRunning($Process) {
  if ($Process -and -not $Process.HasExited) {
    Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue
  }
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$backendDir = Join-Path $repoRoot "backend"
$frontendDir = Join-Path $repoRoot "frontend"
$tools = Resolve-DefaultToolsRoot
$venvDir = Join-Path $tools "kural-local-models\.venv"
$modelsRoot = Join-Path $tools "kural-models"
$defaultPython = Join-Path $venvDir "Scripts\python.exe"

New-Item -ItemType Directory -Force -Path $tools, $modelsRoot | Out-Null

if ($Setup) {
  $env:UV_PYTHON_INSTALL_DIR = Join-Path $tools "uv\python"
  Require-Command "uv" "Install uv first, or create the venv manually and pass -BackendPython." | Out-Null
  uv python install 3.11
  uv venv $venvDir --python 3.11
  uv pip install --python $defaultPython `
    -r (Join-Path $backendDir "requirements.txt") `
    -r (Join-Path $backendDir "requirements-dev.txt") `
    -r (Join-Path $backendDir "requirements-local-models.txt")

  if ($InstallCloneRuntime) {
    uv pip install --python $defaultPython -r (Join-Path $backendDir "requirements-clone.txt")
    uv pip install --python $defaultPython --no-deps chatterbox-tts==0.1.7
  }
}

if (-not $BackendPython) {
  $BackendPython = $defaultPython
}
if (-not (Test-Path $BackendPython)) {
  throw "Backend Python not found at $BackendPython. Run scripts\start-local.ps1 -Setup first."
}

$env:MODEL_CACHE_DIR = $env:MODEL_CACHE_DIR
if (-not $env:MODEL_CACHE_DIR) {
  $env:MODEL_CACHE_DIR = Join-Path $modelsRoot "tts\kokoro"
}
$env:CLONE_CACHE_DIR = $env:CLONE_CACHE_DIR
if (-not $env:CLONE_CACHE_DIR) {
  $env:CLONE_CACHE_DIR = Join-Path $modelsRoot "clones"
}
$env:FASTER_WHISPER_MODEL_DIR = $env:FASTER_WHISPER_MODEL_DIR
if (-not $env:FASTER_WHISPER_MODEL_DIR) {
  $env:FASTER_WHISPER_MODEL_DIR = Join-Path $modelsRoot "asr\faster-whisper-tiny"
}
$env:ARGOS_PACKAGES_DIR = $env:ARGOS_PACKAGES_DIR
if (-not $env:ARGOS_PACKAGES_DIR) {
  $env:ARGOS_PACKAGES_DIR = Join-Path $modelsRoot "translation\argos\packages"
}
$env:ARGOS_PACKAGE_DIR = $env:ARGOS_PACKAGES_DIR
$env:HF_HOME = $env:HF_HOME
if (-not $env:HF_HOME) {
  $env:HF_HOME = Join-Path $tools "huggingface-cache"
}

New-Item -ItemType Directory -Force -Path `
  $env:MODEL_CACHE_DIR, `
  $env:CLONE_CACHE_DIR, `
  $env:FASTER_WHISPER_MODEL_DIR, `
  $env:ARGOS_PACKAGES_DIR, `
  $env:HF_HOME | Out-Null

$kokoroModel = Join-Path $env:MODEL_CACHE_DIR "kokoro-v1.0.int8.onnx"
$kokoroVoices = Join-Path $env:MODEL_CACHE_DIR "voices-v1.0.bin"
if ($ProvisionModels -or -not (Test-Path $kokoroModel) -or -not (Test-Path $kokoroVoices)) {
  & $BackendPython (Join-Path $backendDir "scripts\download_models.py")
}

if ($ProvisionModels) {
  & $BackendPython (Join-Path $backendDir "scripts\provision_local_models.py") --root $modelsRoot
}

$backendUrl = "http://${BackendHost}:${BackendPort}"
$frontendUrl = "http://${FrontendHost}:${FrontendPort}"
$env:NEXT_PUBLIC_API_URL = $backendUrl

$backendProcess = $null
$frontendProcess = $null

try {
  Write-Host "Starting Kural backend at $backendUrl"
  $backendProcess = Start-Process `
    -FilePath $BackendPython `
    -ArgumentList @("-m", "uvicorn", "app.main:app", "--host", $BackendHost, "--port", "$BackendPort") `
    -WorkingDirectory $backendDir `
    -PassThru `
    -NoNewWindow

  Wait-ForBackend "$backendUrl/api/health"

  Write-Host "Backend ready."
  Write-Host "Model cache: $env:MODEL_CACHE_DIR"
  Write-Host "ASR model: $env:FASTER_WHISPER_MODEL_DIR"
  Write-Host "Argos packages: $env:ARGOS_PACKAGES_DIR"

  if (-not $NoFrontend) {
    $corepack = Require-Command "corepack" "Install Node.js 22+ with Corepack enabled."
    Write-Host "Starting Kural frontend at $frontendUrl"
    $frontendProcess = Start-Process `
      -FilePath $corepack `
      -ArgumentList @("pnpm", "dev", "--", "--hostname", $FrontendHost, "--port", "$FrontendPort") `
      -WorkingDirectory $frontendDir `
      -PassThru `
      -NoNewWindow
  }

  Write-Host ""
  Write-Host "Kural is running."
  Write-Host "API: $backendUrl"
  if (-not $NoFrontend) {
    Write-Host "UI:  $frontendUrl"
  }
  Write-Host "Press Ctrl+C to stop."

  while (-not $backendProcess.HasExited -and (-not $frontendProcess -or -not $frontendProcess.HasExited)) {
    Start-Sleep -Seconds 2
  }
} finally {
  Stop-IfRunning $frontendProcess
  Stop-IfRunning $backendProcess
}
