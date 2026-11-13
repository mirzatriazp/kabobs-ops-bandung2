/** XLSX reader for the KABOBS Sales import. No npm dependencies.
 * Supports conventional XLSX files (ZIP stored/DEFLATE) in Chromium browsers.
 * Only reads data; never evaluates formulas or macros.
 */
export type SalesImportRow = { outletId: string; outlet: string; date: string; target: number | null; actual: number | null; excelRow: number }
export type SalesImportMode = 'target' | 'historical'
export type SalesOutlet = {id:string;outlet_name:string;outlet_code:string}
export type SalesImportPreview = {rows:SalesImportRow[];warnings:string[];sheet:string; skipped:number}
const td = new TextDecoder()
const norm = (s:unknown) => String(s??'').trim().toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g,'')
const dateOnly = (y:number,m:number,d:number):string|null => {
  const t=new Date(Date.UTC(y,m-1,d))
  return t.getUTCFullYear()===y&&t.getUTCMonth()===m-1&&t.getUTCDate()===d ? `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}` : null
}
function parseDate(v:unknown):string|null {
  if(typeof v==='number' && Number.isFinite(v) && v>20000 && v<90000){
    const d=new Date(Date.UTC(1899,11,30)+Math.floor(v)*86400000)
    return dateOnly(d.getUTCFullYear(),d.getUTCMonth()+1,d.getUTCDate())
  }
  const s=String(v??'').trim()
  let m=s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:\s.*)?$/)
  if(m)return dateOnly(+m[1],+m[2],+m[3])
  m=s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/)
  if(m)return dateOnly(+m[3],+m[2],+m[1])
  return null
}
function money(v:unknown):number|null|undefined {
  if(v===undefined || v===null || String(v).trim()==='')return null
  if(typeof v==='number')return Number.isFinite(v)&&v>=0&&Number.isSafeInteger(v)?v:undefined
  const s=String(v).trim().replace(/\s/g,'').replace(/^rp\.?/i,'')
  if(!/^[\d.,]+$/.test(s))return undefined
  let n:string
  if(/,\d{1,2}$/.test(s))n=s.replace(/\./g,'').replace(',','.')
  else if(/\.\d{1,2}$/.test(s)&&!s.includes(','))n=s
  else n=s.replace(/[.,]/g,'')
  const val=Number(n)
  return Number.isSafeInteger(val)&&val>=0?val:undefined
}
async function unzip(bytes:Uint8Array):Promise<Map<string,Uint8Array>>{
  const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength)
  let eocd=-1
  for(let p=bytes.length-22;p>=Math.max(0,bytes.length-65557);p--){if(v.getUint32(p,true)===0x06054b50){eocd=p;break}}
  if(eocd<0)throw new Error('File bukan XLSX yang valid (ZIP tidak terbaca).')
  const count=v.getUint16(eocd+10,true), start=v.getUint32(eocd+16,true)
  if(count>200)throw new Error('File memiliki terlalu banyak bagian.')
  const out=new Map<string,Uint8Array>();let p=start
  for(let i=0;i<count;i++){
    if(v.getUint32(p,true)!==0x02014b50)throw new Error('Struktur XLSX rusak.')
    const method=v.getUint16(p+10,true),compressed=v.getUint32(p+20,true),size=v.getUint32(p+24,true)
    const len=v.getUint16(p+28,true),extra=v.getUint16(p+30,true),comment=v.getUint16(p+32,true),offset=v.getUint32(p+42,true)
    const filename=td.decode(bytes.subarray(p+46,p+46+len))
    p+=46+len+extra+comment
    if(!filename.startsWith('xl/')||(!filename.endsWith('.xml')&&!filename.endsWith('.rels')))continue
    if(size>12_000_000)throw new Error('File Excel terlalu besar.')
    if(v.getUint32(offset,true)!==0x04034b50)throw new Error('Bagian XLSX tidak valid.')
    const lo=v.getUint16(offset+26,true),lx=v.getUint16(offset+28,true)
    const data=bytes.subarray(offset+30+lo+lx,offset+30+lo+lx+compressed)
    if(method===0){out.set(filename,data.slice());continue}
    if(method!==8)throw new Error('Format kompresi Excel tidak didukung.')
    if(typeof DecompressionStream==='undefined')throw new Error('Browser tidak mendukung pembacaan Excel. Gunakan Chrome/Edge versi terbaru.')
    const stream=new Blob([new Uint8Array(data).buffer]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
    const result=new Uint8Array(await new Response(stream).arrayBuffer())
    if(result.length!==size)throw new Error('File Excel tidak terbaca sempurna.')
    out.set(filename,result)
  }
  return out
}
const xmlDoc=(bytes:Uint8Array)=>{
  const doc=new DOMParser().parseFromString(td.decode(bytes),'application/xml')
  if(doc.getElementsByTagName('parsererror').length)throw new Error('Bagian XML Excel rusak.')
  return doc
}
const els=(parent:Document|Element,tag:string)=>Array.from(parent.getElementsByTagNameNS('*',tag))
function getCellValues(doc:Document,strings:string[]):unknown[][] {
  const result:unknown[][]=[]
  for(const row of els(doc,'row')){
    const cells:unknown[]=[]
    for(const c of els(row,'c')){
      const address=c.getAttribute('r')||'';const letters=address.match(/^[A-Z]+/i)?.[0]||''
      let index=0;for(const ch of letters.toUpperCase())index=index*26+(ch.charCodeAt(0)-64)
      const idx=index-1
      if(idx<0||idx>200)continue
      const kind=c.getAttribute('t')
      const raw=els(c,'v')[0]?.textContent||''
      if(kind==='s')cells[idx]=strings[Number(raw)]||''
      else if(kind==='inlineStr')cells[idx]=els(c,'t').map(x=>x.textContent||'').join('')
      else if(kind==='str')cells[idx]=raw
      else if(kind==='b')cells[idx]=raw==='1'
      else if(raw!=='')cells[idx]=Number(raw)
      else cells[idx]=''
    }
    result.push(cells)
  }
  return result
}
function chooseSheet(files:Map<string,Uint8Array>):{name:string;rows:unknown[][]}{
  const wb=files.get('xl/workbook.xml'),rels=files.get('xl/_rels/workbook.xml.rels')
  if(!wb||!rels)throw new Error('Workbook Excel tidak lengkap.')
  const w=xmlDoc(wb),r=xmlDoc(rels)
  const targets=new Map(els(r,'Relationship').map(el=>[el.getAttribute('Id'),el.getAttribute('Target')||'']))
  const ss=files.get('xl/sharedStrings.xml');const strings=ss?els(xmlDoc(ss),'si').map(si=>els(si,'t').map(t=>t.textContent||'').join('')):[]
  const available: {name:string;rows:unknown[][]}[]=[]
  for(const sheet of els(w,'sheet')){
    const rid=sheet.getAttribute('r:id')||sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','id')
    const target=targets.get(rid)||''
    const path=target.startsWith('/')?target.replace(/^\//,''):target.startsWith('xl/')?target:`xl/${target.replace(/^\.\//,'')}`
    const safe=path.split('/').reduce<string[]>((acc,part)=>{if(part==='..')acc.pop();else if(part&&part!=='.')acc.push(part);return acc},[]).join('/')
    const bytes=files.get(safe)
    if(bytes)available.push({name:sheet.getAttribute('name')||'Sheet',rows:getCellValues(xmlDoc(bytes),strings)})
  }
  const choice=available.find(s=>s.rows.slice(0,10).some(row=>{
    const n=row.map(norm)
    return n.some(v=>['tanggal','salesdate','date'].includes(v))&&n.some(v=>v.includes('target'))
  }))
  if(!choice)throw new Error('Header Excel tidak ditemukan. Gunakan template Upload Sales: Outlet, Tanggal, Target Today, Actual Today.')
  return choice
}
export async function readSalesExcel(file:File,mode:SalesImportMode,outlets:SalesOutlet[],selectedOutlet:string,year:number,month:number):Promise<SalesImportPreview>{
  if(!file.name.toLowerCase().endsWith('.xlsx'))throw new Error('Gunakan file Excel .xlsx (bukan .xls atau .csv).')
  if(file.size>8*1024*1024)throw new Error('Ukuran Excel maksimal 8 MB.')
  const sheets=await unzip(new Uint8Array(await file.arrayBuffer()))
  const sheet=chooseSheet(sheets)
  const hi=sheet.rows.findIndex(row=>{
    const n=row.map(norm);return n.some(v=>['tanggal','salesdate','date'].includes(v))&&n.some(v=>v.includes('target'))
  })
  const h=sheet.rows[hi].map(norm)
  const index=(matches:(v:string)=>boolean)=>h.findIndex(matches)
  const dateIdx=index(v=>['tanggal','salesdate','date'].includes(v))
  const outIdx=index(v=>['outlet','namaoutlet','store','cabang','outletname'].includes(v))
  const targetIdx=index(v=>v.includes('target')&&!v.includes('selisih')&&!v.includes('todate'))
  const actualIdx=index(v=>v.includes('actual')&&!v.includes('todate'))
  if(mode==='historical'&&actualIdx<0)throw new Error('Kolom Actual Today / Actual Sales (Rp) wajib untuk import historis.')
  if(outIdx<0&&!selectedOutlet)throw new Error('Kolom Outlet tidak ada. Pilih satu outlet di filter atas sebelum upload.')
  const byName=new Map<string,SalesOutlet>()
  for(const o of outlets){byName.set(norm(o.outlet_name),o);byName.set(norm(o.outlet_code),o)}
  const rows:SalesImportRow[]=[],warnings:string[]=[],seen=new Set<string>();let skipped=0
  for(let i=hi+1;i<sheet.rows.length;i++){
    const r=sheet.rows[i];if(r.every(v=>v===null||v===undefined||String(v).trim()===''))continue
    const line=i+1;const date=parseDate(r[dateIdx]);if(!date){warnings.push(`Baris ${line}: tanggal tidak valid.`);skipped++;continue}
    const [yy,mm]=date.split('-').map(Number)
    if(yy!==year||mm!==month){warnings.push(`Baris ${line}: tanggal ${date} di luar periode ${month}/${year}.`);skipped++;continue}
    if(mode==='historical'&&(date<'2025-01-01'||date>'2026-10-31')){warnings.push(`Baris ${line}: mode historis hanya Januari 2025–Oktober 2026.`);skipped++;continue}
    const rawName=outIdx>=0?String(r[outIdx]??'').trim():''
    const out=rawName?byName.get(norm(rawName)):outlets.find(o=>o.id===selectedOutlet)
    if(!out){warnings.push(`Baris ${line}: outlet "${rawName||'(kosong)'}" tidak dikenali.`);skipped++;continue}
    if(selectedOutlet&&out.id!==selectedOutlet){warnings.push(`Baris ${line}: outlet tidak sama dengan filter yang dipilih.`);skipped++;continue}
    const target=money(r[targetIdx]), actual=mode==='historical'?money(r[actualIdx]):null
    if(target===undefined||actual===undefined){warnings.push(`Baris ${line}: nominal tidak valid (harus rupiah bulat ≥ 0).`);skipped++;continue}
    if(target===null && actual===null){skipped++;continue}
    const key=`${out.id}|${date}`
    if(seen.has(key)){warnings.push(`Baris ${line}: outlet/tanggal duplikat, diabaikan.`);skipped++;continue}
    seen.add(key)
    rows.push({outletId:out.id,outlet:out.outlet_name,date,target,actual,excelRow:line})
  }
  if(!rows.length)throw new Error(`Tidak ada data valid untuk ${month}/${year}. ${warnings.slice(0,3).join(' ')}`)
  return {rows,warnings,sheet:sheet.name,skipped}
}
