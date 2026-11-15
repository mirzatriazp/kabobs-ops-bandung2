import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { downloadXlsx, type ExcelCell } from '../lib/exportXlsx'
import { readVisitExcel, type VisitExcelRow } from '../lib/visit_excel_import'
import './ScheduleVisitAM.css'

type Outlet={id:string;outlet_name:string;outlet_code:string}
type Props={year:number;month:number;outlets:Outlet[]}
type Day=VisitExcelRow
const MONTHS=['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember']
const SHIFTS=['','O8','O9','M10','M11','M12','M13','C14','C15','OFF','GHK','PH','CUTI','SAKIT']
const ACTIVITIES=['','DIQM','IQM','SO']
const isOtherActivity=(value:string)=>Boolean(value)&&!ACTIVITIES.includes(value)
const ALIASES:Record<string,string>={'BEC Atas':'BEC','BIP Atas':'BIP','Ciwalk Depan':'Ciwalk','Yogya Sunda':'Sunda','Yogya Kepatihan':'Kepatihan','Griya Antapani':'Antapani','Cikutra':'Cikutra','Dipatiukur':'Dipatiukur'}
const normalized=(s:string)=>s.toLowerCase().trim().replace(/[^a-z0-9]/g,'')
const initial=(date:string):Day=>({date,shift:'',visit1:'',activity1:'',visit2:'',activity2:'',online:'',onlineActivity:'',km:null,notes:''})
const daysOf=(year:number,month:number)=>Array.from({length:new Date(year,month,0).getDate()},(_,i)=>`${year}-${String(month).padStart(2,'0')}-${String(i+1).padStart(2,'0')}`)
const weekday=(date:string)=>new Date(date+'T12:00:00').toLocaleDateString('id-ID',{weekday:'short'})
const fullDate=(date:string)=>new Date(date+'T12:00:00').toLocaleDateString('id-ID',{day:'2-digit',month:'short'})
const safeNum=(n:number|null)=>n===null?'—':n.toLocaleString('id-ID',{maximumFractionDigits:2})
const errText=(error:unknown)=>error && typeof error==='object' && 'message' in error ? String(error.message) : String(error||'Kesalahan tidak diketahui')

export default function ScheduleVisitAM({year,month,outlets}:Props){
 const monthDates=useMemo(()=>daysOf(year,month),[year,month])
 const [rows,setRows]=useState<Day[]>([])
 const [vouchers,setVouchers]=useState<Record<string,string>>({})
 const [editable,setEditable]=useState(false)
 const [voucherEdit,setVoucherEdit]=useState(false)
 const [busy,setBusy]=useState(false)
 const [loading,setLoading]=useState(true)
 const [error,setError]=useState('')
 const [success,setSuccess]=useState('')
 const [pendingImport,setPendingImport]=useState<{rows:Day[];warnings:string[];format:string}|null>(null)
 const [importName,setImportName]=useState('')
 const [confirmReplace,setConfirmReplace]=useState(false)
 const fileRef=useRef<HTMLInputElement|null>(null)
 const [dirty,setDirty]=useState(false)
 const [voucherDirty,setVoucherDirty]=useState(false)
 const [userAllowed,setUserAllowed]=useState<boolean|null>(null)
 const outletNames=useMemo(()=>outlets.map(o=>({id:o.id,name:o.outlet_name,label:ALIASES[o.outlet_name]||o.outlet_name})),[outlets])
 const labelToId=useMemo(()=>new Map(outletNames.flatMap(o=>[[normalized(o.label),o.id],[normalized(o.name),o.id]])),[outletNames])
 const outletLabel=(id:string)=>outletNames.find(o=>o.id===id)?.label||id
 const load=useCallback(async()=>{
  setLoading(true);setError('')
  const {data:userRes,error:userError}=await supabase.auth.getUser()
  if(userError||!userRes.user){setError('Sesi login berakhir.');setUserAllowed(false);setLoading(false);return}
  const {data:profile,error:profileError}=await supabase.from('profiles').select('role,is_active').eq('id',userRes.user.id).single()
  if(profileError||profile?.role!=='AM'||!profile.is_active){setError('Hanya Area Manager aktif yang dapat mengakses Schedule Visit AM.');setUserAllowed(false);setLoading(false);return}
  setUserAllowed(true)
  const [r,v]=await Promise.all([
   supabase.from('am_visit_schedule').select('*').eq('visit_year',year).eq('visit_month',month).order('visit_date'),
   supabase.from('am_visit_vouchers').select('outlet_id,code').eq('visit_year',year).eq('visit_month',month),
  ])
  if(r.error||v.error)setError('Gagal memuat Schedule Visit AM: '+errText(r.error||v.error))
  else{
   const byDate=new Map((r.data||[]).map(x=>[String(x.visit_date),x]))
   setRows(monthDates.map(date=>{
    const x=byDate.get(date);if(!x)return initial(date)
    return {date,shift:x.shift||'',visit1:x.visit_1_outlet_id||'',activity1:x.visit_1_activity||'',visit2:x.visit_2_outlet_id||'',activity2:x.visit_2_activity||'',online:x.online_outlet_id||'',onlineActivity:x.online_activity||'',km:x.distance_km===null?null:Number(x.distance_km),notes:x.notes||''}
   }))
   setVouchers(Object.fromEntries((v.data||[]).map(x=>[x.outlet_id,x.code||''])))
   setDirty(false);setVoucherDirty(false);setEditable(false);setVoucherEdit(false)
  }
  setLoading(false)
 },[year,month,monthDates])
 useEffect(()=>{void load()},[load])
 const update=(date:string,key:keyof Day,value:string)=>{
  setRows(prev=>prev.map(r=>r.date===date?{...r,[key]:key==='km'?(value.trim()===''?null:Number(value)):value}:r))
  setDirty(true);setSuccess('')
 }
 const validate=(list:Day[]):string|null=>{
  const validIds=new Set(outlets.map(o=>o.id))
  for(const row of list){
   if(!SHIFTS.includes(row.shift))return `Kode shift tidak valid pada ${row.date}.`
   for(const key of ['visit1','visit2','online'] as const)if(row[key]&&!validIds.has(row[key]))return `Outlet ${key} tidak dikenali pada ${row.date}.`
   for(const key of ['activity1','activity2','onlineActivity'] as const)if(row[key].length>100||/[\x00-\x1f\x7f]/.test(row[key]))return `To Do ${key} tidak valid atau lebih dari 100 karakter pada ${row.date}.`
   if(row.visit1&&row.visit2&&row.visit1===row.visit2)return `Visit 1 dan Visit 2 harus berbeda pada ${row.date}.`
   if(!row.visit1&&row.activity1 || !row.visit2&&row.activity2 || !row.online&&row.onlineActivity)return `Agenda terisi tanpa outlet pada ${row.date}.`
   if(row.km!==null&&(!Number.isFinite(row.km)||row.km<0||row.km>9999))return `KM tidak valid pada ${row.date}.`
   if(row.notes.length>1200)return `Catatan terlalu panjang pada ${row.date}.`
  }
  return null
 }
 const save=async()=>{
  const check=validate(rows);if(check){setError(check);return}
  if(!window.confirm(`Simpan jadwal visit ${MONTHS[month-1]} ${year}? Setelah disimpan tabel akan dikunci.`))return
  setBusy(true);setError('');setSuccess('')
  const payload=rows.map(r=>({date:r.date,shift:r.shift,visit1:r.visit1||null,activity1:r.activity1||null,visit2:r.visit2||null,activity2:r.activity2||null,online:r.online||null,onlineActivity:r.onlineActivity||null,km:r.km,notes:r.notes}))
  const {error:saveError}=await supabase.rpc('am_visit_schedule_save',{p_year:year,p_month:month,p_rows:payload})
  if(saveError)setError('Gagal menyimpan jadwal: '+errText(saveError))
  else {setDirty(false);setEditable(false);setPendingImport(null);setSuccess('Jadwal visit berhasil disimpan dan dikunci.');await load()}
  setBusy(false)
 }
 const saveVouchers=async()=>{
  setBusy(true);setError('');setSuccess('')
  const payload=outlets.map(o=>({outlet_id:o.id,code:(vouchers[o.id]||'').trim()}))
  const {error:saveError}=await supabase.rpc('am_visit_vouchers_save',{p_year:year,p_month:month,p_rows:payload})
  if(saveError)setError('Gagal menyimpan voucher: '+errText(saveError))
  else {setVoucherEdit(false);setVoucherDirty(false);setSuccess('Kode voucher test food berhasil disimpan.');await load()}
  setBusy(false)
 }
 const importExcel=async(file?:File)=>{
  if(!file)return
  setBusy(true);setError('');setSuccess('');setPendingImport(null)
  try{
   const result=await readVisitExcel(file,year,month)
   const converted=result.rows.map(r=>{
    const readOutlet=(v:string,date:string)=>{
     if(!v)return ''
     const id=labelToId.get(normalized(v));if(!id)throw Error(`Outlet "${v}" tidak dikenal pada ${date}. Gunakan nama outlet Area Bandung 2.`)
     return id
    }
    return {...r,visit1:readOutlet(r.visit1,r.date),visit2:readOutlet(r.visit2,r.date),online:readOutlet(r.online,r.date)}
   })
   const merged=new Map(rows.map(r=>[r.date,r]));converted.forEach(r=>merged.set(r.date,r))
   const draft=monthDates.map(d=>merged.get(d)||initial(d))
   const check=validate(draft);if(check)throw Error(check)
   setPendingImport({rows:draft,warnings:result.warnings,format:result.format});setImportName(file.name);setConfirmReplace(false)
  }catch(e){setError('Gagal membaca Excel: '+errText(e))}
  finally{setBusy(false)}
 }
 const applyPreview=()=>{
  if(!pendingImport||!confirmReplace)return
  setRows(pendingImport.rows);setEditable(true);setDirty(true);setPendingImport(null);setSuccess('Preview Excel diterapkan ke editor. Periksa jadwal, lengkapi agenda, lalu klik Simpan Jadwal untuk menyimpan ke Supabase.')
 }
 const exportExcel=()=>{
  const header:ExcelCell[]=['Hari','Tanggal','Shift','Visit 1','To Do','Visit 2','To Do','Visit Online','KM']
  const matrix:ExcelCell[][]=[header,...rows.map(r=>[weekday(r.date),r.date,r.shift,outletLabel(r.visit1)||'',r.activity1,outletLabel(r.visit2)||'',r.activity2,outletLabel(r.online)||'',r.km])]
  downloadXlsx(`KABOBS_Schedule_Visit_AM_${year}_${String(month).padStart(2,'0')}.xlsx`,[{name:'Schedule Visit AM',rows:matrix}])
 }
 const stats=useMemo(()=>{
  const visitCounts=outlets.map(o=>({id:o.id,label:ALIASES[o.outlet_name]||o.outlet_name,offline:rows.filter(r=>r.visit1===o.id||r.visit2===o.id).reduce((n,r)=>n+Number(r.visit1===o.id)+Number(r.visit2===o.id),0),online:rows.filter(r=>r.online===o.id).length}))
  const shiftCounts=SHIFTS.filter(Boolean).map(code=>({code,n:rows.filter(r=>r.shift===code).length}))
  const offline=visitCounts.reduce((n,o)=>n+o.offline,0),online=visitCounts.reduce((n,o)=>n+o.online,0)
  return {visitCounts,shiftCounts,offline,online,days:rows.filter(r=>r.visit1||r.visit2||r.online).length,km:rows.reduce((n,r)=>n+(r.km||0),0),activity:[...ACTIVITIES.filter(Boolean),'Lainnya'].map(code=>({code,n:rows.reduce((n,r)=>n+Number(code==='Lainnya'?isOtherActivity(r.activity1):r.activity1===code)+Number(code==='Lainnya'?isOtherActivity(r.activity2):r.activity2===code),0)}))}
 },[rows,outlets])
 const selectOutlet=(r:Day,field:'visit1'|'visit2'|'online')=><select aria-label={`${field} ${r.date}`} value={r[field]} onChange={e=>update(r.date,field,e.target.value)}><option value="">— Tidak ada —</option>{outletNames.map(o=><option key={o.id} value={o.id}>{o.label}</option>)}</select>
 const selectActivity=(r:Day,field:'activity1'|'activity2'|'onlineActivity')=>{
  const enabled=Boolean(r[field==='activity1'?'visit1':field==='activity2'?'visit2':'online'])
  const other=isOtherActivity(r[field])
  return <div className="sv-activity-edit">
    <select aria-label={`${field} ${r.date}`} value={other?'OTHER':r[field]} onChange={e=>update(r.date,field,e.target.value==='OTHER'?'Lainnya':e.target.value)} disabled={!enabled}>
      <option value="">—</option>{ACTIVITIES.filter(Boolean).map(a=><option key={a} value={a}>{a}</option>)}<option value="OTHER">Lainnya</option>
    </select>
    {other&&enabled&&<input type="text" className="sv-other-input" aria-label={`Isi To Do lainnya ${field} ${r.date}`} maxLength={100} value={r[field]==='Lainnya'?'':r[field]} onChange={e=>update(r.date,field,e.target.value||'Lainnya')} placeholder="Tulis kegiatan…" />}
  </div>
 }
 if(userAllowed===false)return <section className="panel"><p className="sales-alert error">Akses ditolak. Modul ini khusus Area Manager.</p></section>
 return <section className="sv-am">
  <header className="sv-head"><div><h2>Schedule Visit AM</h2><p>Agenda visit Area Manager · Periode 1–{monthDates.length} {MONTHS[month-1]} {year}</p></div><div className="sv-toolbar"><button disabled={busy||loading} onClick={()=>void load()}>↻ Refresh</button><button disabled={loading||busy} onClick={exportExcel}>↓ Download Excel</button><button disabled={loading||busy} onClick={()=>fileRef.current?.click()}>↑ Upload Excel</button><input ref={fileRef} type="file" accept=".xlsx" hidden onChange={e=>{void importExcel(e.target.files?.[0]);e.currentTarget.value=''}}/>{!editable?<button className="sv-primary" disabled={loading||busy} onClick={()=>{setEditable(true);setSuccess('');setError('')}}>✎ Edit Jadwal</button>:<><button disabled={busy} onClick={()=>{if(dirty&&!window.confirm('Batalkan perubahan yang belum disimpan?'))return;void load()}}>Batal Edit</button><button className="sv-primary" disabled={busy} onClick={()=>void save()}>{busy?'Menyimpan…':'✓ Simpan Jadwal'}</button></>}</div></header>
  {error&&<div role="alert" className="sv-alert sv-error">{error}</div>}{success&&<div role="status" className="sv-alert sv-success">{success}</div>}
  {pendingImport&&<div className="sv-import"><strong>Preview Excel: {importName}</strong><p>Format: {pendingImport.format}. Data untuk {pendingImport.rows.length} hari. Upload belum disimpan ke database.</p>{pendingImport.warnings.map((w,i)=><p className="sv-warn" key={i}>⚠ {w}</p>)}<label><input type="checkbox" checked={confirmReplace} onChange={e=>setConfirmReplace(e.target.checked)}/> Saya setuju mengganti data jadwal bulan ini di editor. Data database tidak berubah sampai saya klik Simpan Jadwal.</label><div className="sv-toolbar"><button className="sv-primary" disabled={!confirmReplace} onClick={applyPreview}>Terapkan ke Editor</button><button onClick={()=>setPendingImport(null)}>Batal</button></div></div>}
  <div className="sv-kpis"><article><small>Visit Offline</small><strong>{stats.offline}</strong></article><article><small>Visit Online</small><strong>{stats.online}</strong></article><article><small>Hari Ada Visit</small><strong>{stats.days}</strong></article><article><small>Total Jarak</small><strong>{safeNum(stats.km)} <span>KM</span></strong></article></div>

  <div className="sv-body"><div className="sv-table-panel"><div className="sv-panel-head"><strong>Jadwal Harian</strong><span>{editable?'Mode Edit · perubahan belum disimpan otomatis':'Terkunci · klik Edit Jadwal untuk revisi'}</span></div><div className="sv-scroll"><table className="sv-table"><thead><tr><th>Hari</th><th>Tanggal</th><th>Shift</th><th>Visit 1</th><th>To Do</th><th>Visit 2</th><th>To Do</th><th>Visit Online</th><th>KM</th></tr></thead><tbody>{loading?<tr><td colSpan={9}>Memuat jadwal…</td></tr>:rows.map(r=><tr key={r.date} className={['OFF','GHK','PH','CUTI','SAKIT'].includes(r.shift)?'sv-off':''}><td className={"sv-day"+(new Date(r.date+"T12:00:00").getDay()%6===0?" sv-weekend":"")}>{weekday(r.date)}</td><td className={"sv-date"+(new Date(r.date+"T12:00:00").getDay()%6===0?" sv-weekend":"")}>{fullDate(r.date)}</td><td>{editable?<select aria-label={`Shift ${r.date}`} value={r.shift} onChange={e=>update(r.date,'shift',e.target.value)}><option value="">—</option>{SHIFTS.filter(Boolean).map(s=><option key={s}>{s}</option>)}</select>:<span className={'sv-shift '+(r.shift==='OFF'?'sv-offshift':'')}>{r.shift||'—'}</span>}</td><td>{editable?selectOutlet(r,'visit1'):outletLabel(r.visit1)||'—'}</td><td>{editable?selectActivity(r,'activity1'):r.activity1||'—'}</td><td>{editable?selectOutlet(r,'visit2'):outletLabel(r.visit2)||'—'}</td><td>{editable?selectActivity(r,'activity2'):r.activity2||'—'}</td><td>{editable?selectOutlet(r,'online'):outletLabel(r.online)||'—'}</td><td>{editable?<input className="sv-km" aria-label={`KM ${r.date}`} type="number" step="0.1" min="0" max="9999" value={r.km??''} onChange={e=>update(r.date,'km',e.target.value)}/>:safeNum(r.km)}</td></tr>)}</tbody></table></div></div>
</div>
  <section className="sv-vouchers"><div className="sv-panel-head"><div><strong>Kode Voucher Test Food</strong><p>Kode tersimpan per outlet dan per bulan; tidak ikut import/export Excel.</p></div>{!voucherEdit?<button disabled={loading||busy} onClick={()=>setVoucherEdit(true)}>✎ Edit Voucher</button>:<div className="sv-toolbar"><button disabled={busy} onClick={()=>{if(voucherDirty&&!window.confirm('Batalkan perubahan voucher?'))return;void load()}}>Batal</button><button className="sv-primary" disabled={busy} onClick={()=>void saveVouchers()}>Simpan Voucher</button></div>}</div><div className="sv-voucher-grid">{outletNames.map(o=><label key={o.id}><span>{o.label}</span>{voucherEdit?<input maxLength={30} value={vouchers[o.id]||''} onChange={e=>{setVouchers(p=>({...p,[o.id]:e.target.value.toUpperCase()}));setVoucherDirty(true)}} placeholder="Kode voucher"/>:<strong>{vouchers[o.id]||'Belum diisi'}</strong>}</label>)}</div></section>
   <div className="sv-sidebar"><section className="sv-side-card"><h3>Rekap Visit Outlet</h3><table><thead><tr><th>Outlet</th><th>Offline</th><th>Online</th></tr></thead><tbody>{stats.visitCounts.map(o=><tr key={o.id}><td>{o.label}</td><td>{o.offline}</td><td>{o.online}</td></tr>)}</tbody></table></section><section className="sv-side-card"><h3>Rekap Kode Shift</h3><div className="sv-shift-grid">{stats.shiftCounts.map(x=><div key={x.code}><span>{x.code}</span><strong>{x.n}</strong></div>)}</div></section><section className="sv-side-card"><h3>Rekap Aktivitas</h3><div className="sv-shift-grid">{stats.activity.map(x=><div key={x.code}><span>{x.code}</span><strong>{x.n}</strong></div>)}</div></section></div>
  <p className="sv-footnote">Rekap offline menghitung Visit 1 dan Visit 2 secara terpisah. Tanggal 1 hingga akhir bulan kalender. Perubahan dan voucher disimpan ke Supabase khusus akses AM.</p>
 </section>
}
