$ErrorActionPreference = "Stop"
$destDir = "C:\Users\ufukk\Android"
$cmdlineToolsDir = "$destDir\cmdline-tools"

Write-Host "Creating directory: $cmdlineToolsDir"
New-Item -ItemType Directory -Force -Path $cmdlineToolsDir | Out-Null

$zipPath = "$destDir\tools.zip"
$url = "https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip"

Write-Host "Downloading Google Android Command Line Tools from $url..."
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Invoke-WebRequest -Uri $url -OutFile $zipPath

Write-Host "Extracting archive..."
Expand-Archive -Path $zipPath -DestinationPath $cmdlineToolsDir -Force

if (Test-Path "$cmdlineToolsDir\cmdline-tools") {
    if (Test-Path "$cmdlineToolsDir\latest") {
        Remove-Item -Recurse -Force "$cmdlineToolsDir\latest"
    }
    Move-Item -Path "$cmdlineToolsDir\cmdline-tools" -Destination "$cmdlineToolsDir\latest" -Force
}

Remove-Item -Force $zipPath
Write-Host "Android Command Line Tools successfully installed in $cmdlineToolsDir\latest"
