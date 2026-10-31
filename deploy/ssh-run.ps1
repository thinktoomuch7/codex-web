param(
  [Parameter(Mandatory = $true)][string]$ScriptPath,
  [int]$TimeoutSec = 240
)
$ErrorActionPreference = "Stop"
$root = "E:\project\codex-web\deploy\.ssh-session"
if (-not (Test-Path (Join-Path $root "ready"))) { throw "ssh session is not ready" }
$utf8 = New-Object System.Text.UTF8Encoding $false
$cmd = [System.IO.File]::ReadAllText($ScriptPath).Replace("`r`n", "`n").Replace("`r", "`n")
Remove-Item (Join-Path $root "done") -ErrorAction SilentlyContinue
[System.IO.File]::WriteAllText((Join-Path $root "cmd.sh"), $cmd, $utf8)
[System.IO.File]::WriteAllText((Join-Path $root "cmd.ready"), "1")
$deadline = (Get-Date).AddSeconds($TimeoutSec)
while (-not (Test-Path (Join-Path $root "done"))) {
  if ((Get-Date) -gt $deadline) { throw "remote command timed out" }
  Start-Sleep -Milliseconds 200
}
$text = ""
if (Test-Path (Join-Path $root "out.txt")) {
  $text = [System.IO.File]::ReadAllText((Join-Path $root "out.txt"))
}
Write-Output $text
$code = 1
if (Test-Path (Join-Path $root "exit.code")) {
  $code = [int]([System.IO.File]::ReadAllText((Join-Path $root "exit.code")).Trim())
}
exit $code
