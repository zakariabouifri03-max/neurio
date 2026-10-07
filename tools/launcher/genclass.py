#!/usr/bin/env python3
"""Minimal Java class-file writer: builds a launcher class that calls
brut.androlib.src.SmaliBuilder.build(ExtFile, File, int)  -> assembles smali dir into .dex
Run:  java -cp apktool.jar:<dir> Launcher <smaliDir> <outDex>
"""
import struct

class CP:
    def __init__(self):
        self.entries = [None]           # 1-based
        self.utf8 = {}; self.cls = {}; self.nat = {}; self.mref = {}
    def add_raw(self, entry, slot=1):
        self.entries.append(entry)
        idx = len(self.entries) - 1
        if slot == 2: self.entries.append(None)
        return idx
    def utf(self, s):
        if s in self.utf8: return self.utf8[s]
        b = s.encode('utf-8')
        i = self.add_raw((1, struct.pack('>H', len(b)) + b))
        self.utf8[s] = i; return i
    def klass(self, name):
        if name in self.cls: return self.cls[name]
        i = self.add_raw((7, struct.pack('>H', self.utf(name))))
        self.cls[name] = i; return i
    def nameandtype(self, name, desc):
        key = (name, desc)
        if key in self.nat: return self.nat[key]
        i = self.add_raw((12, struct.pack('>HH', self.utf(name), self.utf(desc))))
        self.nat[key] = i; return i
    def methodref(self, cls, name, desc):
        key = (cls, name, desc)
        if key in self.mref: return self.mref[key]
        i = self.add_raw((10, struct.pack('>HH', self.klass(cls), self.nameandtype(name, desc))))
        self.mref[key] = i; return i
    def render(self):
        out = b''
        for e in self.entries[1:]:
            if e is None: continue
            out += bytes([e[0]]) + e[1]
        return struct.pack('>H', len(self.entries)) + out


def build_launcher(out_path):
    cp = CP()
    this_cls = cp.klass('Launcher')
    super_cls = cp.klass('java/lang/Object')
    m_build   = cp.methodref('brut/androlib/src/SmaliBuilder', 'build',
                             '(Lbrut/directory/ExtFile;Ljava/io/File;I)V')
    c_extfile = cp.methodref('brut/directory/ExtFile', '<init>', '(Ljava/io/File;)V')
    c_file    = cp.methodref('java/io/File', '<init>', '(Ljava/lang/String;)V')
    c_main    = cp.nameandtype('main', '([Ljava/lang/String;)V')
    a_code    = cp.utf('Code')
    a_src     = cp.utf('SourceFile'); v_src = cp.utf('Launcher.java'); src_name = 'Launcher.java'
    k_extfile = cp.klass('brut/directory/ExtFile'); k_file = cp.klass('java/io/File')

    code = b''
    code += b'\xbb' + struct.pack('>H', k_extfile)          # new ExtFile
    code += b'\x59'                                          # dup
    code += b'\xbb' + struct.pack('>H', k_file)              # new File
    code += b'\x59'                                          # dup
    code += b'\x2a'                                          # aload_0
    code += b'\x03'                                          # iconst_0
    code += b'\x32'                                          # aaload
    code += b'\xb7' + struct.pack('>H', c_file)              # invokespecial File.<init>(String)
    code += b'\xb7' + struct.pack('>H', c_extfile)           # invokespecial ExtFile.<init>(File)
    code += b'\xbb' + struct.pack('>H', k_file)              # new File
    code += b'\x59'
    code += b'\x2a' + b'\x04' + b'\x32'                      # aload_0, iconst_1, aaload
    code += b'\xb7' + struct.pack('>H', c_file)
    code += b'\x10\x15'                                      # bipush 21
    code += b'\xb8' + struct.pack('>H', m_build)             # invokestatic SmaliBuilder.build
    code += b'\xb1'                                          # return
    code_attr = struct.pack('>HHI', 8, 1, len(code)) + code + struct.pack('>HH', 0, 0)
    method = struct.pack('>HHH', 0x0009, cp.utf('main'), cp.utf('([Ljava/lang/String;)V'))
    method += struct.pack('>H', 1) + struct.pack('>HI', a_code, len(code_attr)) + code_attr
    cls = struct.pack('>IHH', 0xCAFEBABE, 0, 49)            # magic, minor, major=49 (no stackmaps needed)
    cls += cp.render()
    cls += struct.pack('>HHHH', 0x0021, this_cls, super_cls, 0)   # access, this, super, ifaces=0
    cls += struct.pack('>H', 0)                                   # fields
    cls += struct.pack('>H', 1) + method                          # methods
    cls += struct.pack('>H', 1) + struct.pack('>HI', a_src, 2) + struct.pack('>H', v_src)
    open(out_path, 'wb').write(cls)
    return out_path

if __name__ == '__main__':
    import sys
    print('wrote', build_launcher(sys.argv[1]))
