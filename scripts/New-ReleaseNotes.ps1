<#
.SYNOPSIS
    Release notes between two runs as Markdown (work items by type, commits by conventional type); -From defaults to the previous successful run. -Raw prints the JSON instead.
.EXAMPLE
    ./scripts/New-ReleaseNotes.ps1 -Id 42 -To 12345
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][int]$Id,
    [Parameter(Mandatory)][int]$To,
    [int]$From = 0,
    [switch]$Raw
)
$ErrorActionPreference = 'Stop'
$CadenceApi = if ($env:CADENCE_API) { $env:CADENCE_API } else { 'http://127.0.0.1:3800' }
$headers = @{}
if ($env:CADENCE_TOKEN) { $headers['x-cadence-token'] = $env:CADENCE_TOKEN }
function Get-Api($path) { Invoke-RestMethod -Uri "$CadenceApi$path" -Headers $headers -TimeoutSec 300 }
function Post-Api($path, $payload) { Invoke-RestMethod -Uri "$CadenceApi$path" -Method Post -Headers $headers -ContentType 'application/json' -Body ($payload | ConvertTo-Json -Depth 8) -TimeoutSec 300 }
function Esc($s) { [uri]::EscapeDataString([string]$s) }
function Out-Json($o, $d = 6) { ConvertTo-Json -InputObject $o -Depth $d }
$r = Get-Api "/api/pipelines/notes?id=$Id&to=$To$(if ($From) { "&from=$From" })"
if ($Raw) { $r | ConvertTo-Json -Depth 6 } else { $r.markdown }
