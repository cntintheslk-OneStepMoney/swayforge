'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=(file)=>fs.readFileSync(path.join(root,file),'utf8');

test('writing UI exposes generate, cancel, accept and explicit user-edit controls',()=>{
  const source=read('src/renderer/content-writing-ui.js');
  for(const value of ['Generate locally','Cancel','Accept this option','Save my edit'])assert.match(source,new RegExp(value));
  for(const method of ['generateContentWriting','cancelContentWriting','acceptContentWriting','editContentWriting'])assert.match(source,new RegExp(method));
});

test('writing proposals are not automatically persisted by renderer',()=>{
  const source=read('src/renderer/content-writing-ui.js');
  assert.match(source,/Nothing has been saved yet/);
  assert.match(source,/acceptOption/);
  assert.doesNotMatch(source,/updateContentProject\(/);
});

test('renderer writing surface does not expose raw Ollama, shell or network commands',()=>{
  const source=read('src/renderer/content-writing-ui.js');
  assert.doesNotMatch(source,/ipcRenderer|child_process|spawn\(|exec\(|fetch\(|XMLHttpRequest|https?:\/\//i);
  assert.doesNotMatch(source,/innerHTML|insertAdjacentHTML|eval\(|new Function/);
});

test('writing IPC is revision-protected and rejects extra command fields',()=>{
  const {validateAcceptRequest,validateGenerateRequest}=require('../src/content/content-writing-ipc-contracts.cjs');
  const id='11111111-1111-4111-8111-111111111111';
  assert.equal(validateGenerateRequest({kind:'content-writing-generate',version:1,operationId:'op-1',projectId:id,task:'ideas',userText:'understated'}).task,'ideas');
  assert.throws(()=>validateAcceptRequest({kind:'content-writing-accept',version:1,projectId:id,proposalId:'p',optionId:'o',expectedStoreRevision:1,expectedContentRevision:2,command:'curl example.com'}),/unsupported field/);
});

test('main-process writing integration keeps pending proposals in memory and uses local runtime',()=>{
  const source=read('src/main/writing-bootstrap.cjs');
  assert.match(source,/proposalCache = new Map/);
  assert.match(source,/getAiRuntime\(\)/);
  assert.match(source,/startGeneration/);
  assert.doesNotMatch(source,/https?:\/\//i);
  assert.doesNotMatch(source,/writeFile|appendFile|diagnostic.*content/i);
});

test('writing UI includes every required task family',()=>{
  const source=read('src/renderer/content-writing-ui.js');
  for(const task of ['ideas','hooks','script','caption','rewrite','critique'])assert.match(source,new RegExp(`'${task}'`));
});
