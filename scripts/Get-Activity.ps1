<#
.SYNOPSIS
    What moved in Azure DevOps recently, newest first.

.DESCRIPTION
    The project timeline as a list you can read in a terminal or paste into a note: who changed
    what, when, and what state it is in now. Reads the plugin's /api/activity route.

.PARAMETER Days
    How far back to look. Default 7.

.PARAMETER Person
    Optional: only lines where this person made the change.

.EXAMPLE
    .\scripts\Get-Activity.ps1
    .\scripts\Get-Activity.ps1 -Days 1
    .\scripts\Get-Activity.ps1 -Days 14 -Person "Derick Gagnon"
#>
param(
  [int]$Days = 7,
  [string]$Person = "",
  [string]$ApiBase = "http://127.0.0.1:3801"
)

$ErrorActionPreference = 'Stop'

try {
  $data = Invoke-RestMethod "$ApiBase/api/activity?days=$Days&top=200"
} catch {
  Write-Error "Could not reach Cadence at $ApiBase - is the app running? ($($_.Exception.Message))"
  exit 1
}

if ($data.error) { Write-Error $data.error; exit 1 }

$items = $data.items
if ($Person) { $items = @($items | Where-Object { $_.changedBy -eq $Person }) }

Write-Output ""
Write-Output "$($items.Count) changes in the last $Days days$(if ($Person) { " by $Person" })"
Write-Output ("-" * 78)

foreach ($i in $items) {
  $when = ([datetime]$i.changedDate).ToString("MM-dd HH:mm")
  $what = if ($i.isNew) { "created" } else { "updated" }
  Write-Output ("  {0}  {1,-7} {2,-10} #{3,-7} {4}" -f $when, $what, $i.state, $i.id, $i.title)
  Write-Output ("             by {0}{1}" -f $i.changedBy, $(if ($i.assignedTo) { " - with $($i.assignedTo)" } else { "" }))
}
Write-Output ""
