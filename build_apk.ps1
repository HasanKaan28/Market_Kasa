$ErrorActionPreference = "Stop"

$env:JAVA_HOME = "C:\Program Files\Microsoft\jdk-21.0.12.101-hotspot"
$env:ANDROID_HOME = "C:\Users\ufukk\Android"
$env:Path = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\cmdline-tools\latest\bin;$env:Path"

Write-Host "Accepting Android SDK licenses..."
cmd.exe /c "echo y | sdkmanager.bat --licenses"

Write-Host "Installing platform-tools, platforms;android-34, build-tools;34.0.0..."
cmd.exe /c "echo y | sdkmanager.bat \"platform-tools\" \"platforms;android-34\" \"build-tools;34.0.0\""

Write-Host "Writing local.properties..."
$localProps = "sdk.dir=C:\\Users\\ufukk\\Android`n"
Set-Content -Path "c:\Users\ufukk\KURŞUNLU\android\local.properties" -Value $localProps

Write-Host "Building APK with Gradle assembleDebug..."
cd "c:\Users\ufukk\KURŞUNLU\android"
.\gradlew.bat assembleDebug

$apkSource = "c:\Users\ufukk\KURŞUNLU\android\app\build\outputs\apk\debug\app-debug.apk"
$apkDest = "c:\Users\ufukk\KURŞUNLU\MarketKasa.apk"

if (Test-Path $apkSource) {
    Copy-Item -Path $apkSource -Destination $apkDest -Force
    Write-Host "========================================="
    Write-Host "SUCCESS! APK created at: $apkDest"
    Write-Host "========================================="
} else {
    Write-Error "APK could not be found at $apkSource"
}
