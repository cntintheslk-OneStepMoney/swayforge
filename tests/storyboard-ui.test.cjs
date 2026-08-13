'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createContentProject}=require('../src/content/content-project-contracts.cjs');
const {createManualStoryboard,acceptStoryboard,reviseStoryboard,validateStoryboard}=require('../src/content/storyboard.cjs');
const root=path.join(__dirname,'..');
const read=(file)=>fs.readFileSync(path.join(root,file),'utf8');

test('storyboard renderer exposes local AI, manual, accept, cancel and keyboard-friendly edit controls',()=>{
  const source=read('src/renderer/content-storyboard-ui.js');
  for(const label of ['Generate storyboard locally','Build a manual storyboard','Preview manual storyboard','Accept proposal','Cancel','Move earlier','Move later','Save shot edit'])assert.match(source,new RegExp(label));
  for(const method of ['getStoryboardSnapshot','generateStoryboard','createManualStoryboard','cancelStoryboard','acceptStoryboard','reviseStoryboard'])assert.match(source,new RegExp(method));
});

test('storyboard renderer cannot directly access shell, filesystem, network or raw IPC',()=>{
  const source=read('src/renderer/content-storyboard-ui.js');
  assert.doesNotMatch(source,/ipcRenderer|child_process|spawn\(|exec\(|readFile|writeFile|fetch\(|XMLHttpRequest|https?:\/\//i);
  assert.doesNotMatch(source,/innerHTML|insertAdjacentHTML|eval\(|new Function/);
});

test('storyboard IPC rejects extra command surfaces',()=>{
  const {validateGenerateRequest,validateReviseRequest}=require('../src/content/storyboard-ipc-contracts.cjs');
  const id='11111111-1111-4111-8111-111111111111';
  assert.equal(validateGenerateRequest({kind:'storyboard-generate',version:1,projectId:id,operationId:'op-1'}).operationId,'op-1');
  assert.throws(()=>validateReviseRequest({kind:'storyboard-revise',version:1,projectId:id,expectedStoreRevision:1,expectedContentRevision:2,expectedStoryboardRevision:0,operation:{type:'reorder',shotId:'s1',toIndex:0,patch:{},command:'ffmpeg -i x'}}),/unsupported field/);
});

test('accepted storyboard revision stays aligned with saved project revision',()=>{
  const media=[{id:'img',kind:'image',availability:'ready',durationSeconds:null}];
  const project=createContentProject({title:'P',mediaIds:['img'],mediaCatalog:media,now:'2026-08-13T01:00:00Z'});
  const proposal=createManualStoryboard(project,{shots:[{id:'s1',purpose:'still',mediaId:'img',sourceStartSeconds:null,sourceEndSeconds:null,stillDurationSeconds:3,framing:'fit',textRef:null,transition:'cut',rationale:null}],mediaCatalog:media});
  const accepted=acceptStoryboard(project,proposal,{expectedRevision:0,mediaCatalog:media,now:'2026-08-13T01:01:00Z'});
  assert.equal(accepted.storyboard.projectRevision,accepted.revision);
  assert.doesNotThrow(()=>validateStoryboard(accepted.storyboard,{project:accepted,mediaCatalog:media}));
  const revised=reviseStoryboard(accepted.storyboard,{type:'edit',shotId:'s1',patch:{purpose:'edited'}},{expectedRevision:0,project:accepted,mediaCatalog:media});
  assert.equal(revised.shots[0].purpose,'edited');
});

test('main storyboard integration keeps unaccepted proposals in memory and exposes no source paths to renderer snapshot',()=>{
  const source=read('src/main/storyboard-bootstrap.cjs');
  assert.match(source,/proposalCache = new Map/);
  assert.match(source,/publicCandidates/);
  assert.match(source,/getMediaRecord/);
  assert.match(source,/requestPreview/);
  assert.doesNotMatch(source,/shell:\s*true|exec\(|https?:\/\//i);
});

test('navigation loads storyboard module while Trends and Publishing remain disabled',()=>{
  const nav=read('src/renderer/navigation-model.js');
  assert.match(nav,/content-storyboard-ui\.js/);
  assert.match(nav,/key: 'trends'.*enabled: false/s);
  assert.match(nav,/key: 'publishing'.*enabled: false/s);
});
