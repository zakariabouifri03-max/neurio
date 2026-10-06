# Validates all HLSL in src/shaders.h with the locally built glslang (HLSL front-end).
# Usage: python3 check_shaders.py [glslang-binary]
import re, subprocess, sys, os, codecs

args = [a for a in sys.argv[1:] if not a.startswith('-')]
glslang = args[0] if args else '/home/user/.toolchain/glslang/build/StandAlone/glslang'
here = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(here, '..', 'src', 'shaders.h')).read()

def extract(name):
    i = src.find('#define ' + name + ' ')
    if i < 0:
        sys.exit('cannot find ' + name)
    j = src.find('\n#define ', i + 10)
    k = src.find('\nstatic const NShaderDef', i + 10)
    stops = [x for x in (j, k) if x > 0]
    body = src[i:min(stops) if stops else len(src)]
    parts = re.findall(r'"((?:[^"\\]|\\.)*)"', body)
    raw = ''.join(parts)
    # decode C escapes
    return codecs.decode(raw.encode('latin1'), 'unicode_escape').encode('latin1').decode('utf-8', 'replace')

common = extract('SH_COMMON')

# entry -> (source, stage)
table = re.findall(r'\{\s*"([^"]+)",\s*"([^"]+)",\s*(SH_\w+)\s*\}', src)
ok = True
for name, entry, macro in table:
    if not ok and '-x' in sys.argv:
        break
    s = extract(macro)
    if name == 'vs':
        full = s
        stage = 'vert'
    else:
        full = common + s
        stage = 'frag'
    path = '/tmp/_nx_' + name + '.hlsl'
    # glslang's HLSL front-end lacks 'mix' (HLSL alias of lerp) - translate for validation
    full = full.replace('mix(', 'lerp(')
    open(path, 'w').write(full)
    r = subprocess.run([glslang, path, '-D', '-V', '-S', stage, '-e', entry],
                       capture_output=True, text=True)
    status = 'OK ' if r.returncode == 0 and 'ERROR' not in (r.stdout + r.stderr) else 'FAIL'
    if status == 'FAIL':
        ok = False
    print(f'{status} {name:10s}')
    if status == 'FAIL':
        print(r.stdout, r.stderr)
        if '-x' in sys.argv:
            break
sys.exit(0 if ok else 1)
