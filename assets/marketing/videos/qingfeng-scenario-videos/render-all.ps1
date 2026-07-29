$ErrorActionPreference = "Stop"

$projectRoot = $PSScriptRoot
$repoRoot = (Resolve-Path (Join-Path $projectRoot "..\..\..\..")).Path
$ffmpegBin = Join-Path $repoRoot ".tools\ffmpeg\ffmpeg-8.1.2-essentials_build\bin"
$npmCache = Join-Path $repoRoot ".tools\npm-cache"
$outputTemplate = Join-Path $projectRoot "final\{scenario}.mp4"

$env:npm_config_cache = $npmCache
$env:Path = "$ffmpegBin;$env:Path"

New-Item -ItemType Directory -Force (Join-Path $projectRoot "final") | Out-Null

Push-Location $projectRoot
try {
  npx --yes hyperframes@0.7.80 render `
    --batch "render-batch.json" `
    --output $outputTemplate `
    --batch-concurrency 1 `
    --strict-variables `
    --quality high `
    --resolution portrait

  if ($LASTEXITCODE -ne 0) {
    throw "HyperFrames batch render failed with exit code $LASTEXITCODE."
  }
}
finally {
  Pop-Location
}
