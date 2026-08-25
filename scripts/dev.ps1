<#
  Sobe o ambiente de desenvolvimento do Phronesis e abre o navegador.

  Atalho da área de trabalho aponta para cá. Fechar esta janela derruba o
  servidor — é o jeito de parar.

  Duas conferências antes de subir, porque as duas falham em silêncio:
  falta de `.env.local` (o servidor sobe e morre na primeira rota) e porta
  3000 ocupada (o Next escolhe outra porta, o CORS do bucket só libera a
  3000, e aí nenhum bloco de áudio sobe sem a tela dizer nada).
#>

# O console do PowerShell 5.1 nasce com codepage legado; sem isto os acentos
# das mensagens abaixo saem como lixo.
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch { }

$raiz = Split-Path -Parent $PSScriptRoot
$url  = 'http://localhost:3000'

function Porta3000Responde {
  $c = New-Object Net.Sockets.TcpClient
  try { $c.Connect('127.0.0.1', 3000); $c.Close(); return $true }
  catch { return $false }
}

function Pausar($mensagem) {
  Write-Host ''
  Write-Host $mensagem -ForegroundColor Yellow
  $null = Read-Host 'Enter para fechar'
}

$Host.UI.RawUI.WindowTitle = 'Phronesis — dev'
Write-Host ''
Write-Host '  Phronesis' -ForegroundColor DarkYellow
Write-Host "  $raiz" -ForegroundColor DarkGray
Write-Host ''

Set-Location $raiz

if (-not (Test-Path (Join-Path $raiz '.env.local'))) {
  Write-Host '  Falta o arquivo .env.local na raiz do projeto.' -ForegroundColor Red
  Write-Host '  Copie o .env.example e preencha as 11 variáveis.' -ForegroundColor Red
  Pausar 'Sem ele o servidor sobe mas nenhuma rota funciona.'
  exit 1
}

if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
  Write-Host '  pnpm não está no PATH.' -ForegroundColor Red
  Pausar 'Instale com: npm install -g pnpm'
  exit 1
}

if (Porta3000Responde) {
  Write-Host '  A porta 3000 já está respondendo — o sistema parece estar no ar.' -ForegroundColor Yellow
  Write-Host '  Abrindo o navegador na instância que já existe.' -ForegroundColor DarkGray
  Start-Process $url
  Start-Sleep -Seconds 2
  exit 0
}

# Abre o navegador só quando a porta atender de verdade: `next dev` demora
# alguns segundos e abrir antes disso mostra "não foi possível conectar".
Start-Job -ArgumentList $url -ScriptBlock {
  param($url)
  for ($i = 0; $i -lt 120; $i++) {
    Start-Sleep -Milliseconds 500
    $c = New-Object Net.Sockets.TcpClient
    try { $c.Connect('127.0.0.1', 3000); $c.Close(); Start-Process $url; return }
    catch { }
  }
} | Out-Null

# O motivo de uma transcrição que falhou sai como `[stt]` / `[pipeline]` no
# stderr do servidor. Só na janela, esse motivo morre quando a janela fecha —
# e a tela do app não diz mais que "a transcrição falhou". Por isso: arquivo.
$pastaLog = Join-Path $raiz 'logs'
if (-not (Test-Path $pastaLog)) { New-Item -ItemType Directory -Path $pastaLog | Out-Null }
$log = Join-Path $pastaLog ('dev-' + (Get-Date -Format 'yyyy-MM-dd_HH-mm-ss') + '.log')

Write-Host '  Subindo o servidor. O navegador abre sozinho em alguns segundos.'
Write-Host "  Log desta sessão: $log" -ForegroundColor DarkGray
Write-Host '  Feche esta janela para parar.' -ForegroundColor DarkGray
Write-Host ''

# O `2>&1` é feito pelo cmd de propósito: redirecionado pelo PowerShell, cada
# linha de stderr vira um ErrorRecord e o log sai coberto de NativeCommandError.
cmd /c "pnpm dev 2>&1" | Tee-Object -FilePath $log
$codigo = $LASTEXITCODE

Get-Job | Remove-Job -Force -ErrorAction SilentlyContinue

if ($codigo -ne 0) {
  Pausar "O servidor terminou com erro (código $codigo). A mensagem está acima."
}
