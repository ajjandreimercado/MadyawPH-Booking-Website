$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$t = Get-Date -UFormat %s
$email = "ai_test_$t@example.com"
$body = @{ name = "AI Test"; email = $email; password = "TestPass123!" } | ConvertTo-Json
try {
  $resp = Invoke-RestMethod -Uri "http://localhost:5000/api/auth/register" -Method Post -Body $body -ContentType "application/json" -WebSession $session -ErrorAction Stop
  Write-Output "REGISTER_OK"
  $resp | ConvertTo-Json -Compress
} catch {
  Write-Output "REGISTER_FAILED"
  Write-Output $_.Exception.Message
}
# show cookies
$session.Cookies.GetCookies("http://localhost:5000") | ForEach-Object { Write-Output ($_.Name + "=" + $_.Value) }
# call me
try {
  $me = Invoke-RestMethod -Uri "http://localhost:5000/api/auth/me" -Method Get -WebSession $session -ErrorAction Stop
  Write-Output "ME_OK"
  $me | ConvertTo-Json -Compress
} catch {
  Write-Output "ME_FAILED"
  Write-Output $_.Exception.Message
}
