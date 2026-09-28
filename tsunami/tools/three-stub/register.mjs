// usage: node --import ./tools/three-stub/register.mjs tools/boot.mjs
import { register } from 'node:module';
register('./hooks.mjs', import.meta.url);
