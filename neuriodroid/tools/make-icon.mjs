import fs from 'fs'; import pngToIco from 'png-to-ico';
const b=await pngToIco(new URL('../assets/icon-source.png',import.meta.url).pathname); fs.writeFileSync(new URL('../assets/icon.ico',import.meta.url),b);
