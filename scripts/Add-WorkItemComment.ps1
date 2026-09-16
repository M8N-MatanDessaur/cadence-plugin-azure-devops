<#
.SYNOPSIS
    Adds a comment to a work item.

.DESCRIPTION
    Leaves a note on a work item without opening a browser - the thing you want right after
    you find something while working. Goes through Cadence, so the write is permission-gated
    like any other.

.PARAMETER Id
    Work item number.

.PARAMETER Text
    The comment.

.EXAMPLE
    .\scripts\Add-WorkItemComment.ps1 -Id 95863 -Text "Reproduced on staging - the sort is by created, not modified."
#>
param(
  [Parameter(Mandatory = $true)][int]$Id,
  [Parameter(Mandatory = $true)][string]$Text,
  [string]$ApiBase = "http://127.0.0.1:3801"
)

$ErrorActionPreference = 'Stop'
$headers = @{}
if ($env:CADENCE_TOKEN) { $headers['x-cadence-token'] = $env:CADENCE_TOKEN }
$body = @{ text = $Text } | ConvertTo-Json

try {
  $result = Invoke-RestMethod "$ApiBase/api/workitems/$Id/comments" -Method Post -Headers $headers -ContentType 'application/json' -Body $body
} catch {
  Write-Error "Could not comment on #$Id ($($_.Exception.Message))"
  exit 1
}

if ($result.error) { Write-Error $result.error; exit 1 }
Write-Output "Commented on #$Id as $($result.author)."
