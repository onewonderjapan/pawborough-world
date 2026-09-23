import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export const PROJECT_ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const assetPath=p=>path.resolve(PROJECT_ROOT,p);
export function readInventory(){const d=JSON.parse(fs.readFileSync(assetPath('inputs/FOOD_INVENTORY.json'),'utf8'));d.sources=d.sources.map(s=>({...s,path:assetPath(s.path)}));return d;}
