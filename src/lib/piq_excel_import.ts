/** Browser-only PIQ Excel parser. Reads XLSX worksheets without a third-party package. */
export type PIQExcelRow = { month: number; scores: [number,number,number,number,number,number,number]; notes: string }
export type PIQExcelPreview = { rows: PIQExcelRow[]; skipped: number; sheet: string }
const decoder = new TextDecoder()
const u16 = (v:DataView,p:number) => v.getUint16(p,true)
const u32 = (v:DataView,p:number) => v.getUint32(p,true)
const monthNames=['januari','februari','maret','april','mei','juni','juli','agustus','september','oktober','november','desember']
function parseXml(src:string):Document {
  const doc=new DOMParser().parseFromString(src,'application/xml')
  if(doc.getElementsByTagName('parsererror').length)throw Error('Struktur XML dalam Excel tidak valid.')
  return doc
}
const elems=(parent:Element,name:string)=>Array.from(parent.getElementsByTagName('*')).filter(e=>e.localName===name)
const children=(parent:Element,name:string)=>Array.from(parent.children).filter(e=>e.localName===name)
async function entries(file:File):Promise<Map<string,string>> {
  if(!/\.xlsx$/i.test(file.name))throw Error('Pilih file Excel .xlsx.')
  if(file.size>5*1024*1024)throw Error('Ukuran Excel maksimal 5 MB.')
  const bytes=new Uint8Array(await file.arrayBuffer()), view=new DataView(bytes.buffer)
  let end=-1
  for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--){if(u32(view,i)===0x06054b50){end=i;break}}
  if(end<0)throw Error('File bukan XLSX valid.')
  const count=u16(view,end+10),central=u32(view,end+16)
  if(count>300)throw Error('Workbook Excel terlalu besar.')
  const files=new Map<string,string>();let pos=central,total=0
  for(let i=0;i<count;i++){
    if(pos+46>bytes.length||u32(view,pos)!==0x02014b50)throw Error('Struktur Excel rusak.')
    const method=u16(view,pos+10),compressed=u32(view,pos+20),uncompressed=u32(view,pos+24)
    const nameLength=u16(view,pos+28),extra=u16(view,pos+30),comment=u16(view,pos+32),offset=u32(view,pos+42)
    const path=decoder.decode(bytes.subarray(pos+46,pos+46+nameLength));pos+=46+nameLength+extra+comment
    if(!/^xl\/(worksheets\/sheet\d+\.xml|sharedStrings\.xml)$/.test(path))continue
    total+=uncompressed;if(total>16*1024*1024)throw Error('Isi Excel terlalu besar.')
    if(offset+30>bytes.length||u32(view,offset)!==0x04034b50)throw Error('File Excel rusak.')
    const start=offset+30+u16(view,offset+26)+u16(view,offset+28)
    if(start+compressed>bytes.length)throw Error('Data Excel tidak lengkap.')
    const input=bytes.slice(start,start+compressed)
    let output:Uint8Array
    if(method===0)output=input
    else if(method===8){
      if(typeof DecompressionStream==='undefined')throw Error('Browser tidak mendukung import XLSX. Gunakan Chrome terbaru.')
      const stream=new Blob([input.buffer as ArrayBuffer]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
      output=new Uint8Array(await new Response(stream).arrayBuffer())
    } else throw Error('Metode kompresi Excel tidak didukung.')
    if(output.byteLength!==uncompressed)throw Error('Ukuran data Excel tidak sesuai.')
    files.set(path,decoder.decode(output))
  }
  return files
}
function matrix(xml:string,strings:string[]):string[][] {
  const rows:string[][]=[]
  for(const row of elems(parseXml(xml).documentElement,'row')){
    const line:string[]=[]
    for(const cell of children(row,'c')){
      const address=cell.getAttribute('r')||'';const letters=/^[A-Z]+/.exec(address)?.[0]
      if(!letters)continue
      let col=0;for(const l of letters)col=col*26+l.charCodeAt(0)-64;col--
      if(col>50)continue
      const kind=cell.getAttribute('t')||''
      const value=children(cell,'v')[0]?.textContent||''
      const inline=elems(cell,'t').map(x=>x.textContent||'').join('')
      line[col]=kind==='s'?strings[Number(value)]||'':kind==='inlineStr'?inline:value
    }
    rows.push(line)
  }
  return rows
}
function readMonth(value:string):number|null {
  const s=value.trim().toLocaleLowerCase('id-ID')
  if(!s)return null
  const i=monthNames.indexOf(s)
  if(i>=0)return i+1
  const n=Number(s)
  return Number.isInteger(n)&&n>=1&&n<=12?n:null
}
function score(value:string):number|null {
  const s=value.trim().toUpperCase().replace(/\s+/g,' ')
  if(!s||s==='—'||s==='-')return null
  if(/^(A(?:\s*[·\-]\s*2)?|2)$/.test(s))return 2
  if(/^(B(?:\s*[·\-]\s*1)?|1)$/.test(s))return 1
  if(/^(C(?:\s*[·\-]\s*0)?|0)$/.test(s))return 0
  throw Error(`Nilai pilar "${value}" tidak valid. Gunakan A, B, C atau A · 2, B · 1, C · 0.`)
}
export async function readPIQExcel(file:File):Promise<PIQExcelPreview>{
  const files=await entries(file)
  const stringsXml=files.get('xl/sharedStrings.xml')
  const strings=stringsXml?elems(parseXml(stringsXml).documentElement,'si').map(x=>elems(x,'t').map(t=>t.textContent||'').join('')):[]
  const sheets=Array.from(files.keys()).filter(p=>/^xl\/worksheets\/sheet\d+\.xml$/.test(p)).sort((a,b)=>Number(a.match(/sheet(\d+)/)?.[1])-Number(b.match(/sheet(\d+)/)?.[1]))
  for(const sheet of sheets){
    const lines=matrix(files.get(sheet)!,strings)
    const header=lines.findIndex((r,i)=>i<20&&r[0]?.trim().toLowerCase()==='bulan'&&r.some(v=>v?.trim().toLowerCase()==='total'))
    if(header<0)continue
    const cols=lines[header]
    const totalIndex=cols.findIndex(v=>v?.trim().toLowerCase()==='total')
    if(totalIndex!==8)throw Error('Format tabel PIQ tidak sesuai. Harus ada Bulan, 7 pilar, lalu Total.')
    const noteIndex=cols.findIndex(v=>v?.trim().toLowerCase()==='catatan am')
    const result:PIQExcelRow[]=[], seen=new Set<number>();let skipped=0
    for(let i=header+1;i<lines.length;i++){
      const row=lines[i];const month=readMonth(row[0]||'')
      if(month===null){if(row.some(x=>x?.trim()))throw Error(`Baris ${i+1}: nama bulan tidak dikenali.`);continue}
      if(seen.has(month))throw Error(`Bulan ${monthNames[month-1]} muncul lebih dari sekali.`)
      seen.add(month)
      const inputs=Array.from({length:7},(_,j)=>String(row[j+1]||'').trim())
      if(inputs.every(v=>!v||v==='—'||v==='-')){skipped++;continue}
      const values=inputs.map(v=>score(v))
      if(values.some(v=>v===null))throw Error(`Baris ${i+1} (${monthNames[month-1]}): ketujuh pilar wajib diisi jika bulan diimpor.`)
      const notes=noteIndex>=0?String(row[noteIndex]||''):''
      if(notes.length>2000)throw Error(`Baris ${i+1}: Catatan AM maksimal 2.000 karakter.`)
      result.push({month,scores:values as PIQExcelRow['scores'],notes})
    }
    if(!result.length)throw Error('Tidak ada audit lengkap untuk diimpor. Isi 7 pilar minimal pada satu bulan.')
    if(result.length>12)throw Error('Maksimal 12 bulan per file.')
    return {rows:result,skipped,sheet:sheet.split('/').pop()||'Sheet 1'}
  }
  throw Error('Format tidak dikenali. Gunakan Download Template dari PIQ Performance.')
}
