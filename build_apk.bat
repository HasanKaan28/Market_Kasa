@echo off
set "JAVA_HOME=C:\Program Files\Microsoft\jdk-21.0.12.101-hotspot"
set "ANDROID_HOME=C:\Users\ufukk\Android"
set "PATH=%JAVA_HOME%\bin;%ANDROID_HOME%\cmdline-tools\latest\bin;%PATH%"

echo ====================================================
echo [1/3] SDK Lisanslari Kabul Ediliyor...
echo ====================================================
(echo y & echo y & echo y & echo y & echo y & echo y) | call sdkmanager.bat --licenses

echo ====================================================
echo [2/3] Android SDK Platform ve Build Tools Kuruluyor...
echo ====================================================
(echo y) | call sdkmanager.bat "platform-tools" "platforms;android-34" "build-tools;34.0.0"

echo ====================================================
echo [3/3] local.properties Yaziliyor...
echo ====================================================
echo sdk.dir=C:\\Users\\ufukk\\Android> "C:\Users\ufukk\KURŞUNLU\android\local.properties"

echo ====================================================
echo Gradle ile APK Derleniyor...
echo ====================================================
cd /d "C:\Users\ufukk\KURŞUNLU\android"
call gradlew.bat assembleDebug

if exist "C:\Users\ufukk\KURŞUNLU\android\app\build\outputs\apk\debug\app-debug.apk" (
    copy /y "C:\Users\ufukk\KURŞUNLU\android\app\build\outputs\apk\debug\app-debug.apk" "C:\Users\ufukk\KURŞUNLU\MarketKasa.apk"
    echo.
    echo ====================================================
    echo TEBRIKLER! APK DOSYASI BASARIYLA URETILDI:
    echo C:\Users\ufukk\KURŞUNLU\MarketKasa.apk
    echo ====================================================
) else (
    echo.
    echo [HATA] APK uretilemedi.
)
