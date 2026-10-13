// 최종 카탈로그의 명시 메타데이터만 검사한다. 실행 SQL·권한·트리거 본문 검증을 대신하지 않는다.
const list=value=>Array.isArray(value)?value:[];
const identifier=value=>{
 const text=String(value).trim();
 if(/^"(?:[^"]|"")+"$/.test(text))return text.slice(1,-1).replaceAll('""','"');
 return /^[a-z_][a-z0-9_$]*$/i.test(text)?text.toLowerCase():null;
};

// 삭제된 열 이름만 찾기 위한 토큰 분리다. 문자열·주석 안의 단어를 열 참조로 오판하지 않는다.
function identifiers(sql){
 const tokens=new Set();
 for(let i=0;i<sql.length;){
  if(sql.startsWith('--',i)){const end=sql.indexOf('\n',i+2);i=end<0?sql.length:end+1;continue;}
  if(sql.startsWith('/*',i)){
   let depth=1;i+=2;
   while(i<sql.length&&depth){if(sql.startsWith('/*',i)){depth++;i+=2;}else if(sql.startsWith('*/',i)){depth--;i+=2;}else i++;}
   continue;
  }
  const dollar=sql.slice(i).match(/^\$(?:[a-z_][a-z0-9_]*)?\$/i);
  if(dollar){const end=sql.indexOf(dollar[0],i+dollar[0].length);i=end<0?sql.length:end+dollar[0].length;continue;}
  if(sql[i]==="'"){
   i++;
   while(i<sql.length){if(sql[i]==="'"&&sql[i+1]==="'"){i+=2;continue;}if(sql[i]==="'"){i++;break;}if(sql[i]==='\\'){i+=2;continue;}i++;}
   continue;
  }
  if(sql[i]==='"'){
   const start=i++;
   while(i<sql.length){if(sql[i]==='"'&&sql[i+1]==='"'){i+=2;continue;}if(sql[i]==='"'){i++;break;}i++;}
   const name=identifier(sql.slice(start,i));if(name!==null)tokens.add(name);
   continue;
  }
  const word=sql.slice(i).match(/^[a-z_][a-z0-9_$]*/i);
  if(word){tokens.add(word[0].toLowerCase());i+=word[0].length;}else i++;
 }
 return tokens;
}

function keyColumns(definition,kind){
 const pattern=kind==='p'?/^PRIMARY KEY\s*\(([^)]+)\)/i:/^UNIQUE(?: NULLS NOT DISTINCT)?\s*\(([^)]+)\)/i;
 const match=definition.match(pattern);
 if(!match)return null;
 const names=match[1].split(',').map(identifier);
 return names.every(name=>name!==null)?names:null;
}

function validateDesignConstraints(tables,changes=[]){
 const errors=[],warnings=[],byName=new Map(tables.map(table=>[table.name,table]));
 for(const table of tables){
  const columns=new Map(list(table.columns).map(column=>[column.name,column]));
  const removed=new Set(list(table.removed_columns));
  const constraints=list(table.inherited_constraints),foreignKeys=list(table.inherited_foreign_keys);
  const label=name=>table.name+'.'+name;
  const checkRemoved=(name,definition)=>{
   const tokens=identifiers(definition||'');
   for(const column of removed)if(tokens.has(column))errors.push('삭제 열을 참조하는 상속 항목: '+label(name)+' → '+column);
  };
  for(const constraint of constraints){
   if(constraint.kind!=='f')checkRemoved(constraint.name,constraint.definition);
   if(constraint.kind==='n'){
    const column=identifier((constraint.definition||'').replace(/^NOT NULL\s+/i,''));
    if(column===null)warnings.push('NOT NULL 열 메타데이터 수동 검토: '+label(constraint.name));
    else if(!columns.has(column))errors.push('상속 NOT NULL의 열 없음: '+label(constraint.name)+' → '+column);
    else if(columns.get(column).nullable)errors.push('NULL 허용과 상속 NOT NULL 충돌: '+label(constraint.name)+' → '+column);
   }
   if(['p','u'].includes(constraint.kind)){
    const names=keyColumns(constraint.definition||'',constraint.kind);
    if(!names)warnings.push('상속 키 열 메타데이터 수동 검토: '+label(constraint.name));
    else for(const column of names){
     if(!columns.has(column))errors.push('상속 키의 열 없음: '+label(constraint.name)+' → '+column);
     else if(constraint.kind==='p'&&columns.get(column).nullable)errors.push('NULL 허용과 상속 PK 충돌: '+label(constraint.name)+' → '+column);
    }
   }
   if(constraint.kind==='f'&&!foreignKeys.some(key=>key.name===constraint.name))errors.push('상속 FK 투영 없음: '+label(constraint.name));
  }
  for(const foreignKey of foreignKeys){
   if(!constraints.some(constraint=>constraint.kind==='f'&&constraint.name===foreignKey.name))errors.push('제약 없는 상속 FK 투영: '+label(foreignKey.name));
   for(const column of list(foreignKey.columns))if(!columns.has(column))errors.push('상속 FK의 로컬 열 없음: '+label(foreignKey.name)+' → '+column);
   if(String(foreignKey.target_table).startsWith('workhub.')){
    const target=byName.get(foreignKey.target_table.slice('workhub.'.length));
    if(!target)errors.push('상속 FK의 대상 표 없음: '+label(foreignKey.name)+' → '+foreignKey.target_table);
    else for(const column of list(foreignKey.target_columns))if(!list(target.columns).some(item=>item.name===column))errors.push('상속 FK의 대상 열 없음: '+label(foreignKey.name)+' → '+foreignKey.target_table+'.'+column);
   }
  }
  for(const index of list(table.inherited_indexes)){
   // 인덱스명·표 이름은 검사 대상 열이 아니다. 키/조건 구간만 비교한다.
   const definition=String(index.definition||'').replace(/^CREATE\s+(?:UNIQUE\s+)?INDEX\s+\S+\s+ON\s+\S+\s+(?:USING\s+\S+\s+)?/i,'');
   checkRemoved(index.name||index.indexname,definition);
  }
  for(const constraint of list(table.superseded_constraints)){
   if(constraints.some(item=>item.name===constraint.name))errors.push('대체 제약이 상속 목록에 남음: '+label(constraint.name));
   if(constraint.kind==='f'&&foreignKeys.some(item=>item.name===constraint.name))errors.push('대체 FK가 상속 투영에 남음: '+label(constraint.name));
  }
  for(const index of list(table.superseded_indexes))if(list(table.inherited_indexes).some(item=>(item.name||item.indexname)===(index.name||index.indexname)))errors.push('대체 인덱스가 상속 목록에 남음: '+label(index.name||index.indexname));
 }
 // default:null은 기본값 제거다. 생략과 구분하고 마지막 명시 변경이 결과에 반영됐는지 확인한다.
 const expected=new Map();
 for(const change of changes){
  const tableName=String(change.table).replace(/^workhub\./,'');
  for(const column of list(change.drop_columns))expected.delete(tableName+'.'+column);
  for(const column of list(change.columns)){
   const key=tableName+'.'+column.name,properties=expected.get(key)||{};
   for(const property of ['nullable','default'])if(Object.hasOwn(column,property))properties[property]=column[property];
   expected.set(key,properties);
  }
 }
 for(const [key,properties]of expected){
  const [tableName,columnName]=key.split('.');
  const column=list(byName.get(tableName)?.columns).find(item=>item.name===columnName);
  if(!column){errors.push('명시 변경 열의 생성 결과 없음: '+key);continue;}
  for(const [property,value]of Object.entries(properties))if(JSON.stringify(column[property])!==JSON.stringify(value))errors.push('명시 열 변경값 불일치: '+key+'.'+property);
 }
 return {errors,warnings};
}
module.exports={validateDesignConstraints};

