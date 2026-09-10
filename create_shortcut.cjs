const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const desktopPath = path.join(process.env.USERPROFILE, 'Desktop');
const targetExe = path.join(desktopPath, 'MarketKasa-Windows', 'MarketKasa.exe');
const targetDir = path.join(desktopPath, 'MarketKasa-Windows');
const shortcutPath = path.join(desktopPath, 'Market Kasa.lnk');
const batPath = path.join(desktopPath, 'MarketKasa_Baslat.bat');

// 1. Create .bat launcher
const batContent = `@echo off\r\nstart "" "${targetExe}"\r\n`;
fs.writeFileSync(batPath, batContent, 'utf8');
console.log('Created launcher bat:', batPath);

// 2. Create .vbs to make shortcut
const vbsScript = `
Set oWS = WScript.CreateObject("WScript.Shell")
sLinkFile = "${shortcutPath.replace(/\\/g, '\\\\')}"
Set oLink = oWS.CreateShortcut(sLinkFile)
oLink.TargetPath = "${targetExe.replace(/\\/g, '\\\\')}"
oLink.WorkingDirectory = "${targetDir.replace(/\\/g, '\\\\')}"
oLink.Description = "Market Kasa POS - Windows Masaustu"
oLink.Save
`;

const tempVbs = path.join(__dirname, 'make_shortcut.vbs');
fs.writeFileSync(tempVbs, vbsScript, 'utf8');

try {
  execSync(`cscript //nologo "${tempVbs}"`, { stdio: 'inherit' });
  console.log('Created Desktop Shortcut (.lnk):', shortcutPath);
} catch (e) {
  console.error('VBS Error:', e);
} finally {
  try { fs.unlinkSync(tempVbs); } catch {}
}
