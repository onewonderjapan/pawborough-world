# serve-windows.ps1 — 薄启动器（Windows 路径未实测，不承诺正确；仅转发到 Node 工具）。
# 前提：node >= 22 在 PATH。用法：
#   powershell -File tools\portable\serve-windows.ps1 -Package <包目录> -Dest <新的空目录>
param(
  [Parameter(Mandatory = $true)][string]$Package,
  [Parameter(Mandatory = $true)][string]$Dest,
  [int]$Port = 5603,
  [string]$SourceCache = ""
)
$tool = Join-Path $PSScriptRoot "restore.mjs"
if (-not (Test-Path $tool)) { Write-Error "restore.mjs not found next to this launcher"; exit 1 }
$nodeArgs = @($tool, "--package", $Package, "--dest", $Dest, "--port", "$Port")
if ($SourceCache -ne "") { $nodeArgs += @("--source-cache", $SourceCache) }
node @nodeArgs
exit $LASTEXITCODE
