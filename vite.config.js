import {defineConfig} from 'vite';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
// Evidence endpoint stays local-only. Allowed Origin ports default to the
// PROJECT-configured 5284/5285; EVIDENCE_PORTS lets verification runs use
// their own idle ports without loosening the localhost constraint.
// Name contract: `<shot>-(pbr|clay)` with an optional F3 presentation suffix
// `-ph`/-`noph` (placeholders shown/hidden) so framing shots are labeled.
const evidencePorts=process.env.EVIDENCE_PORTS||'528[45]';
function evidence(server){server.middlewares.use('/__review-evidence',async(req,res)=>{if(req.method!=='POST'||(req.headers.origin&&!new RegExp(`^http:\\/\\/(localhost|127\\.0\\.0\\.1):(${evidencePorts})$`).test(req.headers.origin))){res.statusCode=403;res.end();return;}try{let body='';for await(const c of req){body+=c;if(body.length>12000000)throw Error('Capture too large');}const d=JSON.parse(body);if(!/^[a-z-]+-(pbr|clay)(-(ph|noph))?$/.test(d.name)||!d.image?.startsWith('data:image/jpeg;base64,'))throw Error('Unexpected evidence format');const dir=resolve(import.meta.dirname,process.env.EVIDENCE_DIR||'../artifacts/lead-review/web');await mkdir(dir,{recursive:true});const stem=d.name+'-'+Date.now();await writeFile(resolve(dir,stem+'.jpg'),Buffer.from(d.image.split(',')[1],'base64'));await writeFile(resolve(dir,stem+'.json'),JSON.stringify(d.record,null,2)+'\n','utf8');res.end(JSON.stringify({saved:stem}));}catch(e){res.statusCode=400;res.end(String(e));}});}
export default defineConfig({cacheDir:'.cache/vite',server:{open:false,watch:{usePolling:true,interval:2000}},preview:{open:false},build:{rollupOptions:{input:{index:resolve(import.meta.dirname,'index.html'),temple:resolve(import.meta.dirname,'temple.html'),'temple-entry':resolve(import.meta.dirname,'temple-entry.html')}}},plugins:[{name:'lead-review-evidence',configureServer:evidence,configurePreviewServer:evidence}]});
