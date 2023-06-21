Param(
  [string]$Major = "6",
  [string]$Minor = "2",
  [string]$Revision = "0",
  [string]$BuildNumber = "",
  [string]$Branch = "",
  [string]$Sha1 = ""
)

$global:ProductVersion = $BuildNumber
$global:OctopusVersion = $BuildNumber
$global:FriendlyProductVersion = $BuildNumber

Function Get-ProjectFolders($folders) {
  $Projects = New-Object System.Collections.Generic.List[System.Object]

  foreach ($folder in $folders) {
    foreach ($project in Get-ChildItem -Path $Folder -Include *.csproj -Recurse) {
      $projects.Add($project.Directory.FullName)
    }
  }

  return $projects
}

Function Get-AssemblyInfoPath($projectFolder) {
  return "$projectFolder\Properties\AssemblyInfo.cs"
}

Function Get-Part($value, $fallback) {
  If (!([string]::IsNullOrEmpty($value))) {
    return $value;
  }

  return $fallback
}

Function Set-AssemblyBuildVersion($path, $major, $minor, $buildNumber, $revision, $branch, $sha1) {
   If (Test-Path($path)) {
     $assemblyProductPattern = '^(\[assembly: AssemblyProduct\(").*("\)\])$'
     $assemblyVersionPattern = '^(\[assembly: Assembly(File)?Version\(")(\d+)\.(\d+)\.(\d+)\.(\d+)("\)\])$'

     $_major = $major
     $_minor = $minor
     $_buildNumber = $buildNumber
     $_revision = $revision

     # AssemblyVersion and AssemblyFileVersion
     # Populates variables for subsequent AssemblyProduct
     (Get-Content $path) | ForEach-Object {
       $matchVersionPattern = [regex]::Match($_, $assemblyVersionPattern)
       If ($matchVersionPattern.Success) {
         $isFile = $matchVersionPattern.Groups[2].Value -eq "File"

         $_major = Get-Part $major $matchVersionPattern.Groups[3].Value
         $_minor = Get-Part $minor $matchVersionPattern.Groups[4].Value
         $_buildNumber = Get-Part $buildNumber $matchVersionPattern.Groups[5].Value
         $_revision = Get-Part $revision $matchVersionPattern.Groups[6].Value

         If ($isFile) {
           # AssemblyFileVersion: update all properties
           $matchVersionPattern.Groups[1].Value + $_major + "." + $_minor + "." + $_buildNumber + "." + $_revision + $matchVersionPattern.Groups[7].Value
         } Else {
           # AssemblyVersion: only update major, minor, revision. Build number always 0.
           $matchVersionPattern.Groups[1].Value + $_major + "." + $_minor + ".0." + $_revision + $matchVersionPattern.Groups[7].Value
         }

       } Else {
         $_
       }
     } | Set-Content -Encoding UTF8 -Path $path

     # AssemblyProduct
     (Get-Content $path) | ForEach-Object {
       $matchProductPattern = [regex]::Match($_, $assemblyProductPattern)

       If ($matchProductPattern.Success) {
         $productVersion = $_major + "." + $_minor + "." + $_buildNumber + "." + $_revision

         If (![string]::IsNullOrEmpty($branch)) {
           $productVersion += "." + $branch + "-" + $sha1
         }

         $global:ProductVersion = $productVersion
         $global:OctopusVersion = $_major + "." + $_minor + "." + $_buildNumber;

         $global:FriendlyProductVersion = $_major + "." + $_minor + "." + $_revision
         If (![string]::IsNullOrEmpty($branch)) {
           $global:FriendlyProductVersion += "." + $branch
         }
         $global:FriendlyProductVersion += "-" + $buildNumber
         If (![string]::IsNullOrEmpty($sha1)) {
           $global:FriendlyProductVersion += "-" + $sha1
         }

         $productVersion = $matchProductPattern.Groups[1].Value + $productVersion + $matchProductPattern.Groups[2].Value
         Write-Output $productVersion
       } Else {
         $_
       }
     } | Set-Content -Encoding UTF8 -Path $path

   } Else {
     Write-Output "Cannot find $path"
   }
}

If (![string]::IsNullOrEmpty($Branch) -and $Branch.StartsWith("origin/")) {
  $Branch = $Branch.Substring(7)
}

If (![string]::IsNullOrEmpty($Sha1)) {
  $Sha1 = $Sha1.Substring(0, 7)
}

$version = Get-Part $Major "x"
$version += "."
$version += Get-Part $Minor "x"
$version += "."
$version += Get-Part $BuildNumber "x"
$version += "."
$version += Get-Part $Revision "x"

If (![string]::IsNullOrEmpty($Branch)) {
  $version += "." + $Branch + "-" + $Sha1
}

Write-Output "Setting assembly versions to $version..."

$SolutionRoot = $PSScriptRoot

$SolutionRootFolders = Get-ChildItem -Path $SolutionRoot -Directory -Exclude packages | Select-Object -ExpandProperty FullName

$projectFolders = Get-ProjectFolders($SolutionRootFolders)

foreach ($projectFolder in $projectFolders) {
  Write-Output "Processing $projectFolder..."
  $assemblyInfoPath = Get-AssemblyInfoPath($projectFolder)
  Set-AssemblyBuildVersion $assemblyInfoPath $Major $Minor $BuildNumber $Revision $Branch $Sha1
}

Write-Output "Product version: $global:ProductVersion"
Write-Output "Friendly product version: $global:FriendlyProductVersion"
Write-Output $global:OctopusVersion

Read-Host -Prompt "Press any key to continue..."