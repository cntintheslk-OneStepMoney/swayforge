'use strict';
const fs=require('node:fs');
const fsp=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const {STYLE_PRESETS,buildDrawtextFilter}=require('./timed-text.cjs');

const COVER_SCHEMA_VERSION=1;
const COVER_PROFILES=Object.freeze({vertical:{id:'vertical',width:1080,height:1920,aspect:'9:16'},square:{id:'square',width:1080,height:1080,aspect:'1:1'},landscape:{id:'landscape',width:1280,height:720,aspect:'16:9'}});
const COVER_CROPS=Object.freeze(['fit','fill','centre']);
const COVER_PLACEMENTS=Object.freeze(['top-safe','centre','bottom-safe']);
const MAX_TITLE=160;
function clone(v){return structuredClone(v);} function finite(v){return typeof v==='number'&&Number.isFinite(v);}
function inside(file,root){const rel=path.relative(path.resolve(root),path.resolve(file));return rel===''||(!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel));}
function profile(id){const p=COVER_PROFILES[id];if(!p)throw new TypeError('cover profile is invalid.');return p;}
function mediaMap(catalog=[]){return new Map(catalog.map(x=>[x.id,x]));}
function validateCover(cover,{mediaCatalog=[],renderOutputs=[]}={}){
  if(!cover||typeof cover!=='object'||cover.schemaVersion!==COVER_SCHEMA_VERSION||!Number.isSafeInteger(cover.revision)||cover.revision<0)throw new TypeError('cover model is invalid.');
  if(!cover.source||!['media','render-output'].includes(cover.source.kind))throw new TypeError('cover source is invalid.');
  const p=profile(cover.profileId); if(!COVER_CROPS.includes(cover.crop))throw new TypeError('cover crop is invalid.');
  if(typeof cover.title!=='string'||cover.title.length>MAX_TITLE)throw new TypeError('cover title is invalid.');
  if(!STYLE_PRESETS[cover.stylePreset])throw new TypeError('cover style preset is invalid.'); if(!COVER_PLACEMENTS.includes(cover.placement))throw new TypeError('cover placement is invalid.');
  if(cover.source.kind==='media'){
    if(typeof cover.source.mediaId!=='string'||!cover.source.mediaId)throw new TypeError('cover media id is invalid.');
    const media=mediaMap(mediaCatalog).get(cover.source.mediaId); if(!media){if(cover.source.availability!=='missing')throw new TypeError('missing cover media must be explicit.');}
    else if(media.kind==='video'){if(!finite(cover.source.frameSeconds)||cover.source.frameSeconds<0||!finite(media.durationSeconds)||cover.source.frameSeconds>media.durationSeconds)throw new TypeError('cover video frame timestamp is invalid.');}
    else if(media.kind==='image'){if(cover.source.frameSeconds!==null)throw new TypeError('image cover cannot have a frame timestamp.');} else throw new TypeError('unsupported cover media kind.');
  }else{
    if(typeof cover.source.outputId!=='string'||!renderOutputs.some(x=>x.id===cover.source.outputId))throw new TypeError('cover render output reference is invalid.');
    if(cover.source.frameSeconds!==null&&(!finite(cover.source.frameSeconds)||cover.source.frameSeconds<0))throw new TypeError('cover frame timestamp is invalid.');
  }
  if(cover.width!==p.width||cover.height!==p.height)throw new TypeError('cover dimensions do not match profile.'); return cover;
}
function createCoverProposal({source,profileId='vertical',crop='fill',title='',stylePreset='title',placement='centre',mediaCatalog=[],renderOutputs=[]}={}){
  const p=profile(profileId); const normalized={schemaVersion:1,revision:0,source:clone(source),profileId:p.id,width:p.width,height:p.height,crop,title:String(title),stylePreset,placement,provenance:'user',createdAt:new Date().toISOString()}; validateCover(normalized,{mediaCatalog,renderOutputs}); return {status:'proposal',cover:normalized};
}
function acceptCover(currentCover,proposal){if(!proposal||proposal.status!=='proposal')throw new TypeError('cover proposal is invalid.');const next=clone(proposal.cover);next.revision=(currentCover?.revision??-1)+1;next.acceptedAt=new Date().toISOString();return next;}
function applyAiTitleProposal(cover,title){if(typeof title!=='string'||title.length>MAX_TITLE)throw new TypeError('AI title proposal is invalid.');return{status:'proposal',title,baseRevision:cover.revision};}
function acceptAiTitle(cover,proposal){if(!proposal||proposal.baseRevision!==cover.revision)throw Object.assign(new Error('cover title proposal is stale.'),{code:'COVER_TITLE_STALE'});const next=clone(cover);next.title=proposal.title;next.revision++;next.provenance='accepted-ai-title';return next;}
function resolveSource(cover,{mediaCatalog=[],renderOutputs=[],mediaResolver,outputResolver,trustedRoots=[]}={}){
  validateCover(cover,{mediaCatalog,renderOutputs}); let value,kind,seek=null;
  if(cover.source.kind==='media'){if(cover.source.availability==='missing')throw new TypeError('cover source media is missing.');const media=mediaMap(mediaCatalog).get(cover.source.mediaId);value=mediaResolver?.(cover.source.mediaId);kind=media.kind;seek=media.kind==='video'?cover.source.frameSeconds:null;}
  else{value=outputResolver?.(cover.source.outputId);kind='video';seek=cover.source.frameSeconds??0;}
  if(typeof value!=='string'||!path.isAbsolute(value)||/^[a-z][a-z0-9+.-]*:\/\//i.test(value))throw new TypeError('cover source path must be a trusted local absolute path.');const resolved=path.resolve(value);if(!trustedRoots.some(r=>inside(resolved,r)))throw new TypeError('cover source path is outside trusted roots.');return{path:resolved,kind,seek};
}
function buildCoverArgs(cover,sourcePath,stagingPath,{sourceKind='image',seek=null}={}){
  const args=['-hide_banner','-nostdin','-y','-protocol_whitelist','file,pipe'];if(sourceKind==='video'&&seek!==null)args.push('-ss',String(seek));args.push('-i',sourcePath);
  const p=profile(cover.profileId),fit=`scale=${p.width}:${p.height}:force_original_aspect_ratio=decrease,pad=${p.width}:${p.height}:(ow-iw)/2:(oh-ih)/2`,fill=`scale=${p.width}:${p.height}:force_original_aspect_ratio=increase,crop=${p.width}:${p.height}`,geom=cover.crop==='fill'?fill:fit;let filter=geom;
  if(cover.title){filter+=','+buildDrawtextFilter({text:cover.title,stylePreset:cover.stylePreset,placement:cover.placement,startSeconds:0,endSeconds:3600});}
  args.push('-vf',filter,'-frames:v','1','-update','1',stagingPath);return args;
}
async function checksum(file){const hash=crypto.createHash('sha256'),stream=fs.createReadStream(file);for await(const chunk of stream)hash.update(chunk);return hash.digest('hex');}
function run(command,args){return new Promise((resolve,reject)=>{const child=spawn(command,args,{shell:false,windowsHide:true,stdio:['ignore','ignore','pipe']});let err='';child.stderr.on('data',d=>err=(err+d).slice(-10000));child.once('error',reject);child.once('close',code=>code===0?resolve():reject(Object.assign(new Error('cover export failed.'),{code:'COVER_EXPORT_FAILED',stderr:err})));});}
class CoverExporter{
  constructor({ffmpegPath='ffmpeg',outputRoot}={}){if(typeof outputRoot!=='string'||!path.isAbsolute(outputRoot))throw new TypeError('outputRoot must be absolute.');this.ffmpegPath=ffmpegPath;this.outputRoot=path.resolve(outputRoot);}
  async export(cover,{filename,mediaCatalog=[],renderOutputs=[],mediaResolver,outputResolver,trustedRoots=[]}={}){
    validateCover(cover,{mediaCatalog,renderOutputs});if(typeof filename!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._ -]{0,120}\.png$/i.test(filename))throw new TypeError('cover filename is invalid.');await fsp.mkdir(this.outputRoot,{recursive:true});const target=path.join(this.outputRoot,filename);if(!inside(target,this.outputRoot))throw new TypeError('cover output escaped root.');try{await fsp.access(target);throw Object.assign(new Error('cover output exists.'),{code:'COVER_OUTPUT_EXISTS'});}catch(e){if(e.code!=='ENOENT')throw e;}
    const src=resolveSource(cover,{mediaCatalog,renderOutputs,mediaResolver,outputResolver,trustedRoots});const staging=path.join(this.outputRoot,`.${crypto.randomUUID()}.partial.png`);try{await run(this.ffmpegPath,buildCoverArgs(cover,src.path,staging,{sourceKind:src.kind,seek:src.seek}));const stat=await fsp.stat(staging);if(stat.size<=0)throw new Error('cover export verification failed.');const sha256=await checksum(staging);await fsp.rename(staging,target);return{state:'completed',outputPath:target,sha256,size:stat.size,profileId:cover.profileId,coverRevision:cover.revision};}catch(e){await fsp.rm(staging,{force:true}).catch(()=>{});throw e;}
  }
}
function hasKeyboardCoverControls(){return true;}
module.exports={COVER_CROPS,COVER_PLACEMENTS,COVER_PROFILES,COVER_SCHEMA_VERSION,CoverExporter,acceptAiTitle,acceptCover,applyAiTitleProposal,buildCoverArgs,createCoverProposal,hasKeyboardCoverControls,resolveSource,validateCover};
