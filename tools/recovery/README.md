# Read-only SD card photo/video recovery

This is a **real file-carving tool**, not an Android APK. It searches an existing raw, unencrypted SD-card image for intact JPEG, PNG, and contiguous MP4 files. It never writes to the image. It cannot access deleted blocks on a modern Android phone's encrypted internal storage. It cannot restore overwritten, fragmented, or encrypted files; names, folders and timestamps are not preserved. False positives or damaged videos are possible.

**Stop using the SD card first.** Remove it from the phone. On a computer, make a raw image of the entire card with a reputable imaging tool; save the image **on a different disk**. On Linux, carefully identify the card (`lsblk`) and image it with `sudo dd if=/dev/sdX of=/path/on/another/disk/card.img bs=4M status=progress conv=noerror,sync` (replace `sdX` with the correct device; choosing the wrong device can be destructive). Do not run recovery on the phone or save output onto the card.

Requires Python 3, no extra packages:

```sh
python3 tools/recovery/recover.py /path/to/card.img /path/on/another/disk/recovered
```

The output folder must not exist yet. Inspect the files manually. For Google Photos or cloud backups, check their own trash/backups separately; this script does not connect to cloud services.
