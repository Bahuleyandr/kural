param(
  [switch]$IncludePlaywright,
  [switch]$IncludeDocker,
  [switch]$SkipDesktop
)

$ErrorActionPreference = "Stop"
$argsList = @()

if ($IncludePlaywright) {
  $argsList += "--include-playwright"
}
if ($IncludeDocker) {
  $argsList += "--include-docker"
}
if ($SkipDesktop) {
  $argsList += "--skip-desktop"
}

python "$PSScriptRoot\rc1_release_gate.py" @argsList
exit $LASTEXITCODE
