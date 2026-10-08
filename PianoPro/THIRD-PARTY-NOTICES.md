# Third-party notices and licenses

This file identifies third-party components bundled with or used to build Piano Pro. Their licenses remain separate from the MIT license for original Piano Pro code.

## JUCE 9.0.3

The desktop UI, device I/O and MIDI integration use JUCE 9.0.3. CMake fetches the tagged JUCE source at configure time unless a JUCE 9 package is supplied with `JUCE_DIR`. JUCE modules are dual-licensed under the GNU Affero General Public License v3 (AGPLv3) or the JUCE commercial license. Before redistributing a built application, choose and comply with one of those licensing paths; a commercial JUCE license may be required for uses that do not satisfy the AGPL. Review the JUCE `LICENSE.md` shipped with the source and the current terms at:

- <https://github.com/juce-framework/JUCE/blob/9.0.3/LICENSE.md>
- <https://www.gnu.org/licenses/agpl-3.0.en.html>
- <https://juce.com/legal/juce-9-licence/>

The project disables JUCE browser, cURL and app-usage reporting features in its build definitions. This does not change the framework's license obligations.

## TinySoundFont

`Source/third_party/tsf.h` is TinySoundFont by Bernhard Schelling, based on SFZero by Steve Folta. Its MIT license text is included at `Source/third_party/TSF-LICENSE.txt` and in the installer.

## GeneralUser GS v2.0.3

`assets/sounds/GeneralUser-GS.sf2` is by S. Christian Collins. Its license permits use in software projects, including commercial music creation, and includes an author-disclosed note about uncertainty in the provenance of some inherited samples. Read `assets/sounds/LICENSE-GeneralUser-GS.txt` before redistribution or commercial release; it is installed with the application.

## Upright piano KW

`assets/sounds/UprightPianoKW-small-20190703.sf2` was recorded and prepared by Gonzalo and Roberto for FreePats from a Kawai upright piano. It is dedicated to the public domain under CC0 1.0. The full legal text and attribution are included in `assets/sounds/LICENSE-UprightPianoKW-CC0.txt` and `assets/sounds/README-UprightPianoKW.txt`, both installed with the application.
