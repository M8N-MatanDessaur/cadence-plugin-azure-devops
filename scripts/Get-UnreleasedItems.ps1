<#
.SYNOPSIS
    Work items resolved or closed since the pipeline last succeeded (or in the last 30 days without a pipeline).
.EXAMPLE
    ./scripts/Get-UnreleasedItems.ps1 -Id 42
#>
[CmdletBinding()]
param(
    [int]$Id = 0
)
$ErrorActionPreference = 'Stop'
$CadenceApi = if ($env:CADENCE_API) { $env:CADENCE_API } else { 'http://127.0.0.1:3800' }
$headers = @{}
if ($env:CADENCE_TOKEN) { $headers['x-cadence-token'] = $env:CADENCE_TOKEN }
function Get-Api($path) { Invoke-RestMethod -Uri "$CadenceApi$path" -Headers $headers -TimeoutSec 300 }
function Post-Api($path, $payload) { Invoke-RestMethod -Uri "$CadenceApi$path" -Method Post -Headers $headers -ContentType 'application/json' -Body ($payload | ConvertTo-Json -Depth 8) -TimeoutSec 300 }
function Esc($s) { [uri]::EscapeDataString([string]$s) }
function Out-Json($o, $d = 6) { ConvertTo-Json -InputObject $o -Depth $d }
Get-Api "/api/pipelines/unreleased$(if ($Id) { "?id=$Id" })" | ConvertTo-Json -Depth 5
