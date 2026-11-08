"""Build a self-contained Apple Silicon app and drag-to-Applications DMG."""
import json, pathlib, plistlib, shutil, subprocess, sys
root=pathlib.Path(__file__).resolve().parent.parent
release=root/'release'
stage=release/'dmg'
app=stage/'Runes.app'
if stage.exists(): shutil.rmtree(stage)
stage.mkdir(parents=True)
shutil.copytree(root/'node_modules/electron/dist/Electron.app',app,symlinks=True)
contents=app/'Contents'
resources=contents/'Resources'
shutil.rmtree(resources/'default_app.asar',ignore_errors=True) if (resources/'default_app.asar').is_dir() else (resources/'default_app.asar').unlink(missing_ok=True)
payload=resources/'app'
payload.mkdir()
for folder in ['dist','dist-electron','python']:
    shutil.copytree(root/folder,payload/folder,ignore=shutil.ignore_patterns('__pycache__'))
package=json.loads((root/'package.json').read_text())
(payload/'package.json').write_text(json.dumps({'name':package['name'],'version':package['version'],'type':'module','main':package['main']}))
base=subprocess.check_output([str(root/'.venv/bin/python'),'-c','import sys;print(sys.base_prefix)'],text=True).strip()
shutil.copytree(base,resources/'runtime',symlinks=True,ignore=shutil.ignore_patterns('__pycache__'))
shutil.copytree(root/'.venv/lib/python3.12/site-packages',resources/'runtime/lib/python3.12/site-packages',dirs_exist_ok=True,ignore=shutil.ignore_patterns('__pycache__','pip','pyinstaller*','PyInstaller'))
shutil.copy2(root/'build/icon.icns',resources/'Runes.icns')
info_path=contents/'Info.plist'
info=plistlib.loads(info_path.read_bytes())
(contents/'MacOS/Electron').rename(contents/'MacOS/Runes')
info.update(CFBundleExecutable='Runes',CFBundleName='Runes',CFBundleDisplayName='Runes',CFBundleIdentifier='com.runes.bandstudio',CFBundleVersion=package['version'],CFBundleShortVersionString=package['version'],CFBundleIconFile='Runes.icns',NSBluetoothAlwaysUsageDescription='Runes receives your band’s gestures from Runes on your iPhone over Bluetooth.',NSBluetoothPeripheralUsageDescription='Runes receives gestures from Runes on your iPhone.')
info_path.write_bytes(plistlib.dumps(info))
subprocess.run(['codesign','--force','--deep','--sign','-',str(app)],check=True)
(stage/'Applications').symlink_to('/Applications')
(stage/'Install.txt').write_text('Drag Runes to Applications. Open Runes from Applications.\nThis local build is ad-hoc signed, not notarized. If macOS blocks it, use System Settings > Privacy & Security > Open Anyway.\nAllow Bluetooth so Runes can receive gestures from your iPhone, and Accessibility for shortcuts, when requested.\nRequires an Apple Silicon Mac and macOS 13 or later. Python is included.\n')
dmg=release/f"Runes-{package['version']}-arm64.dmg"
subprocess.run(['hdiutil','create','-volname','Runes','-srcfolder',str(stage),'-ov','-format','UDZO',str(dmg)],check=True)
print(dmg)
