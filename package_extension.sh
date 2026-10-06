#!/bin/bash
set -e
echo "Packaging Hidden Winner Finder Chrome Extension..."
rm -f hidden-winner-finder-v1.0.0.zip
cd extension
zip -r ../hidden-winner-finder-v1.0.0.zip . -x "*.py" -x "*__pycache__*" -x "*.DS_Store"
cd ..
ls -lh hidden-winner-finder-v1.0.0.zip
echo "Extension packaged successfully!"
