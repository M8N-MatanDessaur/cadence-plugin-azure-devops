<#
.SYNOPSIS
    Runs of one pipeline, newest first; -Branch narrows to a branch.
.EXAMPLE
    ./scripts/Get-PipelineRuns.ps1 -Id 42 -Top 20
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][int]$Id,
    [int]$Top = 30,
    [string]$Branch = ''
)
$ErrorActionPreference = 'Stop'
$CadenceApi = if ($env:CADENCE_API) { $env:CADENCE_API } else { 'http://127.0.0.1:3800' }
$headers = @{}
if ($env:CADENCE_TOKEN) { $headers['x-cadence-token'] = $env:CADENCE_TOKEN }
function Get-Api($path) { Invoke-RestMethod -Uri "$CadenceApi$path" -Headers $headers -TimeoutSec 300 }
function Post-Api($path, $payload) { Invoke-RestMethod -Uri "$CadenceApi$path" -Method Post -Headers $headers -ContentType 'application/json' -Body ($payload | ConvertTo-Json -Depth 8) -TimeoutSec 300 }
function Esc($s) { [uri]::EscapeDataString([string]$s) }
function Out-Json($o, $d = 6) { ConvertTo-Json -InputObject $o -Depth $d }
Out-Json @((Get-Api "/api/pipelines/runs?id=$Id&top=$Top&branch=$(Esc $Branch)").runs) 5
