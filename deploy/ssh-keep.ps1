$ErrorActionPreference = "Stop"
$root = "E:\project\codex-web\deploy\.ssh-session"
New-Item -ItemType Directory -Force -Path $root | Out-Null
$pidFile = Join-Path $root "bridge.pid"
if (Test-Path $pidFile) {
  $old = Get-Content $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($old -and (Get-Process -Id $old -ErrorAction SilentlyContinue)) {
    Write-Output "already-running $old"
    exit 0
  }
}

$loop = @'
echo __CW_READY__
: > /tmp/cw-pending.sh
while IFS= read -r line; do
  if [ "$line" = "__CW_END__" ]; then
    bash /tmp/cw-pending.sh > /tmp/cw-chunk.out 2>&1
    code=$?
    : > /tmp/cw-pending.sh
    printf '%s\n' __CW_BEGIN__
    cat /tmp/cw-chunk.out
    printf '%s\n' "__CW_DONE_${code}__"
  else
    printf '%s\n' "$line" >> /tmp/cw-pending.sh
  fi
done
'@
$b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($loop.Replace("`r`n", "`n")))
$remote = "echo $b64 | base64 -d > /tmp/cw-loop.sh; exec bash --noprofile --norc /tmp/cw-loop.sh"

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = "ssh"
$psi.Arguments = "-o BatchMode=yes -o ServerAliveInterval=20 -o ServerAliveCountMax=6 -T myserver `"$remote`""
[System.IO.File]::WriteAllText((Join-Path $root "ssh-args.txt"), $psi.Arguments)
$psi.RedirectStandardInput = $true
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$psi.UseShellExecute = $false
$psi.CreateNoWindow = $true
$p = New-Object System.Diagnostics.Process
$p.StartInfo = $psi
if (-not $p.Start()) { throw "ssh failed to start" }
[System.IO.File]::WriteAllText($pidFile, "$($p.Id)")

$utf8 = New-Object System.Text.UTF8Encoding $false
$writer = New-Object System.IO.StreamWriter($p.StandardInput.BaseStream, $utf8)
$writer.NewLine = "`n"
$writer.AutoFlush = $true
$reader = New-Object System.IO.StreamReader($p.StandardOutput.BaseStream, $utf8)
$errPath = Join-Path $root "ssh-err.log"
$errTask = $p.StandardError.ReadToEndAsync()

$ready = $false
while (-not $ready) {
  $line = $reader.ReadLine()
  if ($null -eq $line) {
    $p.WaitForExit(5000) | Out-Null
    $err = ""
    try { $err = $errTask.Result } catch { $err = $_.Exception.Message }
    [System.IO.File]::WriteAllText($errPath, $err)
    throw "ssh closed before ready: $err"
  }
  if ($line -eq "__CW_READY__") { $ready = $true }
}
[System.IO.File]::WriteAllText((Join-Path $root "ready"), "1")
Write-Output "ssh-session-ready pid=$($p.Id)"

while (-not $p.HasExited) {
  $flag = Join-Path $root "cmd.ready"
  if (-not (Test-Path $flag)) {
    Start-Sleep -Milliseconds 200
    continue
  }
  $cmd = [System.IO.File]::ReadAllText((Join-Path $root "cmd.sh"))
  Remove-Item $flag -Force
  foreach ($line in ($cmd -split "`n")) {
    $writer.WriteLine(($line -replace "`r$", ""))
  }
  $writer.WriteLine("__CW_END__")
  $out = New-Object System.Collections.Generic.List[string]
  $exit = "1"
  while ($true) {
    $line = $reader.ReadLine()
    if ($null -eq $line) { $exit = "255"; break }
    if ($line -eq "__CW_BEGIN__") { continue }
    if ($line -match '^__CW_DONE_(\d+)__$') { $exit = $Matches[1]; break }
    $out.Add($line)
  }
  [System.IO.File]::WriteAllText((Join-Path $root "out.txt"), ($out -join "`n"), $utf8)
  [System.IO.File]::WriteAllText((Join-Path $root "exit.code"), $exit)
  [System.IO.File]::WriteAllText((Join-Path $root "done"), "1")
}
Write-Output "ssh-session-ended"
