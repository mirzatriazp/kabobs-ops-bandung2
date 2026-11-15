/** Browser-only XLSX reader for Kabobs Schedule Visit AM. No dependencies. */
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

export type VisitExcelRow = {date:string;shift:string;visit1:string;activity1:string;visit2:string;activity2:string;online:string;onlineActivity:string;km:number|null;notes:string}
export type VisitExcelResult = {rows:VisitExcelRow[];warnings:string[];format:string}
const text=(v:unknown)=>String(v??'').trim()
const norm=(v:unknown)=>text(v).toUpperCase().replace(/\s+/g,' ')
const shiftCodes=new Set(['O8','O9','M10','M11','M12','M13','C14','C15','OFF','GHK','PH','CUTI','SAKIT'])
const dateValue=(v:unknown):string|null=>{
 if(typeof v==='number'&&v>30000&&v<80000){return new Date(Date.UTC(1899,11,30)+Math.floor(v)*86400000).toISOString().slice(0,10)}
 const raw=text(v)
 if(/^\d{4}-\d\d-\d\d$/.test(raw))return raw
 const m=raw.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/)
 return m?`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`:null
}
const parseKm=(v:unknown):number|null=>{
 if(v===null||v===undefined||text(v)==='')return null
 const n=Number(typeof v==='string'?v.replace(',','.'):v)
 if(!Number.isFinite(n)||n<0||n>9999)throw Error('KM harus angka 0–9999.')
 return n
}
function makeRow(date:string):VisitExcelRow{return {date,shift:'',visit1:'',activity1:'',visit2:'',activity2:'',online:'',onlineActivity:'',km:null,notes:''}}
function validated(row:VisitExcelRow):VisitExcelRow {
 row.shift=norm(row.shift)
 if(row.shift&&!shiftCodes.has(row.shift))throw Error(`Kode shift tidak dikenal: ${row.shift} (${row.date})`)
 for(const field of ['activity1','activity2','onlineActivity'] as const){row[field]=text(row[field]);if(row[field].length>100||/[\x00-\x1f\x7f]/.test(row[field]))throw Error(`To Do pada ${row.date} maksimal 100 karakter tanpa karakter kontrol.`);if(['DIQM','IQM','SO'].includes(norm(row[field])))row[field]=norm(row[field])}
 return row
}
export async function readVisitExcel(file:File,year:number,month:number):Promise<VisitExcelResult>{
 if(!/\.xlsx$/i.test(file.name))throw Error('File harus berformat .xlsx.')
 const files=await unzipXlsx(file)
 const stringsDoc=files.get('xl/sharedStrings.xml')
 const strings=stringsDoc?descendant(xml(stringsDoc).documentElement,'si').map(si=>descendant(si,'t').map(t=>t.textContent||'').join('')):[]
 const sheets=[...files.keys()].filter(k=>/^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort((a,b)=>Number(a.match(/\d+/g)?.at(-1))-Number(b.match(/\d+/g)?.at(-1)))
 const dates=Array.from({length:new Date(year,month,0).getDate()},(_,i)=>`${year}-${String(month).padStart(2,'0')}-${String(i+1).padStart(2,'0')}`)
 const dateSet=new Set(dates),warnings:string[]=[]
 for(const sheet of sheets){
  const matrix=parseSheet(files.get(sheet)!,strings)
  // Vertical import: one day per row; this is the format generated by this module.
  let header=-1,idx:Record<string,number>={}
  for(let i=0;i<Math.min(10,matrix.length);i++){
   const labels=matrix[i].map(norm)
   const dateIdx=labels.findIndex(x=>x==='TANGGAL'||x==='DATE')
   const shiftIdx=labels.findIndex(x=>x==='SHIFT'||x==='KODE SHIFT')
   if(dateIdx>=0&&shiftIdx>=0){header=i; idx={date:dateIdx,shift:shiftIdx,visit1:labels.findIndex(x=>x==='VISIT 1'),activity1:labels.findIndex(x=>x==='AGENDA 1'||x==='KEGIATAN 1'||x==='TO DO'),visit2:labels.findIndex(x=>x==='VISIT 2'),activity2:labels.findIndex((x,j)=>x==='AGENDA 2'||x==='KEGIATAN 2'||x==='TO DO 2'||(x==='TO DO'&&j>labels.findIndex(y=>y==='VISIT 2'))),online:labels.findIndex(x=>x==='VISIT ONLINE'),onlineActivity:labels.findIndex(x=>x==='AGENDA ONLINE'||x==='TO DO ONLINE'),km:labels.findIndex(x=>x==='KM'||x==='JARAK KM'),notes:labels.findIndex(x=>x==='CATATAN')};break}
  }
  if(header>=0){
   const out:VisitExcelRow[]=[],seen=new Set<string>()
   for(let i=header+1;i<matrix.length;i++){
    const line=matrix[i],date=dateValue(line[idx.date]);if(!date)continue
    if(!dateSet.has(date))throw Error(`Excel berisi ${date} di luar periode ${month}/${year}.`)
    if(seen.has(date))throw Error(`Tanggal duplikat dalam Excel: ${date}`);seen.add(date)
    const get=(key:string)=>idx[key]>=0?text(line[idx[key]]):''
    const r=makeRow(date);r.shift=get('shift');r.visit1=get('visit1');r.activity1=get('activity1');r.visit2=get('visit2');r.activity2=get('activity2');r.online=get('online');r.onlineActivity=get('onlineActivity');r.km=idx.km>=0?parseKm(line[idx.km]):null;r.notes=get('notes');out.push(validated(r))
   }
   if(!out.length)throw Error('Tidak ada tanggal jadwal yang terbaca.')
   return {rows:out,warnings,format:'Vertikal (hasil Download Excel Schedule Visit AM)'}
  }
  // Horizontal legacy template: row 2 dates, row 3 shift, row 4-5 offline visits, row 6 online, row 7 KM.
  for(let i=0;i<Math.min(8,matrix.length-6);i++){
   const columnDates=new Map<number,string>()
   matrix[i].forEach((value,c)=>{const date=dateValue(value);if(date&&dateSet.has(date))columnDates.set(c,date)})
   if(columnDates.size<Math.min(5,dates.length))continue
   const out:VisitExcelRow[]=[]
   for(const [column,date] of columnDates){
    const get=(offset:number)=>matrix[i+offset]?.[column]
    const r=makeRow(date);r.shift=text(get(1));r.visit1=text(get(2));r.visit2=text(get(3));r.online=text(get(4));r.km=parseKm(get(5));out.push(validated(r))
   }
   if(out.length!==dates.length)warnings.push(`Hanya ${out.length} dari ${dates.length} tanggal ditemukan. Tanggal lainnya tidak diubah.`)
   warnings.push('Template lama tidak berisi agenda DIQM/IQM/SO; lengkapi agenda pada website setelah import.')
   return {rows:out,warnings,format:'Horizontal (template Schedule AM lama)'}
  }
 }
 throw Error('Format tidak dikenali. Pakai template lama yang menyamping atau file Download Excel dari modul Schedule Visit AM.')
}
