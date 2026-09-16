<#
.SYNOPSIS
    Shows what one person is carrying, and what they have finished lately.

.DESCRIPTION
    The question a standup actually opens with, answered without going to dev.azure.com:
    everything open and assigned to someone, their point load, and what they have closed in
    the window. Reads the plugin's /api/person route, so it sees exactly what the board sees.

.PARAMETER Who
    Display name as Azure DevOps knows it, e.g. "Derick Gagnon".

.PARAMETER Days
    How far back to look for finished work. Default 30.

.EXAMPLE
    .\scripts\Get-PersonLoad.ps1 -Who "Derick Gagnon"
    .\scripts\Get-PersonLoad.ps1 -Who "Kapil Bansal" -Days 60
#>
param(
  [Parameter(Mandatory = $true)][string]$Who,
  [int]$Days = 30,
  [string]$ApiBase = "http://127.0.0.1:3801"
)

$ErrorActionPreference = 'Stop'
$encoded = [System.Uri]::EscapeDataString($Who)

try {
  $data = Invoke-RestMethod "$ApiBase/api/person?who=$encoded&days=$Days"
} catch {
  Write-Error "Could not reach Cadence at $ApiBase - is the app running? ($($_.Exception.Message))"
  exit 1
}

if ($data.error) { Write-Error $data.error; exit 1 }

$open = @($data.items | Where-Object { $_.state -notmatch 'Closed|Done|Removed|Resolved' })
$done = @($data.items | Where-Object { $_.state -match 'Closed|Done|Resolved' })

Write-Output ""
Write-Output "$($data.who) - $($data.counts.open) open, $($data.counts.points) points, $($data.counts.total) touched in $Days days"
Write-Output ("-" * 72)

if ($open.Count -eq 0) {
  Write-Output "  Nothing open."
} else {
  Write-Output "  CARRYING"
  foreach ($i in $open) {
    $pts = if ($i.storyPoints) { " [$($i.storyPoints) pts]" } else { "" }
    Write-Output ("    {0,-12} #{1,-7} {2}{3}" -f $i.state, $i.id, $i.title, $pts)
  }
}

if ($done.Count -gt 0) {
  Write-Output ""
  Write-Output "  FINISHED RECENTLY"
  foreach ($i in ($done | Select-Object -First 10)) {
    Write-Output ("    {0,-12} #{1,-7} {2}" -f $i.state, $i.id, $i.title)
  }
}
Write-Output ""
