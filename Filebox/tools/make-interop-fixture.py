#!/usr/bin/env python3
"""Write a WinZip-AES zip with pyzipper so tools/test-zip.mjs can prove that
Filebox reads archives produced by another implementation.
    pip install pyzipper && python3 tools/make-interop-fixture.py
"""
import pyzipper

with pyzipper.AESZipFile('/tmp/from_pyzipper.zip', 'w',
                         compression=pyzipper.ZIP_DEFLATED,
                         encryption=pyzipper.WZ_AES) as az:
    az.setpassword(b'mdp1234')
    az.writestr('depuis-python.txt', 'salam mn pyzipper — WinZip AES-256')
    az.writestr('gros.txt', 'abcdefghij0123456789 ' * 4000)
print('wrote /tmp/from_pyzipper.zip')
