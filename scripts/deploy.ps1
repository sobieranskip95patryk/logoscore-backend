# ─────────────────────────────────────────────────────────────────────────────
# Sprint XII — Lokalny deploy logoscore-backend na Cloud Run.
# Wymaga: gcloud auth login, włączone API z deploy/README.md.
# ─────────────────────────────────────────────────────────────────────────────

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)] [string] $ProjectId,
    [Parameter(Mandatory = $true)] [string] $Region,
    [Parameter(Mandatory = $true)] [string] $ServiceSA,
    [string] $Service = 'logoscore-backend',
    [string] $ArRepo = 'logoscore'
)

$ErrorActionPreference = 'Stop'

Write-Host "==> Cloud Build submit" -ForegroundColor Cyan
gcloud builds submit `
    --project=$ProjectId `
    --config=deploy/cloudbuild.yaml `
    --substitutions="_REGION=$Region,_AR_REPO=$ArRepo,_SERVICE=$Service,_CLOUD_RUN_SA=$ServiceSA" `
    --region=$Region

if ($LASTEXITCODE -ne 0) {
    Write-Error "Cloud Build failed (exit=$LASTEXITCODE)"
    exit $LASTEXITCODE
}

Write-Host "`n==> Verifying service URL" -ForegroundColor Cyan
$url = gcloud run services describe $Service `
    --project=$ProjectId `
    --region=$Region `
    --format='value(status.url)'

Write-Host "Service URL: $url" -ForegroundColor Green
Write-Host "`n==> Liveness probe" -ForegroundColor Cyan
Invoke-RestMethod -Uri "$url/api/health" -Method Get | ConvertTo-Json -Depth 4

Write-Host "`n==> Readiness probe" -ForegroundColor Cyan
try {
    Invoke-RestMethod -Uri "$url/api/ready" -Method Get | ConvertTo-Json -Depth 4
}
catch {
    Write-Warning "Readiness returned non-2xx — może wskazywać niezdrowy backend (PG/Mongo)."
    Write-Warning $_.Exception.Message
}

Write-Host "`nDONE." -ForegroundColor Green
