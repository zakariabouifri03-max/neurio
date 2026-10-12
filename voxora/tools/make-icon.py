"""Run with Pillow installed. Original Voxora mark, no external assets."""
from PIL import Image, ImageDraw
im = Image.new('RGBA', (512, 512), (0, 0, 0, 0))
d = ImageDraw.Draw(im)
d.rounded_rectangle((0, 0, 511, 511), radius=136, fill='#191621')
d.polygon([(86,124),(190,124),(266,341),(331,173),(433,173),(304,444),(200,444)], fill='#b6a1f7')
d.polygon([(307,61),(397,86),(358,164),(268,139)], fill='#b6a1f7')
im.save('assets/icon.png')
im.save('assets/icon.ico', sizes=[(16,16),(32,32),(48,48),(64,64),(128,128),(256,256)])
