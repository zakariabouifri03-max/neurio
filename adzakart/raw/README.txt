Put your design files in this folder, then run:

    python3 tools/prepare-store.py

Name every file with the design id first, then anything you like:

    4523481819-funny-whiskey.jpg
    4558369974-highland-cow.png
    4523705786.jpg

The id is the number in the design's page address:
    .../#/design/4523481819

What happens to each file:
    background removed -> transparent PNG
    upscaled to 3000 px long edge, 300 DPI
    checked (refused if a background is left in)
    written to assets/designs/clean/<id>.png   <- this is what the buyer gets
    a light preview written to assets/designs/<id>.jpg
    the catalog rebuilt, so "Get this design" starts working

Use PNG or a high-quality JPG as the source. The bigger the original, the better
the print file.

Try it with a single file first, then add the rest and run it again.
