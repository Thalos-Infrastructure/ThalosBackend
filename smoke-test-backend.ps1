param(
  [string]$BackendUrl = "http://localhost:3001",
  [string]$Token = "",
  [string]$UserId = "11111111-1111-1111-1111-111111111111",
  [Parameter(Mandatory = $true)][string]$CreatedByWallet,
  [Parameter(Mandatory = $true)][string]$PayeeWallet,
  [string]$InternalSecret = ""
)

$ErrorActionPreference = "Stop"

function Write-Step([string]$Message) {
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Fail([string]$Message) {
  Write-Host "FAIL: $Message" -ForegroundColor Red
  exit 1
}

function Invoke-JsonRequest {
  param(
    [Parameter(Mandatory = $true)][string]$Method,
    [Parameter(Mandatory = $true)][string]$Url,
    [hashtable]$Headers = @{},
    [object]$Body = $null
  )

  $params = @{
    Method = $Method
    Uri = $Url
    Headers = $Headers
  }

  if ($null -ne $Body) {
    $params["ContentType"] = "application/json"
    $params["Body"] = ($Body | ConvertTo-Json -Depth 20)
  }

  $resp = Invoke-WebRequest @params
  $json = $null

  if ($resp.Content) {
    try {
      $json = $resp.Content | ConvertFrom-Json
    } catch {
      $json = $null
    }
  }

  return @{
    Status = [int]$resp.StatusCode
    Json = $json
    Raw = $resp.Content
  }
}

if ([string]::IsNullOrWhiteSpace($Token)) {
  if ($env:THALOS_TEST_TOKEN) {
    $Token = $env:THALOS_TEST_TOKEN
  }
}

if ([string]::IsNullOrWhiteSpace($Token)) {
  Fail "Falta token JWT. Pasalo con -Token o seteá THALOS_TEST_TOKEN."
}

$base = $BackendUrl.TrimEnd("/")
$authHeaders = @{ Authorization = "Bearer $Token" }

Write-Step "1) POST /v1/agreements (crear acuerdo)"
$title = "Smoke Test Backend $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
$createBody = @{
  title = $title
  description = "Prueba automatizada backend"
  amount = "10"
  asset = "USDC"
  agreement_type = "single"
  created_by = $CreatedByWallet
  participants = @(
    @{ wallet_address = $CreatedByWallet; role = "payer" },
    @{ wallet_address = $PayeeWallet; role = "payee" }
  )
}

$create = Invoke-JsonRequest -Method "POST" -Url "$base/v1/agreements" -Headers $authHeaders -Body $createBody
if ($create.Status -lt 200 -or $create.Status -ge 300) {
  Fail "No se pudo crear acuerdo. HTTP $($create.Status)."
}

$agreementId = $create.Json.agreement.id
if ([string]::IsNullOrWhiteSpace($agreementId)) {
  Fail "La respuesta de create no trajo agreement.id. Raw: $($create.Raw)"
}

Write-Host "OK create -> agreement.id=$agreementId" -ForegroundColor Green

Write-Step "2) GET /v1/agreements/by-wallet"
$byWalletUrl = "$base/v1/agreements/by-wallet?wallet=$([uri]::EscapeDataString($CreatedByWallet))"
$list = Invoke-JsonRequest -Method "GET" -Url $byWalletUrl -Headers $authHeaders
if ($list.Status -lt 200 -or $list.Status -ge 300) {
  Fail "Fallo by-wallet. HTTP $($list.Status)."
}
Write-Host "OK by-wallet" -ForegroundColor Green

Write-Step "3) GET /v1/agreements/{id}"
$one = Invoke-JsonRequest -Method "GET" -Url "$base/v1/agreements/$agreementId" -Headers $authHeaders
if ($one.Status -lt 200 -or $one.Status -ge 300) {
  Fail "Fallo get agreement by id. HTTP $($one.Status)."
}
Write-Host "OK get-by-id" -ForegroundColor Green

Write-Step "4) POST /v1/trustless/prepare"
$prepareBody = @{
  method = "GET"
  path = "helper/get-escrows-by-signer"
  query = @{
    signer = $CreatedByWallet
    page = 1
    pageSize = 5
    validateOnChain = $true
  }
}
$prepare = Invoke-JsonRequest -Method "POST" -Url "$base/v1/trustless/prepare" -Headers $authHeaders -Body $prepareBody
if ($prepare.Status -lt 200 -or $prepare.Status -ge 300) {
  Fail "Fallo trustless/prepare. HTTP $($prepare.Status)."
}
Write-Host "OK trustless/prepare -> upstreamStatus=$($prepare.Json.status)" -ForegroundColor Green

if (-not [string]::IsNullOrWhiteSpace($InternalSecret)) {
  Write-Step "5) POST /v1/internal/trustless/relay"
  $internalHeaders = @{ "x-thalos-internal-secret" = $InternalSecret }
  $relay = Invoke-JsonRequest -Method "POST" -Url "$base/v1/internal/trustless/relay" -Headers $internalHeaders -Body $prepareBody
  if ($relay.Status -lt 200 -or $relay.Status -ge 300) {
    Fail "Fallo internal relay. HTTP $($relay.Status)."
  }
  Write-Host "OK internal relay -> upstreamStatus=$($relay.Json.status)" -ForegroundColor Green
}

Write-Step "6) POST /v1/disputes (abrir disputa)"
$disputeBody = @{
  agreement_id = $agreementId
  opened_by = $CreatedByWallet
  reason = "Smoke test dispute - incumplimiento de milestones"
  evidence_urls = @("https://example.com/evidence1.pdf")
}
$openDispute = Invoke-JsonRequest -Method "POST" -Url "$base/v1/disputes" -Headers $authHeaders -Body $disputeBody
if ($openDispute.Status -lt 200 -or $openDispute.Status -ge 300) {
  Fail "No se pudo abrir disputa. HTTP $($openDispute.Status). Raw: $($openDispute.Raw)"
}
$disputeId = $openDispute.Json.dispute.id
if ([string]::IsNullOrWhiteSpace($disputeId)) {
  Fail "La respuesta de openDispute no trajo dispute.id. Raw: $($openDispute.Raw)"
}
Write-Host "OK dispute opened -> dispute.id=$disputeId" -ForegroundColor Green

Write-Step "7) GET /v1/disputes/open"
$openList = Invoke-JsonRequest -Method "GET" -Url "$base/v1/disputes/open" -Headers $authHeaders
if ($openList.Status -lt 200 -or $openList.Status -ge 300) {
  Fail "Fallo get open disputes. HTTP $($openList.Status)."
}
Write-Host "OK open disputes list count=$(@($openList.Json.disputes).Count)" -ForegroundColor Green

Write-Step "8) PATCH /v1/disputes/{id}/resolve"
$resolveBody = @{
  resolved_by = $CreatedByWallet
  payer_percentage = 50
  payee_percentage = 50
  resolution_notes = "Smoke test resolution - ambas partes de acuerdo"
}
$resolve = Invoke-JsonRequest -Method "PATCH" -Url "$base/v1/disputes/$disputeId/resolve" -Headers $authHeaders -Body $resolveBody
if ($resolve.Status -lt 200 -or $resolve.Status -ge 300) {
  Fail "Fallo resolver disputa. HTTP $($resolve.Status). Raw: $($resolve.Raw)"
}
Write-Host "OK dispute resolved" -ForegroundColor Green

Write-Step "9) GET /v1/disputes/by-agreement/{agreementId}"
$byAgreement = Invoke-JsonRequest -Method "GET" -Url "$base/v1/disputes/by-agreement/$agreementId" -Headers $authHeaders
if ($byAgreement.Status -lt 200 -or $byAgreement.Status -ge 300) {
  Fail "Fallo get disputes by agreement. HTTP $($byAgreement.Status)."
}
Write-Host "OK disputes by agreement count=$(@($byAgreement.Json.disputes).Count)" -ForegroundColor Green

Write-Host ""
Write-Host "Smoke test finalizado correctamente." -ForegroundColor Green
Write-Host "Agreement: $agreementId"
Write-Host "Dispute: $disputeId"
