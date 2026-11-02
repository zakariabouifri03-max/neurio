import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import render as R, icons as I
d = R.Doc(1800, 1800, bg=None)
leo = R.texture("leopard", seed=3)
d.add(I.place(I.pine_tree(paint=leo, fill="#F1D2A6", lw=5), 450, 500, 700))
d.add(I.place(I.pine_tree(fill="#2E6B4F"), 1350, 500, 700))
d.add(I.place(I.snowman(fill="#F7F3EA"), 450, 1350, 600))
d.add(I.place(I.raccoon(), 1350, 1350, 600))
d.save_png('/tmp/sheet.png', width=900)
print('ok')
