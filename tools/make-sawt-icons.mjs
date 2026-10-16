// Generates icons/sawt-512.png and icons/sawt-192.png — procedural SAWT+ speaker icon.
import { writeFileSync } from "node:fs";
import { draw, encodePNG } from "./sawt-png.mjs";

for (const n of [512, 192]) {
  writeFileSync(`icons/sawt-${n}.png`, encodePNG(draw(n).px, n, n));
}
console.log("Wrote icons/sawt-512.png and icons/sawt-192.png");
