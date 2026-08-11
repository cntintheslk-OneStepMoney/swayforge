'use strict';
const MEDIA_IPC_CHANNELS=Object.freeze({
  chooseImport:'swayforge:media:choose-import',
  list:'swayforge:media:list',
  attach:'swayforge:media:attach',
  detach:'swayforge:media:detach'
});
const MEDIA_CHOOSE_REQUEST=Object.freeze({kind:'choose-media-import',version:1});
const SUPPORTED_MEDIA=Object.freeze({
  '.jpg':Object.freeze({kind:'image',canonicalExtension:'.jpg',container:'jpeg'}),
  '.jpeg':Object.freeze({kind:'image',canonicalExtension:'.jpg',container:'jpeg'}),
  '.png':Object.freeze({kind:'image',canonicalExtension:'.png',container:'png'}),
  '.mp4':Object.freeze({kind:'video',canonicalExtension:'.mp4',container:'mp4'}),
  '.mov':Object.freeze({kind:'video',canonicalExtension:'.mov',container:'quicktime'})
});
function isChooseMediaRequest(value){return Boolean(value&&typeof value==='object'&&!Array.isArray(value)&&value.kind===MEDIA_CHOOSE_REQUEST.kind&&value.version===MEDIA_CHOOSE_REQUEST.version&&Object.keys(value).length===2);}
function validateProjectMediaRequest(value){
  if(!value||typeof value!=='object'||Array.isArray(value))throw new TypeError('media project request must be an object.');
  const keys=Object.keys(value).sort(); if(keys.join(',')!=='expectedRevision,mediaId,projectId')throw new TypeError('media project request contains unsupported fields.');
  if(typeof value.projectId!=='string'||typeof value.mediaId!=='string'||!Number.isSafeInteger(value.expectedRevision)||value.expectedRevision<0)throw new TypeError('media project request is invalid.');
  return value;
}
module.exports={MEDIA_CHOOSE_REQUEST,MEDIA_IPC_CHANNELS,SUPPORTED_MEDIA,isChooseMediaRequest,validateProjectMediaRequest};
