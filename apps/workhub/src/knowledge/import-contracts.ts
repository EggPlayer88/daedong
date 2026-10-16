import limits from '../../../main/api/workhub-documents/_assets/knowledge-import-limits.json'
import {exact,identifier,ServiceError,text,version} from '../services/scoped-rpc'
import {sha} from '../documents/guided-contracts'
import {sourceInput,type SourceInput} from './contracts'
export const KNOWLEDGE_IMPORT_CONTRACT='knowledge-import.v1'
export const KNOWLEDGE_FILE_BUCKET='workhub-knowledge-files'
export interface ExtractedBlock{id:string;locator:string;text:string}
export interface KnowledgeExtraction{profile:'hwpx_text_v1';fileSha256:string;extractionSha256:string;blocks:ExtractedBlock[];omittedObjects:number}
export interface ImportResult{fileId:string;fileVersion:number;name:string;extraction:KnowledgeExtraction}
export interface ImportCommit{fileId:string;fileVersion:number;extractionSha256:string;input:SourceInput}
export function extraction(raw:unknown):KnowledgeExtraction{
 exact(raw,['profile','fileSha256','extractionSha256','blocks','omittedObjects'])
 if(raw.profile!==limits.profile||!Array.isArray(raw.blocks)||!raw.blocks.length||raw.blocks.length>limits.maxBlocks||!Number.isSafeInteger(raw.omittedObjects)||(raw.omittedObjects as number)<0)throw new ServiceError('INVALID_RESPONSE')
 const blocks=raw.blocks.map(row=>{exact(row,['id','locator','text']);const id=text(row.id,120,true);if(!/^Contents\/section\d+\.xml:p\d{6,}$/.test(id))throw new ServiceError('INVALID_RESPONSE');return{id,locator:text(row.locator,200,true),text:text(row.text,limits.maxCharacters,true)}})
 if(new Set(blocks.map(b=>b.id)).size!==blocks.length||Array.from(blocks.map(b=>b.text).join('\n\n')).length>limits.maxCharacters)throw new ServiceError('INVALID_RESPONSE')
 return{profile:'hwpx_text_v1',fileSha256:sha(raw.fileSha256),extractionSha256:sha(raw.extractionSha256),blocks,omittedObjects:raw.omittedObjects as number}
}
export function importResult(raw:unknown,fileId?:string):ImportResult{exact(raw,['fileId','fileVersion','name','extraction']);const id=identifier(raw.fileId),name=text(raw.name,240,true);if(fileId&&id!==fileId||!/\.hwpx$/i.test(name)||/[<>:"/\\|?*\u0000-\u001f]/.test(name))throw new ServiceError('INVALID_RESPONSE');return{fileId:id,fileVersion:version(raw.fileVersion),name,extraction:extraction(raw.extraction)}}
export function importCommit(raw:unknown):ImportCommit{exact(raw,['fileId','fileVersion','extractionSha256','input']);return{fileId:identifier(raw.fileId),fileVersion:version(raw.fileVersion),extractionSha256:sha(raw.extractionSha256),input:sourceInput(raw.input)}}
export function extractedInput(result:ImportResult,date:string):SourceInput{return{title:result.name.replace(/\.hwpx$/i,''),kind:'school_guide',body:result.extraction.blocks.map(b=>b.text).join('\n\n'),locator:`${result.name} / HWPX 원문 문단 ${result.extraction.blocks.length}개`,effectiveFrom:date,effectiveThrough:''}}
