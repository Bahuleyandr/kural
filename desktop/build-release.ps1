param(
  [switch]$WithClone,
  [switch]$SkipRuntimeProvision,
  [switch]$SkipSmoke,
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$TauriArgs
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Resolve-Path (Join-Path $ScriptDir "..")
$ConfigPath = Join-Path $ScriptDir "target\tauri-release.conf.json"

if (-not $env:KURAL_UPDATER_PUBLIC_KEY) {
  throw "KURAL_UPDATER_PUBLIC_KEY is required. Generate it with the Tauri signer and keep the private key secret."
}
if (-not $env:TAURI_SIGNING_PRIVATE_KEY) {
  throw "TAURI_SIGNING_PRIVATE_KEY is required for updater artifact signatures."
}

if (-not $SkipRuntimeProvision) {
  $runtimeArgs = @(
    (Join-Path $ScriptDir "scripts\provision-backend-runtime.py"),
    "--target",
    (Join-Path $ScriptDir "runtime\python")
  )
  if ($WithClone) {
    $runtimeArgs += "--with-clone"
  }
  python @runtimeArgs
}

python (Join-Path $ScriptDir "scripts\render-release-config.py") --output $ConfigPath

Push-Location (Join-Path $RepoRoot "frontend")
try {
  npx pnpm@9.15.9 run build:desktop
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
  python (Join-Path $ScriptDir "scripts\smoke-release-artifacts.py") --require-signatures
}
