/** Browser-only XLSX reader for Kabobs Schedule. No dependencies. */
export type ImportedCrew = { name: string; nik: string; codes: Record<string,string> }
export type ScheduleImport = { sheet: string; rows: ImportedCrew[]; warnings: string[]; matchedDates: number }
const decoder = new TextDecoder()
const u16 = (b:DataView,p:number)=>b.getUint16(p,true)
const u32 = (b:DataView,p:number)=>b.getUint32(p,true)

async function unzipXlsx(file:File):Promise<Map<string,string>> {
  if(file.size>4*1024*1024)throw Error('File Excel maksimal 4 MB.')
  const buffer=await file.arrayBuffer(), view=new DataView(buffer), bytes=new Uint8Array(buffer)
  let eocd=-1
  for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--){if(u32(view,i)===0x06054b50){eocd=i;break}}
  if(eocd<0)throw Error('File bukan XLSX yang valid.')
  const count=u16(view,eocd+10),central=u32(view,eocd+16)
  if(count>200)throw Error('Workbook memiliki terlalu banyak bagian.')
  const files=new Map<string,string>();let p=central,total=0
  for(let i=0;i<count;i++){
    if(u32(view,p)!==0x02014b50)throw Error('Struktur ZIP Excel tidak valid.')
    const method=u16(view,p+10),compressed=u32(view,p+20),uncompressed=u32(view,p+24),nameLen=u16(view,p+28),extra=u16(view,p+30),comment=u16(view,p+32),offset=u32(view,p+42)
    const name=decoder.decode(bytes.subarray(p+46,p+46+nameLen));p+=46+nameLen+extra+comment
    if(!/^(xl\/(worksheets\/sheet\d+\.xml|sharedStrings\.xml|workbook\.xml|_rels\/workbook\.xml\.rels))$/.test(name))continue
    total+=uncompressed;if(total>18*1024*1024)throw Error('Ukuran data Excel terlalu besar.')
    if(u32(view,offset)!==0x04034b50)throw Error('Data XLSX rusak.')
    const start=offset+30+u16(view,offset+26)+u16(view,offset+28)
    const block=bytes.slice(start,start+compressed)
    let content:Uint8Array
    if(method===0) content=block
    else if(method===8){
      if(!('DecompressionStream' in window))throw Error('Browser tidak mendukung pembacaan XLSX. Gunakan Chrome terbaru.')
      const stream=new Blob([block.buffer as ArrayBuffer]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
      content=new Uint8Array(await new Response(stream).arrayBuffer())
    }else throw Error('Kompresi XLSX tidak didukung.')
    if(content.length!==uncompressed)throw Error('Ukuran isi XLSX tidak sesuai.')
    files.set(name,decoder.decode(content))
  }
  return files
}
function xml(src:string){const d=new DOMParser().parseFromString(src,'application/xml');if(d.querySelector('parsererror'))throw Error('XML di dalam Excel rusak.');return d}
function local(el:Element,name:string){return [...el.children].filter(e=>e.localName===name)}
function descendant(el:Element,name:string){return [...el.getElementsByTagName('*')].filter(e=>e.localName===name)}
function excelDate(value:unknown):string|null {
  if(typeof value==='number'&&Number.isFinite(value)&&value>30000&&value<80000){const d=new Date(Date.UTC(1899,11,30)+Math.floor(value)*86400000);return d.toISOString().slice(0,10)}
  const raw=String(value??'').trim()
  if(/^\d{4}-\d\d-\d\d/.test(raw))return raw.slice(0,10)
  const dm=raw.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/)
  if(dm)return `${dm[3]}-${dm[2].padStart(2,'0')}-${dm[1].padStart(2,'0')}`
  return null
}
function parseSheet(content:string,strings:string[]):unknown[][]{
  const doc=xml(content), rows:unknown[][]=[]
  for(const r of descendant(doc.documentElement,'row')){
    const line:unknown[]=[]
    for(const c of local(r,'c')){
      const name=c.getAttribute('r')||'',letters=name.match(/^[A-Z]+/)?.[0]
      if(!letters)continue
      let index=0;for(const s of letters)index=index*26+s.charCodeAt(0)-64;index--
      if(index>150)continue
      const type=c.getAttribute('t')||'',v=local(c,'v')[0]?.textContent||''
      const inline=descendant(c,'t').map(n=>n.textContent||'').join('')
      line[index]=type==='s'?strings[Number(v)]||'':type==='inlineStr'?inline:type==='b'?v==='1':!v?'':type==='str'?v:Number.isFinite(Number(v))?Number(v):v
    }
    rows.push(line)
  }
  return rows
}
const normalize=(v:unknown)=>String(v??'').trim().toUpperCase().replace(/\s+/g,' ')
const ALLOWED=new Set(['O8','O9','M10','M11','M12','M13','C14','C15','OFF','GHK','CUTI TAHUNAN','CUTI SPESIAL','IZIN'])
export async function readScheduleExcel(file:File,dates:string[]):Promise<ScheduleImport>{
  if(!/\.xlsx$/i.test(file.name))throw Error('Gunakan Excel berformat .xlsx.')
  const parts=await unzipXlsx(file)
  const stringsDoc=parts.get('xl/sharedStrings.xml')
  const strings=stringsDoc?descendant(xml(stringsDoc).documentElement,'si').map(si=>descendant(si,'t').map(t=>t.textContent||'').join('')):[]
  const sheetNames=[...parts.keys()].filter(k=>/^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort((a,b)=>Number(a.match(/\d+/g)?.at(-1))-Number(b.match(/\d+/g)?.at(-1)))
  let best:{sheet:string;rows:unknown[][];header:number;matches:Map<number,string>;nameIdx:number;nikIdx:number}|null=null
  for(const sheet of sheetNames){
    const rows=parseSheet(parts.get(sheet)!,strings)
    for(let index=0;index<Math.min(rows.length,12);index++){
      const row=rows[index],names=row.map(normalize),nameIdx=names.findIndex(v=>v==='NAMA'||v==='NAMA CREW'||v==='NAMA KARYAWAN'),nikIdx=names.findIndex(v=>v==='NIK')
      if(nameIdx<0||nikIdx<0)continue
      const matches=new Map<number,string>()
      row.forEach((v,col)=>{const d=excelDate(v);if(d&&dates.includes(d))matches.set(col,d)})
      if(matches.size>=Math.min(5,dates.length)&&(!best||matches.size>best.matches.size))best={sheet,rows,header:index,matches,nameIdx,nikIdx}
    }
  }
  if(!best)throw Error('Header Excel tidak sesuai. Diperlukan kolom NAMA, NIK dan tanggal periode 26–25 pada baris header.')
  const found=best as {sheet:string;rows:unknown[][];header:number;matches:Map<number,string>;nameIdx:number;nikIdx:number}
  if(found.matches.size!==dates.length)throw Error(`Tanggal tidak lengkap/sesuai periode. Terbaca ${found.matches.size} dari ${dates.length} tanggal. Pilih bulan dan tahun yang sesuai Excel.`)
  const seen=new Set<string>(),out:ImportedCrew[]=[],warnings:string[]=[]
  for(let i=found.header+1;i<found.rows.length;i++){
    const line=found.rows[i],name=String(line[found.nameIdx]??'').trim(),nik=String(line[found.nikIdx]??'').trim().replace(/\.0$/,'')
    if(!name&&!nik)continue
    if(!name||!nik){warnings.push(`Baris ${i+1}: nama atau NIK kosong, dilewati.`);continue}
    if(seen.has(nik.toLowerCase())){warnings.push(`Baris ${i+1}: NIK ${nik} duplikat, hanya kemunculan pertama dipakai.`);continue}
    seen.add(nik.toLowerCase())
    const codes:Record<string,string>={}
    for(const [idx,date] of found.matches){const original=normalize(line[idx]);if(!original||original==='-'||original==='—')continue
      if(!ALLOWED.has(original))throw Error(`Kode shift tidak dikenal pada baris ${i+1}, tanggal ${date}: "${original}". Perbaiki file Excel sebelum upload.`)
      codes[date]=original
    }
    out.push({name,nik,codes})
    if(out.length>100)throw Error('Maksimal 100 crew per upload.')
  }
  if(!out.length)throw Error('Tidak ada nama dan NIK crew yang bisa diimpor.')
  return {sheet:found.sheet.split('/').at(-1)||'Sheet 1',rows:out,warnings,matchedDates:found.matches.size}
}
