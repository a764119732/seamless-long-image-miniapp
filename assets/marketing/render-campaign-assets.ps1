$ErrorActionPreference = "Stop"

$assetRoot = $PSScriptRoot
$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
$repoRoot = (Resolve-Path (Join-Path $assetRoot "..\..")).Path
if (-not (Test-Path -LiteralPath $chrome)) {
  throw "Chrome not found: $chrome"
}

$templateUri = [Uri]::new((Join-Path $assetRoot "campaign-card.html")).AbsoluteUri
$jobs = @(
  @{ Name = "qingfeng-horizontal-comparison-3x4-safe.png"; Size = "1080,1440"; Query = "qr=0" },
  @{ Name = "qingfeng-horizontal-comparison-9x16-safe.png"; Size = "1080,1920"; Query = "qr=0" },
  @{ Name = "qingfeng-horizontal-comparison-3x4-wechat.png"; Size = "1080,1440"; Query = "qr=1" },
  @{ Name = "qingfeng-horizontal-comparison-16x9-x.png"; Size = "1600,900"; Query = "qr=1" }
)

foreach ($job in $jobs) {
  $output = Join-Path $assetRoot $job.Name
  $profileRoot = Join-Path $repoRoot ".tools\chrome-render-profile-$($job.Name)"
  New-Item -ItemType Directory -Force -Path $profileRoot | Out-Null
  & $chrome `
    --headless=new `
    --disable-gpu `
    --hide-scrollbars `
    --force-device-scale-factor=1 `
    "--user-data-dir=$profileRoot" `
    "--window-size=$($job.Size)" `
    "--screenshot=$output" `
    "$templateUri`?$($job.Query)"
}

for ($attempt = 0; $attempt -lt 100; $attempt += 1) {
  $missing = $jobs | Where-Object { -not (Test-Path -LiteralPath (Join-Path $assetRoot $_.Name)) }
  if (-not $missing) { break }
  Start-Sleep -Milliseconds 100
}
if ($missing) {
  throw "Campaign render failed: $($missing.Name -join ', ')"
}
