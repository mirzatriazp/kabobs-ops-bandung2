import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { downloadXlsx, type ExcelCell, type ExcelSheet } from '../lib/exportXlsx'
import { readScheduleExcel, type ScheduleImport } from '../lib/schedule_excel_import'
import './Schedule.css'

type Outlet = { id: string; outlet_code: string; outlet_name: string }
type Props = { role: 'AM' | 'LEADER'; outletId: string; outlets: Outlet[]; month: number; year: number }
type Status = 'draft' | 'pending_review' | 'revision_requested' | 'approved'
type Period = { id: string; outlet_id: string; period_year: number; period_month: number; status: Status; leader_notes: string; am_notes: string; submitted_at: string | null; updated_at: string }
type Entry = { id: string; period_id: string; outlet_id: string; crew_nik: string; crew_name: string; work_codes: Record<string, string>; display_order: number }
type Member = { id: string; outlet_id: string; nik: string; full_name: string; employment_status: string }
type Row = { key: string; nik: string; name: string; codes: Record<string, string> }
const MONTHS = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember']
const CODES = ['O8','O9','M10','M11','M12','M13','C14','C15','OFF','GHK','CUTI TAHUNAN','CUTI SPESIAL','IZIN'] as const
const STATUSES: Record<Status, string> = { draft: 'Draft Leader', pending_review: 'Menunggu approval AM', revision_requested: 'Perlu revisi', approved: 'Approved AM' }
const pad = (v: number) => String(v).padStart(2,'0')
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`
const cycleDates = (year: number, month: number) => {
  const dates: { iso: string; day: number; short: string; dow: string; isWeekend: boolean }[] = []
  const cursor = new Date(year, month - 2, 26, 12)
  const end = new Date(year, month - 1, 25, 12)
  while (cursor <= end) {
    dates.push({iso: iso(cursor),day: cursor.getDate(),short: MONTHS[cursor.getMonth()].slice(0,3),dow: ['Min','Sen','Sel','Rab','Kam','Jum','Sab'][cursor.getDay()],isWeekend: [0,6].includes(cursor.getDay())})
    cursor.setDate(cursor.getDate()+1)
  }
  return dates
}
const uid = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`
const summary = (r: Row) => {
  const vals = Object.values(r.codes)
  const count = (arr: string[]) => vals.filter(c => arr.includes(c)).length
  const opening = count(['O8','O9']), middle = count(['M10','M11','M12','M13']), closing = count(['C14','C15'])
  return { opening,middle,closing,off:count(['OFF','GHK','IZIN']),ghk:count(['GHK']),annual:count(['CUTI TAHUNAN']),special:count(['CUTI SPESIAL']),work:opening+middle+closing,filled:vals.length }
}
const group = (v: string) => v.startsWith('O') && v !== 'OFF' ? 'opening' : v.startsWith('M') ? 'middle' : v.startsWith('C') && v !== 'CUTI TAHUNAN' && v !== 'CUTI SPESIAL' ? 'closing' : v === 'OFF' || v === 'GHK' || v === 'IZIN' ? 'off' : v ? 'leave' : ''

export default function Schedule({role,outletId,outlets,month,year}: Props) {
 const [selectedOutlet,setSelectedOutlet] = useState('')
 const activeOutlet = role === 'LEADER' ? outletId : selectedOutlet || outletId || ''
 const dates = useMemo(() => cycleDates(year,month),[year,month])
 const [periods,setPeriods] = useState<Period[]>([])
 const [entries,setEntries] = useState<Entry[]>([])
 const [members,setMembers] = useState<Member[]>([])
 const [rows,setRows] = useState<Row[]>([])
 const [leaderNotes,setLeaderNotes] = useState('')
 const [amNotes,setAmNotes] = useState('')
 const [unlockReason,setUnlockReason] = useState('')
 const [loading,setLoading] = useState(false)
 const [busy,setBusy] = useState(false)
 const [error,setError] = useState('')
 const [success,setSuccess] = useState('')
 const [crewPick,setCrewPick] = useState('')
 const [manual,setManual] = useState(false)
 const [manualName,setManualName] = useState('')
 const [manualNik,setManualNik] = useState('')
 const [dirty,setDirty] = useState(false)
  const [importPreview,setImportPreview] = useState<ScheduleImport|null>(null)
  const [importFileName,setImportFileName] = useState('')
  const [importReading,setImportReading] = useState(false)
  const [confirmReplace,setConfirmReplace] = useState(false)
 const nameMap=useMemo(()=>new Map(outlets.map(o=>[o.id,o.outlet_name])),[outlets])
 const load=useCallback(async()=>{
   setLoading(true);setError('')
   const [p,m]=await Promise.all([
     supabase.from('ops_schedule_periods').select('*').eq('period_year',year).eq('period_month',month).limit(100),
     supabase.from('ops_team_members').select('id,outlet_id,nik,full_name,employment_status').eq('employment_status','Aktif').limit(1000)
   ])
   const ids=(p.data||[]).map(x=>x.id)
   const e=ids.length ? await supabase.from('ops_schedule_entries').select('*').in('period_id',ids).order('display_order').limit(1000) : { data: [] as Entry[], error: null }
   if(p.error||e.error||m.error) setError(`Gagal memuat Schedule: ${p.error?.message||e.error?.message||m.error?.message}`)
   else {setPeriods((p.data||[]) as Period[]);setEntries((e.data||[]) as Entry[]);setMembers((m.data||[]) as Member[])}
   setLoading(false)
 },[year,month])
 useEffect(()=>{void load()},[load])
 const period = periods.find(p=>p.outlet_id===activeOutlet)
 const periodEntries=useMemo(()=>entries.filter(e=>e.period_id===period?.id).sort((a,b)=>a.display_order-b.display_order),[entries,period])
 useEffect(()=>{
   setRows(periodEntries.map(e=>({key:e.id,nik:e.crew_nik,name:e.crew_name,codes:e.work_codes||{}})))
   setLeaderNotes(period?.leader_notes||'');setAmNotes(period?.am_notes||'');setUnlockReason('');setDirty(false);setSuccess('');setCrewPick('');setManual(false)
 },[period?.id,period?.updated_at,periodEntries])
 const canEdit=Boolean(activeOutlet)&&(!period||['draft','revision_requested'].includes(period.status))
 const available=members.filter(m=>m.outlet_id===activeOutlet&&!rows.some(r=>r.nik===m.nik))
 const selectedName=nameMap.get(activeOutlet)||'Pilih outlet'
 // Jangan membawa preview lama ke outlet atau periode yang berbeda.
 useEffect(()=>{
   setImportPreview(null)
   setImportFileName('')
   setConfirmReplace(false)
 },[activeOutlet,year,month])

 const pickImportFile=async(file:File|undefined)=>{
   setError('');setSuccess('');setImportPreview(null);setImportFileName('');setConfirmReplace(false)
   if(!file)return
   if(role!=='AM'||!activeOutlet){setError('Pilih outlet terlebih dahulu.');return}
   if(period&&['approved','pending_review'].includes(period.status)){
     setError('Jadwal masih terkunci dan tidak dapat diimpor.');return
   }
   setImportReading(true)
   try{
     const parsed=await readScheduleExcel(file,dates.map(d=>d.iso))
     setImportPreview(parsed)
     setImportFileName(file.name)
   }catch(e){
     setError(e instanceof Error?`Gagal membaca Excel: ${e.message}`:'Gagal membaca Excel.')
   }finally{setImportReading(false)}
 }

 const applyImport=async()=>{
   if(role!=='AM'||!activeOutlet||!importPreview||busy||importReading||loading)return
   if(period&&['approved','pending_review'].includes(period.status)){
     setError('Jadwal sedang terkunci sehingga tidak boleh ditimpa.');return
   }
   const hasExisting=Boolean(period&&entries.some(e=>e.period_id===period.id))
   if(hasExisting&&!confirmReplace){setError('Centang konfirmasi penggantian jadwal terlebih dahulu.');return}
   if(!window.confirm(`Simpan ${importPreview.rows.length} crew dari Excel ke ${selectedName} untuk periode ${MONTHS[month-1]} ${year}?${hasExisting?' Jadwal draft lama akan diganti.':''}`))return
   setBusy(true);setError('');setSuccess('')
   try{
     const {error:importError}=await supabase.rpc('schedule_am_import',{
       p_outlet:activeOutlet,p_year:year,p_month:month,
       p_rows:importPreview.rows.map(r=>({name:r.name,nik:r.nik,codes:r.codes})),
       p_replace_existing:hasExisting&&confirmReplace
     })
     if(importError)throw importError
     setImportPreview(null);setImportFileName('');setConfirmReplace(false)
     await load()
     setSuccess('Jadwal dari Excel berhasil disimpan sebagai draft. Silakan periksa tabel dan edit manual jika diperlukan.')
   }catch(e){
     setError(`Gagal menyimpan Excel: ${e instanceof Error?e.message:String(e)}`)
   }finally{setBusy(false)}
 }
 const addRow=(name:string,nik:string)=>{
   const n=name.trim(),k=nik.trim()
   if(!n||n.length<2||!k||k.length<2){setError('Nama dan NIK minimal 2 karakter.');return}
   if(rows.some(r=>r.nik.toLowerCase()===k.toLowerCase())){setError('NIK tersebut sudah ada dalam jadwal.');return}
   setRows(old=>[...old,{key:uid(),name:n,nik:k,codes:{}}]);setDirty(true);setError('');setCrewPick('');setManual(false);setManualName('');setManualNik('')
 }
 const setCode=(key:string,date:string,code:string)=>{setRows(old=>old.map(r=>r.key!==key?r:(()=>{const codes={...r.codes};if(code)codes[date]=code;else delete codes[date];return {...r,codes}})()));setDirty(true);setSuccess('')}
 const save=async()=>{
   if(!canEdit||busy)return
   setBusy(true);setError('');setSuccess('')
   const {error:err}=role==='AM'
      ? await supabase.rpc('schedule_am_import',{p_outlet:activeOutlet,p_year:year,p_month:month,p_rows:rows.map(r=>({name:r.name,nik:r.nik,codes:r.codes})),p_replace_existing:true})
      : await supabase.rpc('schedule_save_draft',{p_outlet:activeOutlet,p_year:year,p_month:month,p_rows:rows.map(r=>({name:r.name,nik:r.nik,codes:r.codes})),p_notes:leaderNotes})
   if(err)setError(`Gagal simpan: ${err.message}`)
   else {setSuccess('Draft tersimpan. Jadwal belum dikirim ke AM.');setDirty(false);await load()}
   setBusy(false)
 }
 const submit=async()=>{
   if(!canEdit||busy)return
   if(dirty){setError('Ada perubahan belum tersimpan. Klik Simpan Draft terlebih dahulu.');return}
   if(!period){setError('Simpan Draft terlebih dahulu.');return}
   if(!window.confirm('Ajukan jadwal ini ke Area Manager? Jadwal terkunci sampai AM meminta revisi.'))return
   setBusy(true);setError('');setSuccess('')
   const {error:err}=await supabase.rpc('schedule_submit',{p_period:period.id})
   if(err)setError(err.message);else {setSuccess('Jadwal dikirim ke AM untuk approval.');await load()}
   setBusy(false)
 }
 const review=async(decision:'approved'|'revision_requested')=>{
   if(role!=='AM'||!period||period.status!=='pending_review'||busy)return
   if(decision==='revision_requested'&&!amNotes.trim()){setError('Isi alasan revisi terlebih dahulu.');return}
   if(!window.confirm(decision==='approved'?'Setujui jadwal ini sebagai jadwal resmi?':'Kirim permintaan revisi ke Leader?'))return
   setBusy(true);setError('');setSuccess('')
   const {error:err}=await supabase.rpc('schedule_review',{p_period:period.id,p_decision:decision,p_notes:amNotes})
   if(err)setError(err.message);else{setSuccess(decision==='approved'?'Jadwal disetujui.':'Permintaan revisi dikirim.');await load()}
   setBusy(false)
 }
 const unlockApproved=async()=>{
   if(role!=='AM'||!period||period.status!=='approved'||busy)return
   if(unlockReason.trim().length<3){setError('Isi alasan pembukaan edit minimal 3 karakter.');return}
   if(!window.confirm('Buka kembali jadwal yang SUDAH APPROVED? Status resmi akan dicabut, lalu Leader dapat mengedit dan mengajukan ulang.'))return
   setBusy(true);setError('');setSuccess('')
   const {error:err}=await supabase.rpc('schedule_unlock_approved',{p_period:period.id,p_notes:unlockReason.trim()})
   if(err)setError(`Gagal membuka edit: ${err.message}`)
   else{setSuccess('Akses edit dibuka. Leader dapat revisi dan mengajukan kembali untuk approval AM.');await load()}
   setBusy(false)
 }
 const exportExcel=()=>{
   if(role!=='AM'||loading||error)return
   const scope=activeOutlet?outlets.filter(o=>o.id===activeOutlet):outlets
   const approved=scope.map(o=>({outlet:o,period:periods.find(p=>p.outlet_id===o.id)})).filter((item):item is {outlet:Outlet;period:Period}=>item.period?.status==='approved')
   if(!approved.length){setError('Belum ada Schedule Approved AM pada outlet/periode yang dipilih.');return}
   const overview:(string|number|null)[][]=[['Outlet','Periode','Status','Jumlah Crew','Updated At']]
   const sheets:ExcelSheet[]=[]
   for(const item of approved){
     const list=entries.filter(e=>e.period_id===item.period.id).sort((a,b)=>a.display_order-b.display_order)
     overview.push([item.outlet.outlet_name,`${month}/${year}`,'Approved AM',list.length,item.period.updated_at])
     const header:ExcelCell[]=['Nama Crew','NIK',...dates.map(d=>d.iso),'Opening','Middle','Closing','Total Kerja','Jumlah OFF (termasuk GHK)','GHK','Cuti Tahunan','Cuti Spesial']
     const matrix:ExcelCell[][]=[header]
     for(const e of list){
       const row:Row={key:e.id,nik:e.crew_nik,name:e.crew_name,codes:e.work_codes||{}}
       const st=summary(row)
       matrix.push([row.name,row.nik,...dates.map(d=>row.codes[d.iso]||''),st.opening,st.middle,st.closing,st.work,st.off,st.ghk,st.annual,st.special])
     }
     sheets.push({name:item.outlet.outlet_name,rows:matrix})
   }
   downloadXlsx(`KABOBS_OPS_Schedule_Approved_${year}_${String(month).padStart(2,'0')}.xlsx`,[{name:'Rekap Approval',rows:overview},...sheets])
 }
 const today=iso(new Date())
 const onDuty=rows.filter(r=>{const c=r.codes[today];return c&&['O8','O9','M10','M11','M12','M13','C14','C15'].includes(c)})
 const isApproved=period?.status==='approved'
 return <section className="sch2">
    <div className="sch2-header"><div className="sch2-header-main"><h2>Schedule</h2><p>Perencanaan jadwal crew · Siklus tanggal 26–25 setiap bulan</p></div><div className="sch2-header-tools">{role==='AM'&&<button type="button" disabled={loading||busy} onClick={exportExcel}>↓ Download Excel (Approved)</button>}<span className="sch2-period">26 {MONTHS[(month+10)%12]} {month===1?year-1:year} – 25 {MONTHS[month-1]} {year}</span></div></div>
   {role==='AM'&&<div className="sch2-toolbar"><label>Pilih outlet <select value={activeOutlet} onChange={e=>setSelectedOutlet(e.target.value)}><option value="">Semua outlet — rekap approval</option>{outlets.map(o=><option key={o.id} value={o.id}>{o.outlet_name}</option>)}</select></label></div>}
    {role==='AM'&&activeOutlet&&<div className="sch2-import">
      <div className="sch2-import-top"><div><strong>Upload Excel Schedule</strong><p>Upload untuk outlet yang dipilih di atas. Nama file/sheet boleh berbeda, jumlah crew bebas. Gunakan format NAMA, NIK dan tanggal 26–25.</p></div><label className="sch2-upload-btn">↑ Pilih Excel (.xlsx)<input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={busy||importReading||loading||Boolean(period&&['approved','pending_review'].includes(period.status))} onChange={e=>{void pickImportFile(e.target.files?.[0]);e.target.value=''}} /></label></div>
      {period&&['approved','pending_review'].includes(period.status)&&<p className="sch2-alert">Periode ini {STATUSES[period.status]}. Import tidak boleh menimpa jadwal terkunci. Untuk Approved, gunakan proses Buka Akses Edit Leader terlebih dahulu.</p>}
      {importReading&&<p>Memeriksa format dan isi Excel...</p>}
      {importPreview&&<div className="sch2-import-preview"><strong>Preview: {importPreview.rows.length} crew · {importPreview.matchedDates} tanggal · {importFileName}</strong><p>Data diambil dari {importPreview.sheet}. Contoh: {importPreview.rows.slice(0,4).map(r=>`${r.name} (${r.nik})`).join(', ')}.</p>{importPreview.warnings.length>0&&<div className="sch2-import-warnings">{importPreview.warnings.map((w,i)=><div key={i}>⚠ {w}</div>)}</div>}{Boolean(period&&entries.some(e=>e.period_id===period.id))&&<label className="sch2-import-confirm"><input type="checkbox" checked={confirmReplace} onChange={e=>setConfirmReplace(e.target.checked)} /> Saya setuju mengganti isi jadwal draft outlet/periode ini dengan isi Excel.</label>}<div className="sch2-buttons"><button type="button" disabled={busy||Boolean(period&&entries.some(e=>e.period_id===period.id)&&!confirmReplace)} onClick={()=>void applyImport()}>{busy?'Menyimpan...':'Terapkan & Simpan ke Schedule'}</button><button type="button" disabled={busy} onClick={()=>setImportPreview(null)}>Batal</button></div></div>}
    </div>}
   {role==='AM'&&!activeOutlet&&<div className="sch2-overview"><h3>Status Schedule — {MONTHS[month-1]} {year}</h3><div className="sch2-tablewrap"><table className="sch2-table"><thead><tr><th>Outlet</th><th>Status</th><th>Jumlah crew</th><th>Update terakhir</th><th>Aksi</th></tr></thead><tbody>{outlets.map(o=>{const p=periods.find(x=>x.outlet_id===o.id);return <tr key={o.id}><td>{o.outlet_name}</td><td>{p?STATUSES[p.status]:'Belum dibuat'}</td><td>{entries.filter(e=>e.period_id===p?.id).length}</td><td>{p?.updated_at?new Date(p.updated_at).toLocaleString('id-ID'):'—'}</td><td><button type="button" onClick={()=>setSelectedOutlet(o.id)}>Lihat Jadwal</button></td></tr>})}</tbody></table></div></div>}
   {activeOutlet&&<>
    <div className="sch2-actions"><div><strong>{selectedName}</strong> <span className={`sch2-status ${period?.status||'draft'}`}>{period?STATUSES[period.status]:'Belum dibuat'}</span></div><button type="button" disabled={loading||busy||dirty} onClick={()=>void load()}>Refresh</button></div>
    {period?.status==='revision_requested'&&<div className="sch2-alert">AM meminta revisi: {period.am_notes||'Silakan perbaiki jadwal.'}</div>}
    {canEdit&&<div className="sch2-editor"><div className="sch2-editor-title"><strong>Tambah crew ke jadwal</strong><small>Nama/NIK diambil dari Data Team atau isi manual untuk crew baru, mutasi, atau bantuan sementara.</small></div><div className="sch2-add"><select value={crewPick} onChange={e=>{setCrewPick(e.target.value);setManual(false)}}><option value="">Pilih crew aktif dari Data Team</option>{available.map(m=><option value={m.id} key={m.id}>{m.full_name} — {m.nik}</option>)}</select><button type="button" disabled={!crewPick} onClick={()=>{const m=available.find(x=>x.id===crewPick);if(m)addRow(m.full_name,m.nik)}}>+ Tambah dari Data Team</button><button type="button" onClick={()=>setManual(x=>!x)}>{manual?'Batal manual':'+ Tambah manual'}</button></div>{manual&&<div className="sch2-add"><input placeholder="Nama crew" value={manualName} onChange={e=>setManualName(e.target.value)}/><input placeholder="NIK" value={manualNik} onChange={e=>setManualNik(e.target.value)}/><button type="button" onClick={()=>addRow(manualName,manualNik)}>Tambah crew</button></div>}</div>}
    <div className="sch2-legend"><span>Opening: O8, O9</span><span>Middle: M10–M13</span><span>Closing: C14, C15</span><span>Jumlah OFF: OFF + GHK + IZIN</span><span>Cuti terpisah</span></div>
    <div className="sch2-tablewrap"><table className="sch2-table sch2-matrix"><thead><tr><th className="sch2-sticky sch2-name">Nama Crew</th><th className="sch2-sticky sch2-nik">NIK</th>{dates.map(d=><th className={d.isWeekend?'sch2-weekend':''} key={d.iso}><small>{d.dow}</small>{d.day}<small>{d.short}</small></th>)}<th>Opening</th><th>Middle</th><th>Closing</th><th>Total kerja</th><th>Jumlah OFF</th><th>GHK</th><th>Cuti tahunan</th><th>Cuti spesial</th>{canEdit&&<th>Aksi</th>}</tr></thead><tbody>{!rows.length&&<tr><td className="sch2-empty" colSpan={dates.length+11}>{role==='LEADER'?'Tambahkan crew untuk mulai mengisi jadwal.':'Belum ada jadwal pada periode ini.'}</td></tr>}{rows.map(r=>{const s=summary(r);return <tr key={r.key}><td className="sch2-sticky sch2-name" title={r.name}>{r.name}</td><td className="sch2-sticky sch2-nik">{r.nik}</td>{dates.map(d=><td key={d.iso} className={`sch2-cell ${group(r.codes[d.iso]||'')} ${d.isWeekend?'sch2-weekend':''}`}>{canEdit?<select aria-label={`${r.name} ${d.iso}`} value={r.codes[d.iso]||''} onChange={e=>setCode(r.key,d.iso,e.target.value)}><option value="">—</option>{CODES.map(c=><option key={c} value={c}>{c}</option>)}</select>:<span title={d.iso}>{r.codes[d.iso]||'—'}</span>}</td>)}<td>{s.opening}</td><td>{s.middle}</td><td>{s.closing}</td><td><strong>{s.work}</strong></td><td><strong>{s.off}</strong></td><td>{s.ghk}</td><td>{s.annual}</td><td>{s.special}</td>{canEdit&&<td><button className="sch2-remove" type="button" onClick={()=>{if(window.confirm(`Hapus ${r.name} dari draft jadwal?`)){setRows(old=>old.filter(x=>x.key!==r.key));setDirty(true)}}}>Hapus</button></td>}</tr>})}</tbody></table></div>
    <p className="sch2-hint">Geser tabel ke kanan untuk melihat seluruh tanggal dan rekap. Sel kosong (—) tidak dihitung sebagai OFF. Perubahan baru tersimpan setelah klik <strong>Simpan Draft</strong>.</p>
    {role==='AM'&&canEdit&&<div className="sch2-footer"><strong>Edit manual AM</strong><p className="sch2-hint">Nama, NIK, dan shift dapat disesuaikan setelah import. Klik Simpan Perubahan jika sudah selesai.</p><div className="sch2-buttons"><button type="button" disabled={!dirty||busy} onClick={()=>void save()}>Simpan Perubahan</button></div></div>}
     {role==='LEADER'&&<div className="sch2-footer"><label>Catatan Leader<textarea rows={2} disabled={!canEdit} value={leaderNotes} onChange={e=>{setLeaderNotes(e.target.value);setDirty(true)}} placeholder="Catatan untuk AM (opsional)"/></label><div className="sch2-buttons"><button type="button" disabled={!canEdit||busy} onClick={()=>void save()}>Simpan Draft</button><button type="button" disabled={!canEdit||busy||!period||dirty} onClick={()=>void submit()}>Kirim ke AM</button></div>{dirty&&<small className="sch2-unsaved">Ada perubahan yang belum disimpan.</small>}</div>}
    {role==='AM'&&<div className="sch2-footer"><label>Catatan / keputusan AM<textarea rows={2} disabled={period?.status!=='pending_review'} value={amNotes} onChange={e=>setAmNotes(e.target.value)} placeholder="Catatan untuk Leader"/></label>{period?.status==='pending_review'&&<div className="sch2-buttons"><button type="button" disabled={busy} onClick={()=>void review('approved')}>Approve Jadwal</button><button className="sch2-reject" type="button" disabled={busy} onClick={()=>void review('revision_requested')}>Minta Revisi</button></div>}{period?.status==='approved'&&<div className="sch2-unlock"><p className="sch2-ok">Jadwal ini telah disetujui dan menjadi jadwal resmi.</p><label>Alasan buka akses edit<textarea rows={2} maxLength={1500} placeholder="Contoh: Ada tanggal shift yang belum terisi, mohon lengkapi lalu ajukan kembali." value={unlockReason} onChange={e=>setUnlockReason(e.target.value)} /></label><p className="sch2-hint">Membuka edit mencabut approval saat ini. Leader wajib mengajukan ulang jadwal untuk mendapat persetujuan baru.</p><button className="sch2-reject" type="button" disabled={busy||unlockReason.trim().length<3} onClick={()=>void unlockApproved()}>Buka Akses Edit Leader</button></div>}</div>}
    {isApproved&&<div className="sch2-today"><h3>Team In Charge Hari Ini — {new Date().toLocaleDateString('id-ID',{day:'numeric',month:'long',year:'numeric'})}</h3>{dates.some(d=>d.iso===today)?(onDuty.length?<div className="sch2-duty">{onDuty.map(r=><span key={r.key}>{r.name} <b>{r.codes[today]}</b></span>)}</div>:<p>Tidak ada crew terjadwal bekerja hari ini.</p>):<p>Hari ini berada di luar periode yang sedang dipilih.</p>}</div>}
   </>}
   {loading&&<p className="sch2-hint">Memuat jadwal...</p>}{error&&<p role="alert" className="sch2-alert">{error}</p>}{success&&<p className="sch2-ok">{success}</p>}
 </section>
}
