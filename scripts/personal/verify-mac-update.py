"""Exercise a signed Electron download, installation, and relaunch in a disposable app."""
import argparse
import functools
import http.server
import json
import os
from pathlib import Path
import plistlib
import re
import shutil
import subprocess
import tempfile
import threading
import time
import uuid


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    identity = os.environ.get('CSC_NAME', '').upper()
    if not re.fullmatch(r'[0-9A-F]{40}', identity):
        parser.error('Set CSC_NAME to the release certificate SHA-1 fingerprint.')
    keychain = os.environ.get('CSC_KEYCHAIN')
    node = shutil.which('node')
    if not node:
        parser.error('Node.js is required.')
    out = args.output.resolve() if args.output else Path(tempfile.mkdtemp(prefix='superset-update-'))
    if args.output:
        out.mkdir(parents=True, exist_ok=False)
    print(f'Update test evidence: {out}', flush=True)
    desktop = root / 'apps/desktop'
    electron_package = json.loads((desktop / 'node_modules/electron/package.json').read_text())
    source = Path(subprocess.check_output([node, '-p', 'require("electron")'], cwd=desktop, text=True).strip()).parents[2]
    signer = subprocess.check_output([
        node, '-p', 'require.resolve("@electron/osx-sign", {paths: [require.resolve("app-builder-lib", {paths: [require.resolve("electron-builder")]})]})',
    ], cwd=desktop, text=True).strip()
    app_name = 'Superset Update Check.app'
    base = out / 'installed' / app_name
    candidate = out / 'candidate' / app_name
    bundle_id = 'com.superset.update-check.' + uuid.uuid4().hex
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(
        http.server.SimpleHTTPRequestHandler, directory=str(out)))
    origin = f'http://127.0.0.1:{server.server_port}'
    result_path = out / 'result.json'
    config = {'profile': str(out / 'profile'), 'log': str(out / 'events.jsonl'),
              'result': str(result_path), 'feed': origin + '/feed.json'}
    script = 'const config = ' + json.dumps(config) + ';\n' + r'''
const {app, autoUpdater} = require('electron');
const fs = require('node:fs');
app.setPath('userData', config.profile);
const record = (event, extra = {}) => fs.appendFileSync(config.log,
  JSON.stringify({event, version: app.getVersion(), ...extra}) + '\n');
app.whenReady().then(() => {
  record('ready');
  if (app.getVersion() === '0.0.2') {
    fs.writeFileSync(config.result, JSON.stringify({version: app.getVersion(),
      executable: process.execPath, nativeUpdateInstalled: true}));
    app.quit();
    return;
  }
  autoUpdater.on('error', error => { record('error', {message: error.message}); app.exit(1); });
  autoUpdater.on('checking-for-update', () => record('checking'));
  autoUpdater.on('update-available', () => record('available'));
  autoUpdater.on('update-downloaded', () => { record('downloaded'); autoUpdater.quitAndInstall(); });
  autoUpdater.setFeedURL({url: config.feed});
  autoUpdater.checkForUpdates();
});
setTimeout(() => { record('timeout'); app.exit(2); }, 90000).unref();
'''
    options = {
        'identity': identity, 'identityValidation': False, 'platform': 'darwin',
        'version': electron_package['version'], 'gatekeeperAssess': False,
        'strictVerify': True, 'preAutoEntitlements': False,
    }
    if keychain:
        options['keychain'] = keychain
    entitlements = desktop / 'src/resources/build/entitlements.mac.plist'
    sign_script = out / 'sign.cjs'
    sign_script.write_text('const {signAsync} = require(' + json.dumps(signer) + ');\n'
        'signAsync({...'+json.dumps(options)+', app:process.argv[2], '
        'optionsForFile:()=>({hardenedRuntime:true,timestamp:"none",entitlements:'
        + json.dumps(str(entitlements)) + '})}).catch(e=>{console.error(e);process.exit(1)});\n')
    for target, version in [(base, '0.0.1'), (candidate, '0.0.2')]:
        print(f'Signing isolated Electron {version}', flush=True)
        target.parent.mkdir()
        subprocess.run(['cp', '-cR', str(source), str(target)], check=True)
        info_file = target / 'Contents/Info.plist'
        info = plistlib.loads(info_file.read_bytes())
        info.update(CFBundleIdentifier=bundle_id, CFBundleName='Superset Update Check',
                    CFBundleDisplayName='Superset Update Check', CFBundleShortVersionString=version,
                    CFBundleVersion=version, NSAppTransportSecurity={'NSAllowsArbitraryLoads': True})
        info_file.write_bytes(plistlib.dumps(info))
        app_dir = target / 'Contents/Resources/app'
        app_dir.mkdir()
        (app_dir / 'package.json').write_text(json.dumps({
            'name': 'superset-update-check', 'version': version, 'main': 'main.cjs'}))
        (app_dir / 'main.cjs').write_text(script)
        subprocess.run([node, str(sign_script), str(target)], check=True, timeout=120)
        subprocess.run(['codesign', '--verify', '--deep', '--strict', '-R',
                        f'=identifier "{bundle_id}" and certificate leaf = H"{identity}"',
                        str(target)], check=True)
    subprocess.run(['ditto', '-c', '-k', '--sequesterRsrc', '--keepParent',
                    str(candidate), str(out / 'update.zip')], check=True)
    (out / 'feed.json').write_text(json.dumps({'url': origin + '/update.zip', 'name': '0.0.2',
        'notes': 'Local signing compatibility test', 'pub_date': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    env = dict(os.environ)
    env.pop('ELECTRON_RUN_AS_NODE', None)
    env.pop('DISABLE_UPDATE_CHECK', None)
    child = None
    try:
        with (out / 'electron.log').open('w') as log:
            child = subprocess.Popen([str(base / 'Contents/MacOS/Electron')],
                                     stdout=log, stderr=subprocess.STDOUT, env=env)
            deadline = time.monotonic() + 110
            while time.monotonic() < deadline and not result_path.exists():
                time.sleep(0.5)
            if not result_path.exists():
                raise RuntimeError(f'Native update did not complete; inspect {out}')
            result = json.loads(result_path.read_text())
            assert result['version'] == '0.0.2' and result['nativeUpdateInstalled']
            assert Path(result['executable']) == base / 'Contents/MacOS/Electron'
            assert plistlib.loads((base / 'Contents/Info.plist').read_bytes())['CFBundleShortVersionString'] == '0.0.2'
            print(json.dumps(result, indent=2), flush=True)
    finally:
        server.shutdown()
        server.server_close()
        if child and child.poll() is None:
            child.terminate()
            child.wait(timeout=10)


if __name__ == '__main__':
    main()
