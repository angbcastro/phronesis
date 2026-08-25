<#
  Recria o atalho "Phronesis" na área de trabalho.

  O atalho aponta para `scripts/dev.ps1`. Rode este script se o atalho sumir,
  se a pasta do projeto mudar de lugar ou noutra máquina Windows:

      powershell -ExecutionPolicy Bypass -File scripts\atalho.ps1
#>

try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch { }

$raiz    = Split-Path -Parent $PSScriptRoot
$destino = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Phronesis.lnk'

$ws  = New-Object -ComObject WScript.Shell
$lnk = $ws.CreateShortcut($destino)
$lnk.TargetPath       = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$lnk.Arguments        = '-NoProfile -ExecutionPolicy Bypass -File "' + (Join-Path $raiz 'scripts\dev.ps1') + '"'
$lnk.WorkingDirectory = $raiz
$lnk.IconLocation     = (Join-Path $raiz 'scripts\phronesis.ico') + ',0'
$lnk.Description      = 'Sobe o servidor de desenvolvimento do Phronesis e abre o navegador'
$lnk.Save()

Write-Host "Atalho criado: $destino"
