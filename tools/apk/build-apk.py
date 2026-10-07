#!/usr/bin/env python3
"""Montaj Pro — APK build pipeline (fully offline-capable, no Android SDK / Gradle).

Steps: bundle assets -> assemble smali to dex -> aapt2 compile/link -> add dex -> sign.
Run:  python3 tools/apk/build-apk.py [--no-icons] [--out NAME]
"""
import json
import os
import re
import shutil
import subprocess
import sys
import urllib.request
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TOOLS = os.path.join(ROOT, '.tools')
APKDIR = os.path.join(ROOT, 'tools/apk')
BUILD = os.path.join(TOOLS, 'build')
PKG = 'com.montaj.pro'


def sh(cmd, **kw):
    print('$', ' '.join(cmd) if isinstance(cmd, list) else cmd, flush=True)
    return subprocess.run(cmd, check=True, **kw)


def find_npm_pack(name, dest):
    """npm pack a package into dest and return the extracted package dir."""
    os.makedirs(dest, exist_ok=True)
    out = subprocess.run(['npm', 'pack', name, '--silent'], cwd=dest, capture_output=True, text=True, check=True).stdout.strip().splitlines()[-1]
    tgz = os.path.join(dest, out)
    with __import__('tarfile').open(tgz) as tf:
        tf.extractall(dest)
    return os.path.join(dest, 'package')


def ensure_toolchain():
    ok = True
    jre = os.path.join(TOOLS, 'jre', 'bin', 'java')
    if not os.path.exists(jre):
        print('== fetching JDK (PyPI jdk4py) ==')
        os.makedirs(TOOLS, exist_ok=True)
        meta = json.load(urllib.request.urlopen('https://pypi.org/pypi/jdk4py/json'))
        ver = meta['info']['version']
        url = next(f['url'] for f in meta['releases'][ver]
                   if f['filename'].endswith('manylinux_2_17_x86_64.whl'))
        whl = os.path.join(TOOLS, 'jdk4py.whl')
        urllib.request.urlretrieve(url, whl)
        with zipfile.ZipFile(whl) as z:
            z.extractall(os.path.join(TOOLS, 'jdkx'))
        src = os.path.join(TOOLS, 'jdkx', 'jdk4py', 'java-runtime')
        shutil.move(src, os.path.join(TOOLS, 'jre'))
        for f in os.listdir(os.path.join(TOOLS, 'jre', 'bin')):
            p = os.path.join(TOOLS, 'jre', 'bin', f)
            if os.path.isfile(p):
                os.chmod(p, 0o755)
        os.remove(whl)
        shutil.rmtree(os.path.join(TOOLS, 'jdkx'), ignore_errors=True)
        ok = False
    apkjar = os.path.join(TOOLS, 'apk', 'apktool.jar')
    if not os.path.exists(apkjar):
        print('== fetching apktool + aapt2 (npm apktool-jar) ==')
        pkg = find_npm_pack('apktool-jar', os.path.join(TOOLS, 'dl-apktool'))
        jar = [f for f in os.listdir(os.path.join(pkg, 'bin')) if f.endswith('.jar')][0]
        os.makedirs(os.path.join(TOOLS, 'apk'), exist_ok=True)
        shutil.copy(os.path.join(pkg, 'bin', jar), apkjar)
        with zipfile.ZipFile(apkjar) as z:
            for name, out in (('prebuilt/linux/aapt2_64', 'aapt2'), ('brut/androlib/android-framework.jar', 'framework.apk')):
                with z.open(name) as src, open(os.path.join(TOOLS, 'apk', out), 'wb') as dst:
                    shutil.copyfileobj(src, dst)
                os.chmod(os.path.join(TOOLS, 'apk', out), 0o755)
        ok = False
    signer = os.path.join(TOOLS, 'signer', 'package', 'dist', 'index.js')
    if not os.path.exists(signer):
        print('== fetching apk_sign_ts (npm) ==')
        find_npm_pack('apk_sign_ts', os.path.join(TOOLS, 'dl-signer'))
        os.makedirs(os.path.join(TOOLS, 'signer'), exist_ok=True)
        shutil.copytree(os.path.join(TOOLS, 'dl-signer', 'package'), os.path.join(TOOLS, 'signer', 'package'), dirs_exist_ok=True)
        ok = False
    if not os.path.exists(os.path.join(TOOLS, 'node_modules', 'esbuild')):
        print('== installing esbuild + jsdom (build & test only) ==')
        subprocess.run(['npm', 'init', '-y'], cwd=TOOLS, capture_output=True)
        sh(['npm', 'install', 'esbuild@0.28.2', 'jsdom'], cwd=TOOLS)
        ok = False
    return ok


def make_keystore():
    """self signed RSA key + certificate (kept in the repo so rebuilds keep the same signature)"""
    kdir = os.path.join(APKDIR, 'keystore')
    keyp, certp = os.path.join(kdir, 'montaj-release.pem'), os.path.join(kdir, 'montaj-release-cert.pem')
    if os.path.exists(keyp) and os.path.exists(certp):
        return keyp, certp
    print('== generating signing key ==')
    try:
        from cryptography import x509
        from cryptography.x509.oid import NameOID
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import rsa
        import datetime
    except ImportError:
        for extra in (['--break-system-packages'], ['--user']):
            try:
                sh([sys.executable, '-m', 'pip', 'install', '--quiet'] + extra + ['cryptography'])
                return make_keystore()
            except subprocess.CalledProcessError:
                continue
        raise SystemExit('please install python cryptography: pip install cryptography')
    os.makedirs(kdir, exist_ok=True)
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([
        x509.NameAttribute(NameOID.COUNTRY_NAME, 'MA'),
        x509.NameAttribute(NameOID.ORGANIZATION_NAME, 'Montaj Pro'),
        x509.NameAttribute(NameOID.COMMON_NAME, 'Montaj Pro Dev Key'),
    ])
    now = datetime.datetime.now(datetime.timezone.utc)
    cert = (x509.CertificateBuilder()
            .subject_name(name).issuer_name(name)
            .public_key(key.public_key())
            .serial_number(x509.random_serial_number())
            .not_valid_before(now - datetime.timedelta(days=1))
            .not_valid_after(now + datetime.timedelta(days=365 * 25))
            .add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True)
            .sign(key, hashes.SHA256()))
    open(keyp, 'wb').write(key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption()))
    open(certp, 'wb').write(cert.public_bytes(serialization.Encoding.PEM))
    print('keystore written to tools/apk/keystore/ (keep it safe — needed for app updates)')
    return keyp, certp


def main():
    args = sys.argv[1:]
    out_name = 'MontajPro-v1.0.apk'
    if '--out' in args:
        out_name = args[args.index('--out') + 1]
    ensure_toolchain()
    java = os.path.join(TOOLS, 'jre', 'bin', 'java')
    jar = os.path.join(TOOLS, 'apk', 'apktool.jar')
    aapt2 = os.path.join(TOOLS, 'apk', 'aapt2')
    framework = os.path.join(TOOLS, 'apk', 'framework.apk')
    launcher_dir = os.path.join(TOOLS, 'launcher')

    # 1. icons
    if '--no-icons' not in args:
        sh([sys.executable, os.path.join(ROOT, 'tools', 'make-icons.py'), os.path.join(TOOLS, 'icon-src.png')])

    # 2. web assets (single file editor)
    single = os.path.join(ROOT, 'editor', 'dist', 'montaj-pro.html')
    if not os.path.exists(single):
        sh(['node', os.path.join(ROOT, 'tools', 'editor', 'build.mjs')])
    assets = os.path.join(BUILD, 'assets', 'app')
    shutil.rmtree(os.path.join(BUILD, 'assets'), ignore_errors=True)
    os.makedirs(assets, exist_ok=True)
    shutil.copy(single, os.path.join(assets, 'index.html'))
    print('asset size: %.0f KB' % (os.path.getsize(single) / 1024))

    # 3. smali -> classes.dex (apktool's smali library driven by a generated launcher class)
    os.makedirs(os.path.join(launcher_dir, 'src'), exist_ok=True)
    genclass = os.path.join(ROOT, 'tools', 'launcher', 'genclass.py')
    sh([sys.executable, genclass, os.path.join(launcher_dir, 'src', 'Launcher.class')])
    os.makedirs(BUILD, exist_ok=True)
    dex = os.path.join(BUILD, 'classes.dex')
    sh([java, '-cp', jar + ':' + os.path.join(launcher_dir, 'src'), 'Launcher',
        os.path.join(APKDIR, 'smali'), dex])
    print('dex size: %.0f KB' % (os.path.getsize(dex) / 1024))

    # 4. resources + manifest + assets -> unsigned apk
    res_zip = os.path.join(BUILD, 'res.zip')
    sh([aapt2, 'compile', '--dir', os.path.join(APKDIR, 'res'), '-o', res_zip])
    unsigned = os.path.join(BUILD, 'unsigned.apk')
    if os.path.exists(unsigned):
        os.remove(unsigned)
    sh([aapt2, 'link', '-o', unsigned,
        '-I', framework,
        '--manifest', os.path.join(APKDIR, 'AndroidManifest.xml'),
        '-A', os.path.join(BUILD, 'assets'),
        '--min-sdk-version', '21', '--target-sdk-version', '30',
        '--auto-add-overlay', res_zip])

    # 5. add classes.dex to the archive
    with zipfile.ZipFile(unsigned, 'a', zipfile.ZIP_DEFLATED) as z:
        z.write(dex, 'classes.dex')

    # 6. sign (v1 + v2 + v3)
    keyp, certp = make_keystore()
    out = os.path.join(ROOT, out_name)
    sh(['node', os.path.join(APKDIR, 'sign-apk.mjs'), unsigned, out, keyp, certp])

    # 7. verify
    print('\n== verifying ==')
    with zipfile.ZipFile(out) as z:
        names = z.namelist()
        print('entries:', len(names))
        for n in ('AndroidManifest.xml', 'classes.dex', 'resources.arsc', 'assets/app/index.html'):
            print(' ', 'OK ' if n in names else 'MISSING ', n)
        print(' signature files:', [n for n in names if n.startswith('META-INF')])
    r = subprocess.run([aapt2, 'dump', 'badging', out], capture_output=True, text=True)
    for line in (r.stdout or '').splitlines()[:6]:
        print(' ', line)
    r2 = subprocess.run([aapt2, 'dump', 'badging', out], capture_output=True, text=True)
    txt = r2.stdout or ''
    sigs = []
    with open(out, 'rb') as fh:
        blob = fh.read()
    if b'APK Sig Block 42' in blob:
        sigs.append('APK Signing Block (v2/v3)')
    if zipfile.ZipFile(out).namelist() and any(n.startswith('META-INF/') and n.endswith(('.RSA', '.DSA', '.EC')) for n in zipfile.ZipFile(out).namelist()):
        sigs.append('JAR v1')
    for line in txt.splitlines():
        if line.startswith('application-label:') or line.startswith('launchable-activity:'):
            print('  ', line.strip())
    print(' signatures:', ', '.join(sigs) or 'NONE')
    print('\n✅ APK ready:', out, '(%.2f MB)' % (os.path.getsize(out) / 1048576))


if __name__ == '__main__':
    main()
