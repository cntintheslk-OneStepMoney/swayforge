'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const fsp=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const packageJson=require('../package.json');
const {createContentProject,updateContentProject,validateContentProject}=require('../src/content/content-project-contracts.cjs');
const {generateWriting,acceptWritingOption}=require('../src/content/content-writing.cjs');
const {createStoryboardProposal,acceptStoryboard,reviseStoryboard}=require('../src/content/storyboard.cjs');
const {fromStoryboard,applyOperation,validateTimeline}=require('../src/content/timeline.cjs');
const {createTimedTextTrack,withTimedText}=require('../src/content/timed-text.cjs');
const {createAudioModel,editAudioModel,withAudio}=require('../src/content/audio.cjs');
const {CoverExporter,createCoverProposal,acceptCover}=require('../src/content/cover.cjs');
const {RenderEngine,createRenderPlan,resolveToolPaths}=require('../src/content/render-engine.cjs');
const {createVariant,prepareVariantRender,createExportRecord}=require('../src/content/export-profiles.cjs');

function hash(file){return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');}
function fixtureError(r){if(r.error)return r.error.message;return r.stderr?.toString().trim()||`ffmpeg exited with status ${String(r.status)}`;}
function fakeProvider(){return{model:'fake-local',available:true,async generateStructured(){return{options:[{id:'one',text:'Open with the detail shot.'},{id:'two',text:'Start wide, then reveal the detail.'}]};}};}

test('v0.3.0 release metadata is aligned',()=>{
  assert.equal(packageJson.version,'0.3.0');
  const changelog=fs.readFileSync(path.join(__dirname,'..','CHANGELOG.md'),'utf8');
  assert.match(changelog,/## 0\.3\.0 — 2026-08-13/);
});

test('v0.3.0 Content Studio covers all 15 local release scenarios',async()=>{
  const covered=new Set();
  const root=await fsp.mkdtemp(path.join(os.tmpdir(),'sway-v030-'));
  try{
    const img=path.join(root,'photo.png'),vid=path.join(root,'clip.mp4'),wav=path.join(root,'voice.wav');
    let r=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','color=c=orange:s=640x480:d=1','-frames:v','1',img]);if(r.status!==0)throw new Error(`FFmpeg release image fixture generation failed: ${fixtureError(r)}`);
    r=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','testsrc=size=640x360:rate=25:duration=3','-c:v','mpeg4',vid]);if(r.status!==0)throw new Error(`FFmpeg release video fixture generation failed: ${fixtureError(r)}`);
    r=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','sine=frequency=520:duration=5',wav]);if(r.status!==0)throw new Error(`FFmpeg release audio fixture generation failed: ${fixtureError(r)}`);
    const media=[{id:'img',kind:'image',availability:'ready',durationSeconds:null,sha256:hash(img)},{id:'vid',kind:'video',availability:'ready',durationSeconds:3,sha256:hash(vid),hasAudio:false}];
    const sourceHashes=media.map((m)=>m.sha256);
    let project=createContentProject({title:'Release scenario',mediaIds:['img','vid'],brief:{goal:'Create a short local demo',desiredDurationSeconds:5,aspectRatio:'9:16'},mediaCatalog:media,now:'2026-08-13T01:00:00Z'});covered.add(1);
    const writing=await generateWriting({provider:fakeProvider(),task:'ideas',project});
    project=acceptWritingOption(project,writing,'one',{expectedRevision:0,mediaCatalog:media,now:'2026-08-13T01:01:00Z'});
    project=updateContentProject(project,{brief:{captionNotes:'User-edited caption note'}},{expectedRevision:1,mediaCatalog:media,now:'2026-08-13T01:02:00Z'});assert.equal(project.brief.captionNotes,'User-edited caption note');covered.add(2);
    const shots=[{id:'s1',purpose:'opening',mediaId:'vid',sourceStartSeconds:.25,sourceEndSeconds:2.25,framing:'fill',transition:'cut'},{id:'s2',purpose:'still',mediaId:'img',stillDurationSeconds:2,framing:'fit',transition:'cut'}];
    const sbProposal=createStoryboardProposal(project,{shots,mediaCatalog:media,candidateSummaries:media.map((m)=>({id:m.id,kind:m.kind,durationSeconds:m.durationSeconds,description:'approved local media'})),model:'fake-local'});
    project=acceptStoryboard(project,sbProposal,{expectedRevision:2,mediaCatalog:media,now:'2026-08-13T01:03:00Z'});
    const sbProjectView={...project,revision:project.storyboard.projectRevision};project.storyboard=reviseStoryboard(project.storyboard,{type:'edit',shotId:'s2',patch:{purpose:'user-edited still'}},{expectedRevision:0,project:sbProjectView,mediaCatalog:media});covered.add(3);
    const timelineProjectView={...project,revision:project.storyboard.projectRevision};let timeline=fromStoryboard(timelineProjectView,{mediaCatalog:media});covered.add(4);
    const videoId=timeline.tracks.visual.find((x)=>x.kind==='video').id;
    timeline=applyOperation(timeline,{type:'split',itemId:videoId,atSourceSeconds:1.25},{expectedRevision:0,project:timelineProjectView,mediaCatalog:media});
    const still=timeline.tracks.visual.find((x)=>x.kind==='image');timeline=applyOperation(timeline,{type:'still-duration',itemId:still.id,durationSeconds:2.5},{expectedRevision:1,project:timelineProjectView,mediaCatalog:media});
    timeline=applyOperation(timeline,{type:'reorder',itemId:still.id,toIndex:0},{expectedRevision:2,project:timelineProjectView,mediaCatalog:media});validateTimeline(timeline,{project:timelineProjectView,mediaCatalog:media});covered.add(5);covered.add(6);
    const text=createTimedTextTrack({durationSeconds:timeline.durationSeconds,items:[{id:'hook',startSeconds:0,endSeconds:1.8,text:'LOCAL FIRST',role:'hook',placement:'top-safe'},{id:'sub',startSeconds:1.8,endSeconds:Math.min(4,timeline.durationSeconds),text:'Editable. Verifiable. Yours.',role:'subtitle',placement:'bottom-safe'}]});covered.add(7);
    let audio=createAudioModel({durationSeconds:timeline.durationSeconds,sources:[{id:'voice',assetId:'voice-wav',type:'voiceover',rights:'original-recording'}],items:[{id:'voice-item',sourceId:'voice',startSeconds:0,endSeconds:Math.min(4,timeline.durationSeconds),gainDb:-4,fadeInSeconds:.1,fadeOutSeconds:.2}],clipAudio:{}});audio=editAudioModel(audio,{type:'set-clip',clipId:videoId,mode:'mute',gainDb:0},{expectedRevision:0,durationSeconds:timeline.durationSeconds});covered.add(8);
    const cover=acceptCover(null,createCoverProposal({source:{kind:'media',mediaId:'img',frameSeconds:null},profileId:'vertical',title:'LOCAL FIRST',mediaCatalog:media}));const coverOut=await new CoverExporter({outputRoot:path.join(root,'covers')}).export(cover,{filename:'cover.png',mediaCatalog:media,mediaResolver:()=>img,trustedRoots:[root]});assert.equal(coverOut.state,'completed');covered.add(9);
    const resolver=(id)=>id==='img'?img:vid;let plan=createRenderPlan(timeline,{project:timelineProjectView,mediaCatalog:media,sourceResolver:resolver,trustedSourceRoots:[root],profileId:'vertical'});plan=withTimedText(plan,text);plan=withAudio(plan,audio,{audioResolver:()=>wav,trustedRoots:[root]});const verticalOut=await new RenderEngine({outputRoot:path.join(root,'renders')}).render(plan,{filename:'vertical.mp4'});assert.equal(verticalOut.state,'completed');assert.equal(verticalOut.height,1280);covered.add(10);
    const squareVariant=createVariant({id:'square-social',name:'Square local variant',profileId:'square',platformIntent:'generic',captionOverride:'Square caption'});const squarePlan=prepareVariantRender(timeline,squareVariant,{project:timelineProjectView,mediaCatalog:media,sourceResolver:resolver,trustedSourceRoots:[root]});const squareOut=await new RenderEngine({outputRoot:path.join(root,'renders')}).render(squarePlan,{filename:'square.mp4'});assert.equal(squareOut.width,1080);assert.equal(squareOut.height,1080);const landscapeVariant=createVariant({id:'landscape-local',name:'Landscape local variant',profileId:'landscape'});assert.notEqual(squareVariant.profileId,landscapeVariant.profileId);const record=createExportRecord({projectId:'project-release',projectRevision:project.revision,timelineRevision:timeline.revision,variant:squareVariant,renderOutput:squareOut});assert.equal(record.published,false);covered.add(11);
    const longTimeline=structuredClone(timeline);for(const item of longTimeline.tracks.visual)if(item.kind==='image'){item.stillDurationSeconds=20;item.durationSeconds=20;}let cursor=0;for(const item of longTimeline.tracks.visual){item.timelineStartSeconds=cursor;cursor+=item.durationSeconds;}longTimeline.durationSeconds=cursor;const cancelPlan=createRenderPlan(longTimeline,{project:timelineProjectView,mediaCatalog:media,sourceResolver:resolver,trustedSourceRoots:[root]});const controller=new AbortController();setTimeout(()=>controller.abort(),40);const cancelled=await new RenderEngine({outputRoot:path.join(root,'renders')}).render(cancelPlan,{filename:'cancelled.mp4',signal:controller.signal});assert.equal(cancelled.state,'cancelled');assert.equal(fs.existsSync(verticalOut.outputPath),true);assert.equal(fs.existsSync(path.join(root,'renders','cancelled.mp4')),false);covered.add(12);
    const reloaded=structuredClone(project);assert.deepEqual(validateContentProject(reloaded,{mediaCatalog:media}),project);const continued=updateContentProject(reloaded,{brief:{captionNotes:'continued after reload'}},{expectedRevision:reloaded.revision,mediaCatalog:media});assert.equal(continued.brief.captionNotes,'continued after reload');covered.add(13);
    const manual=createContentProject({title:'Manual only',mediaIds:['img'],mediaCatalog:media});assert.equal((await generateWriting({provider:null,task:'caption',project:manual})).status,'unavailable');const manualTimeline=require('../src/content/timeline.cjs').createManualTimeline(manual,{mediaIds:['img'],mediaCatalog:media});assert.ok(manualTimeline.durationSeconds>0);covered.add(14);
    const resources=path.join(root,'resources');await fsp.mkdir(path.join(resources,'tools'),{recursive:true});await fsp.writeFile(path.join(resources,'tools','ffmpeg.exe'),'fixture');await fsp.writeFile(path.join(resources,'tools','ffprobe.exe'),'fixture');assert.equal(resolveToolPaths({resourcesPath:resources,platform:'win32',env:{}}).source,'packaged');covered.add(15);
    assert.deepEqual(media.map((m,index)=>hash(index===0?img:vid)),sourceHashes);
    assert.deepEqual([...covered].sort((a,b)=>a-b),[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15]);
  }finally{await fsp.rm(root,{recursive:true,force:true});}
});
