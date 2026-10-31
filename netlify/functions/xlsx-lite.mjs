/* Minimal XLSX (OOXML) report writer with Node built-ins only.
 * No spreadsheet formulas, macros, external links or uploaded templates.
 * For StayHub privacy-safe admin report tables, up to 5000 rows/sheet.
 */
import {deflateRawSync} from 'node:zlib';
const xml = v => String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const addr = n => {let s='';while(n){n--;s=String.fromCharCode(65+(n%26))+s;n=Math.floor(n/26);}return s;};
const crcTable = Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xEDB88320^(n>>>1):n>>>1;return n>>>0;});
function crc32(b){let c=0xFFFFFFFF;for(const v of b)c=crcTable[(c^v)&255]^(c>>>8);return(c^0xFFFFFFFF)>>>0;}
function zip(entries){
 const local=[],central=[];let offset=0;
 entries.forEach(([name,content])=>{
  const nm=Buffer.from(name),plain=Buffer.isBuffer(content)?content:Buffer.from(content,'utf8');
  const compressed=deflateRawSync(plain,{level:6}),crc=crc32(plain);
  const l=Buffer.alloc(30),c=Buffer.alloc(46);
  l.writeUInt32LE(0x04034b50,0);l.writeUInt16LE(20,4);l.writeUInt16LE(0,6);l.writeUInt16LE(8,8);
  l.writeUInt32LE(crc,14);l.writeUInt32LE(compressed.length,18);l.writeUInt32LE(plain.length,22);l.writeUInt16LE(nm.length,26);
  local.push(l,nm,compressed);
  c.writeUInt32LE(0x02014b50,0);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(8,10);
  c.writeUInt32LE(crc,16);c.writeUInt32LE(compressed.length,20);c.writeUInt32LE(plain.length,24);
  c.writeUInt16LE(nm.length,28);c.writeUInt32LE(offset,42);
  central.push(c,nm);offset+=l.length+nm.length+compressed.length;
 });
 const cdir=Buffer.concat(central),end=Buffer.alloc(22);
 end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);
 end.writeUInt32LE(cdir.length,12);end.writeUInt32LE(offset,16);
 return Buffer.concat([...local,cdir,end]);
}
const styles=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="&quot;RM&quot; #,##0.00"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF17383D"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF7F5F1"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="1" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="0" fontId="0" fillId="2" borderId="0" xfId="0" applyFill="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
function sheetXML(table,safeText){
 const columns=table.columns,cellText=(a,value,style=0)=>`<c r="${a}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(safeText(value))}</t></is></c>`;
 const cells=columns.map((c,i)=>cellText(addr(i+1)+'1',c.header,1)).join('');
 const lines=[`<row r="1" ht="27" customHeight="1">${cells}</row>`];
 for(let i=0;i<table.rows.length;i++){
  const r=table.rows[i],rn=i+2,parts=[];
  for(let j=0;j<columns.length;j++){
   const col=columns[j],a=addr(j+1)+rn,v=r[col.key];
   const numeric=typeof v==='number'&&Number.isFinite(v);
   const isMoney=col.type==='money'||(table.name==='Summary'&&col.key==='value'&&numeric&&String(r.metric||'').includes('(RM)'));
   parts.push(numeric?`<c r="${a}" s="${isMoney?3:i%2===1?2:0}"><v>${v}</v></c>`:cellText(a,v,i%2===1?2:0));
  }
  lines.push(`<row r="${rn}">${parts.join('')}</row>`);
 }
 const ws=columns.map((c,i)=>`<col min="${i+1}" max="${i+1}" width="${Math.min(38,Math.max(16,c.header.length+4))}" customWidth="1"/>`).join('');
 const last=addr(columns.length)+(table.rows.length+1);
 return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${last}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="17"/><cols>${ws}</cols><sheetData>${lines.join('')}</sheetData><autoFilter ref="A1:${last}"/><pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.3" footer="0.3"/></worksheet>`;
}
export function xlsxWorkbook(tables,{safeText}){
 const names=tables.map(t=>t.name.replace(/[\/:*?\[\]]/g,' ').slice(0,31));
 const entries=[
  ['[Content_Types].xml',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${tables.map((_,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`],
  ['_rels/.rels','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
  ['xl/workbook.xml',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n,i)=>`<sheet name="${xml(n)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')}</sheets></workbook>`],
  ['xl/_rels/workbook.xml.rels',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${tables.map((_,i)=>`<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')}<Relationship Id="rId${tables.length+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
  ['xl/styles.xml',styles],
  ...tables.map((t,i)=>[`xl/worksheets/sheet${i+1}.xml`,sheetXML(t,safeText)])
 ];
 return zip(entries);
}
