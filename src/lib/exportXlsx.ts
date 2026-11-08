/** Small dependency-free XLSX writer. Exported cells are data only, never formulas. */
export type ExcelCell = string | number | null | undefined
export type ExcelSheet = { name: string; rows: ExcelCell[][]; currencyColumns?: number[]; percentColumns?: number[] }

const utf8 = new TextEncoder()
const xml = (value: unknown): string => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')
const colRef = (index: number): string => { let n=index+1, s=''; while(n){n--;s=String.fromCharCode(65+n%26)+s;n=Math.floor(n/26)}return s }
const uint16 = (v:number) => [v&255,(v>>>8)&255]
const uint32 = (v:number) => [v&255,(v>>>8)&255,(v>>>16)&255,(v>>>24)&255]
const crcTable = Array.from({length:256}, (_,n) => {let c=n;for(let j=0;j<8;j++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;return c>>>0})
const crc32 = (bytes:Uint8Array):number => {let crc=0xffffffff;for(const byte of bytes)crc=crcTable[(crc^byte)&255]^(crc>>>8);return (crc^0xffffffff)>>>0}
function zipStored(entries:{name:string;data:string}[]):Blob {
  const local:Uint8Array[]=[];const central:Uint8Array[]=[];let offset=0
  for(const e of entries){
    const name=utf8.encode(e.name), content=utf8.encode(e.data), crc=crc32(content)
    const header=new Uint8Array([0x50,0x4b,3,4,20,0,0,0,0,0,0,0,0,0,...uint32(crc),...uint32(content.length),...uint32(content.length),...uint16(name.length),0,0])
    local.push(header,name,content)
    central.push(new Uint8Array([0x50,0x4b,1,2,20,0,20,0,0,0,0,0,0,0,0,0,...uint32(crc),...uint32(content.length),...uint32(content.length),...uint16(name.length),0,0,0,0,0,0,0,0,0,0,0,0,...uint32(offset)]),name)
    offset+=header.length+name.length+content.length
  }
  const centralSize=central.reduce((sum,a)=>sum+a.length,0)
  const end=new Uint8Array([0x50,0x4b,5,6,0,0,0,0,...uint16(entries.length),...uint16(entries.length),...uint32(centralSize),...uint32(offset),0,0])
  // Copy all ZIP segments into a buffer backed by a plain ArrayBuffer.
  // TypeScript 6 distinguishes Uint8Array<ArrayBufferLike> from BlobPart.
  const segments = [...local, ...central, end]
  const size = segments.reduce((sum, part) => sum + part.byteLength, 0)
  const buffer = new ArrayBuffer(size)
  const combined = new Uint8Array(buffer)
  let position = 0
  for (const part of segments) {
    combined.set(part, position)
    position += part.byteLength
  }
  return new Blob([buffer], {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})
}
function sheetXml(sheet:ExcelSheet):string {
  const currency=new Set(sheet.currencyColumns||[]),percent=new Set(sheet.percentColumns||[])
  const sheetRows=sheet.rows.map((row,r)=>`<row r="${r+1}">${row.map((v,c)=>{
    if(v===null||v===undefined||v==='')return ''
    const at=` r="${colRef(c)}${r+1}" s="${r===0?1:currency.has(c)?2:percent.has(c)?3:0}"`
    return typeof v==='number'&&Number.isFinite(v)?`<c${at}><v>${v}</v></c>`:`<c${at} t="inlineStr"><is><t xml:space="preserve">${xml(v)}</t></is></c>`
  }).join('')}</row>`).join('')
  const count=Math.max(1,...sheet.rows.map(r=>r.length))
  const widths=Array.from({length:count},(_,c)=>{
    const max=Math.min(36,Math.max(13,...sheet.rows.slice(0,90).map(row=>String(row[c]??'').length+3)))
    return `<col min="${c+1}" max="${c+1}" width="${max}" customWidth="1"/>`
  }).join('')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths}</cols><sheetData>${sheetRows}</sheetData><autoFilter ref="A1:${colRef(count-1)}${Math.max(1,sheet.rows.length)}"/></worksheet>`
}
const styles=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="&quot;Rp &quot;#,##0;[Red](&quot;Rp &quot;#,##0)"/><numFmt numFmtId="165" formatCode="0.00%"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF142039"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFill="1" applyFont="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>`
export function downloadXlsx(filename:string, sheets:ExcelSheet[]):void {
  if(!sheets.length)throw new Error('Tidak ada sheet untuk diekspor')
  const safe=sheets.map((sheet,i)=>({...sheet,name:(sheet.name.replace(/[\\/*?:\[\]]/g,' ').trim().slice(0,31)||`Sheet ${i+1}`)}))
  const entries=[
    {name:'[Content_Types].xml',data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${safe.map((_,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`},
    {name:'_rels/.rels',data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`},
    {name:'xl/workbook.xml',data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${safe.map((s,i)=>`<sheet name="${xml(s.name)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')}</sheets></workbook>`},
    {name:'xl/_rels/workbook.xml.rels',data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${safe.map((_,i)=>`<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')}<Relationship Id="rId${safe.length+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`},
    {name:'xl/styles.xml',data:styles},
    ...safe.map((s,i)=>({name:`xl/worksheets/sheet${i+1}.xml`,data:sheetXml(s)})),
  ]
  const blob=zipStored(entries),url=URL.createObjectURL(blob),anchor=document.createElement('a')
  anchor.href=url;anchor.download=filename.endsWith('.xlsx')?filename:`${filename}.xlsx`;document.body.appendChild(anchor);anchor.click();anchor.remove()
  window.setTimeout(()=>URL.revokeObjectURL(url),30000)
}
