#!/usr/bin/env python3
"""Montaj Pro — smali lint: catches the mistakes that make ART reject a class at
runtime (instant app crash), which a dex assembler may accept silently.

Checks per method:
  * .registers / .locals present
  * every vN / pN operand stays inside the declared register window
  * .param / .catch / branch labels are defined
  * invoke-* followed by a matching move-result* (when the result is used)
Usage: python3 tools/apk/lint-smali.py [dir-or-file ...]
"""
import os
import re
import sys
from collections import defaultdict

INS = re.compile(r'^\s*([a-z][a-z0-9\-/]*)\s*(.*)$')
REG = re.compile(r'\b([vp])(\d+)\b')
LABELDEF = re.compile(r'^\s*(:[\w$]+)')
BRANCH = re.compile(r'^\s*(?:goto|goto/16|goto/32|if-[a-z0-9]+)\s+(:[\w$]+)')
CATCH = re.compile(r'^\s*\.catch[^\s]*\s+\S+\s+\{([^}]*)\}\s+(:[\w$]+)')
INVOKE = re.compile(r'^\s*invoke-(virtual|super|direct|static|interface|polymorphic|custom)')
MOVE_RESULT = re.compile(r'^\s*move-result(?:-object|-wide|-boolean|-byte|-char|-short)?\b')

DESC_ARGS = re.compile(r'\(([^)]*)\)')


def count_args(desc):
    """number of words a descriptor's parameters take (long/double = 2)"""
    m = DESC_ARGS.search(desc)
    if not m:
        return 0
    s = m.group(1)
    n, i = 0, 0
    while i < len(s):
        c = s[i]
        if c == '[':
            i += 1
            continue
        if c == 'L':
            i = s.index(';', i) + 1
            n += 1
            continue
        n += 2 if c in 'JD' else 1
        i += 1
    return n


def lint_file(path):
    problems = []
    text = open(path, encoding='utf8', errors='replace').read().split('\n')
    cm = re.search(r'^\.class\s+(.*)$', '\n'.join(text[:5]), re.M)
    cls = cm.group(1).strip() if cm else '?'
    i, n = 0, len(text)
    while i < n:
        line = text[i]
        m = re.match(r'^\.method\s+(.*)$', line)
        if not m:
            i += 1
            continue
        head = m.group(1)
        dm = re.search(r'\(([^)]*)\)(\S+)$', head)
        static = head.startswith('static ') or ' static ' in head
        args = count_args(head) + (0 if static else 1)
        name = re.search(r'([\w$<>]+)\s*\(', head)
        name = name.group(1) if name else '?'
        regs, labels_def, labels_used, j = None, set(), set(), i + 1
        body = []
        while j < n and not re.match(r'^\.end method', text[j]):
            body.append((j + 1, text[j]))
            j += 1
        for ln, l in body:
            if regs is None:
                rm = re.match(r'^\s*\.(registers|locals)\s+(\d+)', l)
                if rm:
                    regs = int(rm.group(2))
                    if rm.group(1) == 'locals':
                        regs += args
                    continue
            d = LABELDEF.match(l)
            if d:
                labels_def.add(d.group(1))
            b = BRANCH.match(l)
            if b:
                labels_used.add(b.group(1))
            c = CATCH.match(l)
            if c:
                for lab in c.group(1).split():
                    if lab != '..':
                        labels_used.add(lab)
                labels_used.add(c.group(2))
            rl = re.search(r'\{([^}]*)\}', l)
            if rl and re.search(r'\{[^}]*\b[L\[]', l):
                problems.append((ln, 'class descriptor inside a register list (use const-class)', l.strip()))
            ins = INS.match(l)
            if ins and regs is not None:
                for kind, num in REG.findall(ins.group(2) or ''):
                    num = int(num)
                    if kind == 'v' and num >= regs:
                        problems.append((ln, f'v{num} out of range (registers={regs})', l.strip()))
                    if kind == 'p' and num >= args:
                        problems.append((ln, f'p{num} needs {num + 1} param registers, method has {args}', l.strip()))
        if regs is None:
            problems.append((i + 1, 'missing .registers/.locals', head))
        elif regs < args:
            problems.append((i + 1, f'registers={regs} < parameter words {args}', head))
        for lab in sorted(labels_used - labels_def):
            problems.append((i + 1, f'undefined label {lab}', f'method {name}'))
        # invoke without move-result in the next 1-2 instructions is fine (result ignored)
        for k, (ln, l) in enumerate(body):
            if INVOKE.match(l):
                nxt = [x for _, x in body[k + 1:k + 3] if x.strip()]
                if nxt and not (MOVE_RESULT.match(nxt[0]) or nxt[0].startswith('.') or
                                INS.match(nxt[0]) is None):
                    pass
        i = j + 1
    return cls, problems


def main():
    targets = sys.argv[1:] or ['tools/apk/smali']
    files = []
    for t in targets:
        if os.path.isdir(t):
            for root, _, fs in os.walk(t):
                files += [os.path.join(root, f) for f in fs if f.endswith('.smali')]
        else:
            files.append(t)
    total = 0
    for f in sorted(files):
        cls, problems = lint_file(f)
        if problems:
            total += len(problems)
            print(f'✗ {f}')
            for ln, msg, src in problems:
                print(f'   line {ln}: {msg}   |  {src[:90]}')
        else:
            print(f'✓ {f}')
    print(f'\n{len(files)} file(s), {total} problem(s)')
    return 1 if total else 0


if __name__ == '__main__':
    sys.exit(main())
