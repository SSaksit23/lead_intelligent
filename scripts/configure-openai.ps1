$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$envPath = Join-Path $projectRoot '.env'
if (-not (Test-Path -LiteralPath $envPath)) { throw 'GO365 .env file not found.' }
$secureKey = Read-Host 'Enter your OpenAI API key (input hidden)' -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
try { $apiKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
if (-not $apiKey -or $apiKey.Length -lt 20 -or $apiKey -match '[\r\n]') { throw 'API key is missing or malformed.' }
$secretDir = Join-Path $env:LOCALAPPDATA 'GO365'
New-Item -ItemType Directory -Path $secretDir -Force | Out-Null
$secretPath = Join-Path $secretDir 'openai-key'
[System.IO.File]::WriteAllText($secretPath, $apiKey, [System.Text.UTF8Encoding]::new($false))
$lines = [System.Collections.Generic.List[string]]::new()
foreach ($line in [System.IO.File]::ReadAllLines($envPath)) {
  if ($line -match '^(OPENAI_API_KEY|OPENAI_API_KEY_FILE|OPENAI_MODEL|AI_SEGMENT_ENABLED)=') { continue }
  $lines.Add($line)
}
$lines.Add('OPENAI_API_KEY_FILE=' + $secretPath)
$lines.Add('OPENAI_MODEL=gpt-5-mini')
$lines.Add('AI_SEGMENT_ENABLED=true')
[System.IO.File]::WriteAllLines($envPath, $lines, [System.Text.UTF8Encoding]::new($false))
$apiKey = $null
Write-Output 'GO365 OpenAI key saved outside OneDrive under your local AppData. Restart the web app and worker to activate it.'
