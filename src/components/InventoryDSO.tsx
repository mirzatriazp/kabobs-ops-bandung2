import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import './InventoryDSO.css'

type Outlet = { id: string; outlet_code: string; outlet_name: string }
type Props = { role: 'AM' | 'LEADER'; outletId: string; outlets: Outlet[]; month: number; year: number }
type DSO = { id: string; outlet_id: string; check_date: string; status: 'aman' | 'hitung_ulang'; issues: string; am_notes: string; reviewed_at: string }
type Variance = { id: string; outlet_id: string; period_year: number; period_month: number; unit: 'KG'|'PCS'; item_name: string; variance: number }
type Note = { id: string; outlet_id: string; period_year: number; period_month: number; unit: 'KG'|'PCS'; notes: string }
type History = { id: number; outlet_id: string; check_date: string; old_status: string | null; new_status: string; old_issues: string|null; new_issues: string; changed_at: string }
const MONTHS = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember']
const iso = (y:number,m:number,d:number) => `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`
const fmt = (v:number,unit:string) => `${v>0?'+':''}${new Intl.NumberFormat('id-ID',{maximumFractionDigits:3}).format(v)} ${unit}`
const outletName = (id:string,outlets:Outlet[]) => outlets.find(o=>o.id===id)?.outlet_name || 'Outlet'
const errorMessage = (err:unknown) => err instanceof Error ? err.message : String(err)
export default function InventoryDSO({role,outletId,outlets,month,year}:Props) {
 const am = role === 'AM'
 const [tab,setTab] = useState<'KG'|'PCS'>('KG')
 const [dso,setDso] = useState<DSO[]>([])
 const [variance,setVariance] = useState<Variance[]>([])
 const [notes,setNotes] = useState<Note[]>([])
 const [history,setHistory] = useState<History[]>([])
 const [loading,setLoading] = useState(false)
 const [saving,setSaving] = useState(false)
 const [message,setMessage] = useState('')
 const [day,setDay] = useState(1)
 const [openEditKey,setOpenEditKey] = useState<string|null>(null)
 const [editIssues,setEditIssues] = useState('')
 const [editNotes,setEditNotes] = useState('')
 const [invOutlet,setInvOutlet] = useState('')
 const [item,setItem] = useState('')
 const [amount,setAmount] = useState('')
 const [noteText,setNoteText] = useState('')
 const [editingItem,setEditingItem] = useState<string|null>(null)
 const dateCount = new Date(year,month,0).getDate()
 const firstDate=iso(year,month,1), lastDate=iso(year,month,dateCount)
 const visibleOutlets=useMemo(()=>outlets.filter(o=>am?(!outletId||o.id===outletId):o.id===outletId),[outlets,am,outletId])
 const load=useCallback(async()=>{
  setLoading(true);setMessage('')
  try {
   const [a,b,c,h]=await Promise.all([
    supabase.from('ops_dso_daily').select('id,outlet_id,check_date,status,issues,am_notes,reviewed_at').gte('check_date',firstDate).lte('check_date',lastDate).order('check_date'),
    supabase.from('ops_inventory_variances').select('id,outlet_id,period_year,period_month,unit,item_name,variance').eq('period_year',year).eq('period_month',month).order('item_name'),
    supabase.from('ops_inventory_notes').select('id,outlet_id,period_year,period_month,unit,notes').eq('period_year',year).eq('period_month',month),
    supabase.from('ops_dso_history').select('id,outlet_id,check_date,old_status,new_status,old_issues,new_issues,changed_at').gte('check_date',firstDate).lte('check_date',lastDate).order('changed_at',{ascending:false}).limit(100)
   ])
   for (const r of [a,b,c,h]) if(r.error) throw r.error
   setDso((a.data||[]) as DSO[]);setVariance((b.data||[]) as Variance[]);setNotes((c.data||[]) as Note[]);setHistory((h.data||[]) as History[])
  } catch(e){setMessage('Gagal memuat: '+errorMessage(e))} finally{setLoading(false)}
 },[firstDate,lastDate,year,month])
 useEffect(()=>{void load()},[load])
 useEffect(()=>{setDay(n=>Math.min(n,dateCount))},[dateCount])
 useEffect(()=>{setInvOutlet(visibleOutlets[0]?.id||'')},[visibleOutlets])
 useEffect(()=>{setOpenEditKey(null);setEditIssues('');setEditNotes('')},[year,month,outletId])
 const selectedDate=iso(year,month,day)
 const unit=tab
 const currentNote=notes.find(n=>n.outlet_id===invOutlet&&n.unit===unit)
 useEffect(()=>{setNoteText(currentNote?.notes||'')},[currentNote?.id,currentNote?.notes,invOutlet,unit])
 const reviewed=dso.filter(r=>visibleOutlets.some(o=>o.id===r.outlet_id))
 const aman=reviewed.filter(r=>r.status==='aman').length, pending=reviewed.filter(r=>r.status==='hitung_ulang').length
 const totalSlots=dateCount*visibleOutlets.length
 const dayRecords=dso.filter(r=>r.check_date===selectedDate)
 const showError=(e:unknown)=>setMessage(errorMessage(e))
 async function bulkAman(){
  if(!am||!visibleOutlets.length)return
  const missing=visibleOutlets.filter(o=>!dayRecords.some(r=>r.outlet_id===o.id))
  if(!missing.length){setMessage('Semua outlet untuk tanggal ini sudah diperiksa. Data temuan tidak ditimpa.');return}
  if(!window.confirm(`Tandai ${missing.length} outlet yang BELUM DIPERIKSA sebagai AMAN pada ${day} ${MONTHS[month-1]} ${year}? Data yang sudah ada tidak akan ditimpa.`))return
  setSaving(true);setMessage('')
  try {const {error}=await supabase.from('ops_dso_daily').insert(missing.map(o=>({outlet_id:o.id,check_date:selectedDate,status:'aman',issues:'',am_notes:''})));if(error)throw error; await load();setMessage(`${missing.length} outlet berhasil ditandai Aman.`)}catch(e){showError(e)}finally{setSaving(false)}
 }
 async function saveDsoCell(outlet:string,date:number,status:'aman'|'hitung_ulang',itemIssues='',amNotes=''){
  if(!am||!outlet)return
  const dateIso=iso(year,month,date)
  const existing=dso.find(r=>r.outlet_id===outlet&&r.check_date===dateIso)
  if(status==='hitung_ulang'&&itemIssues.trim().length<3){setMessage('Isi detail selisih minimal 3 karakter.');return}
  if(status==='aman'&&existing?.status==='hitung_ulang'&&!window.confirm('DSO sudah direvisi dan dinyatakan Aman? Riwayat temuan lama tetap tersimpan.'))return
  setSaving(true);setMessage('')
  try {
   const payload={outlet_id:outlet,check_date:dateIso,status,issues:status==='aman'?'':itemIssues.trim(),am_notes:status==='aman'?'':amNotes.trim()}
   const {error}=existing?await supabase.from('ops_dso_daily').update(payload).eq('id',existing.id):await supabase.from('ops_dso_daily').insert(payload)
   if(error)throw error
   setOpenEditKey(null);setEditIssues('');setEditNotes('')
   await load();setMessage(`Status ${outletName(outlet,outlets)} tanggal ${date} berhasil disimpan.`)
  }catch(e){showError(e)}finally{setSaving(false)}
 }
 function chooseStatus(outlet:string,date:number,value:string){
  const existing=dso.find(r=>r.outlet_id===outlet&&r.check_date===iso(year,month,date))
  if(value==='aman'){void saveDsoCell(outlet,date,'aman');return}
  if(value==='hitung_ulang'){
   setDay(date);setOpenEditKey(`${outlet}|${date}`)
   setEditIssues(existing?.issues||'');setEditNotes(existing?.am_notes||'');setMessage('')
  }
 }
 function editRevision(outlet:string,date:number){
  const existing=dso.find(r=>r.outlet_id===outlet&&r.check_date===iso(year,month,date))
  setOpenEditKey(`${outlet}|${date}`);setEditIssues(existing?.issues||'');setEditNotes(existing?.am_notes||'')
 }

 async function saveVariance(e:FormEvent){
  e.preventDefault();if(!am||!invOutlet)return
  const val=Number(amount.replace(',','.'))
  if(!item.trim()||!Number.isFinite(val)||val===0){setMessage('Isi item dan angka selisih bukan nol. Contoh: -8 atau -2,5.');return}
  setSaving(true);setMessage('')
  try{
   const payload={outlet_id:invOutlet,period_year:year,period_month:month,unit,item_name:item.trim(),variance:val}
   const q=editingItem?supabase.from('ops_inventory_variances').update({item_name:payload.item_name,variance:payload.variance}).eq('id',editingItem):supabase.from('ops_inventory_variances').insert(payload)
   const {error}=await q;if(error)throw error
   setItem('');setAmount('');setEditingItem(null);await load();setMessage('Selisih tersimpan.')
  }catch(e){showError(e)}finally{setSaving(false)}
 }
 async function removeVariance(r:Variance){if(!am||!window.confirm(`Hapus ${r.item_name} ${fmt(r.variance,r.unit)}?`))return;setSaving(true);try{const {error}=await supabase.from('ops_inventory_variances').delete().eq('id',r.id);if(error)throw error;await load()}catch(e){showError(e)}finally{setSaving(false)}}
 async function saveNotes(){if(!am||!invOutlet)return;setSaving(true);setMessage('');try{
  const payload={outlet_id:invOutlet,period_year:year,period_month:month,unit,notes:noteText.trim()}
  const {error}=await supabase.from('ops_inventory_notes').upsert(payload,{onConflict:'outlet_id,period_year,period_month,unit'});if(error)throw error;await load();setMessage('Catatan AM berhasil disimpan.')
 }catch(e){showError(e)}finally{setSaving(false)}}

 const currentMonthRows = (unitName: 'KG'|'PCS') => variance.filter(r => r.unit === unitName && visibleOutlets.some(o=>o.id===r.outlet_id))
 const periodLabel = `${MONTHS[month-1]} ${year}`
 const dsoFor = (oId: string, d: number) => dso.find(r=>r.outlet_id===oId && r.check_date===iso(year,month,d))
 function renderEvaluation(unitName: 'KG'|'PCS') {
  const rows = currentMonthRows(unitName)
  const outletGroups = visibleOutlets.map(o=>({outlet:o,items:rows.filter(r=>r.outlet_id===o.id),note:notes.find(n=>n.outlet_id===o.id&&n.unit===unitName)?.notes||''}))
  const countNegative=rows.filter(r=>r.variance<0).length
  return <section className="ids-evaluation" key={unitName}>
   <div className="ids-section-top"><div><h4>Evaluasi Selisih {unitName}</h4><p>{periodLabel} · {countNegative} item berselisih negatif{am&&rows.some(r=>r.variance>0)?` · ${rows.filter(r=>r.variance>0).length} positif (internal AM)`:''}</p></div><span className="ids-unit-pill">{unitName}</span></div>
   {am&&<p className="ids-section-hint">Kelola item & catatan melalui panel <b>Input Evaluasi</b> di bawah.</p>}
   {!rows.length && !outletGroups.some(g=>g.note.trim()) && <div className="ids-empty">Belum ada evaluasi selisih {unitName} untuk periode ini.</div>}
   {outletGroups.filter(g=>g.items.length||g.note.trim()).map(group=>{
    const max=Math.max(1,...group.items.map(r=>Math.abs(r.variance)))
    return <div className="ids-outlet-evaluation" key={group.outlet.id}>
      {(am&&visibleOutlets.length>1)&&<h5>{group.outlet.outlet_name}</h5>}
      {!!group.items.length&&<div className="ids-variance-view"><table className="ids-variance-table"><thead><tr><th>Item</th><th>Selisih</th><th>Visual besaran selisih</th>{am&&<th>Aksi</th>}</tr></thead><tbody>{group.items.map(r=><tr key={r.id}><td>{r.item_name}</td><td className={r.variance<0?'negative':'positive'}>{fmt(r.variance,unitName)}</td><td><div className="ids-bar-track" title={`Besarnya selisih ${r.item_name}: ${fmt(r.variance,unitName)}`}><div className={`ids-bar ${r.variance<0?'neg':'pos'}`} style={{width:`${Math.max(5,Math.abs(r.variance)/max*100)}%`}}/></div></td>{am&&<td><button type="button" onClick={()=>{setTab(unitName);setInvOutlet(r.outlet_id);setEditingItem(r.id);setItem(r.item_name);setAmount(String(r.variance));document.getElementById('ids-evaluation-editor')?.scrollIntoView({behavior:'smooth',block:'center'})}}>Edit</button> <button type="button" onClick={()=>void removeVariance(r)} disabled={saving}>Hapus</button></td>}</tr>)}</tbody></table></div>}
      {group.note.trim()&&<div className="ids-note-highlight"><span>Catatan / Tindak Lanjut AM</span><p>{group.note}</p></div>}
     </div>
   })}
  </section>
 }
 return <section className="ids-panel">
  <header className="ids-header"><div><h3>Inventory & DSO</h3><p>Monitoring DSO harian dan evaluasi inventory · {periodLabel}</p></div><button type="button" onClick={()=>void load()} disabled={loading}>↻ Refresh</button></header>
  {message&&<p role="status" className="ids-message">{message}</p>}
  <div className={am?'ids-primary-layout ids-primary-am':'ids-primary-layout ids-primary-leader'}>
   <section className="ids-block">
    <div className="ids-section-top"><div><h4>DSO Harian</h4><p>Status pengecekan stok tanggal 1–{dateCount} {MONTHS[month-1]}</p></div></div>
    <div className="ids-stats"><div><small>Sudah Aman</small><strong>{aman}</strong></div><div><small>Perlu Hitung Ulang</small><strong>{pending}</strong></div><div><small>Belum Diperiksa</small><strong>{Math.max(0,totalSlots-reviewed.length)}</strong></div></div>
    {am&&<div className="ids-bulk-toolbar"><label>Tanggal validasi massal<select value={day} onChange={e=>setDay(Number(e.target.value))}>{Array.from({length:dateCount},(_,i)=>i+1).map(d=><option value={d} key={d}>{d} {MONTHS[month-1]} {year}</option>)}</select></label><button type="button" disabled={saving||!visibleOutlets.length} onClick={()=>void bulkAman()}>✓ Semua Belum Diperiksa → Aman ({visibleOutlets.filter(o=>!dayRecords.some(r=>r.outlet_id===o.id)).length} outlet)</button><small>Untuk pengecualian, ubah dropdown di sel outlet dan tanggal menjadi Revisi.</small></div>}
    <div className="ids-scroll ids-dso-scroll"><table className="ids-matrix"><thead><tr><th>Tanggal</th>{visibleOutlets.map(o=><th key={o.id}>{o.outlet_name}</th>)}</tr></thead><tbody>{Array.from({length:dateCount},(_,i)=>i+1).map(d=><tr key={d} className={day===d?'ids-day-selected':''}><th><span className="ids-day-label">{d} {MONTHS[month-1].slice(0,3)}</span></th>{visibleOutlets.map(o=>{const r=dsoFor(o.id,d);const key=`${o.id}|${d}`;const isOpen=openEditKey===key;return <td key={o.id}>
      {am?<div className="ids-inline-status">
        <select aria-label={`Status DSO ${o.outlet_name} ${d} ${MONTHS[month-1]}`} className={`ids-status-select ${r?.status||'none'}`} value={r?.status||''} disabled={saving} onChange={e=>chooseStatus(o.id,d,e.target.value)}><option value="">Belum diperiksa</option><option value="aman">Aman</option><option value="hitung_ulang">Revisi</option></select>
        {r?.status==='hitung_ulang'&&!isOpen&&<button type="button" className="ids-edit-revision" disabled={saving} onClick={()=>editRevision(o.id,d)}>Edit temuan</button>}
        {isOpen&&<div className="ids-cell-editor"><strong>Temuan {d} {MONTHS[month-1]} — {o.outlet_name}</strong><label>Item dan selisih<textarea value={editIssues} onChange={e=>setEditIssues(e.target.value)} placeholder={'Contoh: Torbig -1\nKeju +2'} /></label><label>Arahan AM<textarea value={editNotes} onChange={e=>setEditNotes(e.target.value)} placeholder="Hitung ulang dan revisi DSO" /></label><div className="ids-cell-editor-buttons"><button type="button" disabled={saving||editIssues.trim().length<3} onClick={()=>void saveDsoCell(o.id,d,'hitung_ulang',editIssues,editNotes)}>Simpan Revisi</button><button type="button" onClick={()=>setOpenEditKey(null)}>Batal</button></div></div>}
      </div>:<><span className={`ids-status ${r?.status||'none'}`}>{r?.status==='aman'?'Aman':r?.status==='hitung_ulang'?'Hitung ulang':'Belum diperiksa'}</span>{r?.status==='hitung_ulang'&&<div className="ids-cell-issue">{r.issues}</div>}{!!r?.am_notes&&<div className="ids-cell-note">{r.am_notes}</div>}</>}
    </td>})}</tr>)}</tbody></table></div>
    <details className="ids-history"><summary>Riwayat perubahan DSO ({history.filter(h=>visibleOutlets.some(o=>o.id===h.outlet_id)).length})</summary><div className="ids-scroll"><table><thead><tr><th>Tanggal</th><th>Outlet</th><th>Perubahan</th><th>Temuan</th><th>Waktu update</th></tr></thead><tbody>{history.filter(h=>visibleOutlets.some(o=>o.id===h.outlet_id)).map(h=><tr key={h.id}><td>{h.check_date}</td><td>{outletName(h.outlet_id,outlets)}</td><td>{h.old_status||'Belum diperiksa'} → {h.new_status}</td><td>{h.new_issues||'—'}</td><td>{new Date(h.changed_at).toLocaleString('id-ID')}</td></tr>)}</tbody></table></div></details>
   </section>
   <div className="ids-evaluation-column"><div className="ids-health-header"><h4>Evaluasi Inventory · {periodLabel}</h4><p>Selisih KG dan PCS bulan berjalan.</p></div><div className="ids-eval-grid">{renderEvaluation('KG')}{renderEvaluation('PCS')}</div></div>
  </div>
  {am&&<div className="ids-editor" id="ids-evaluation-editor"><div className="ids-editor-head"><strong>Input Evaluasi Inventory</strong><div className="ids-unit-toggle"><button type="button" className={tab==='KG'?'selected':''} onClick={()=>{setTab('KG');setItem('');setAmount('');setEditingItem(null)}}>Selisih KG</button><button type="button" className={tab==='PCS'?'selected':''} onClick={()=>{setTab('PCS');setItem('');setAmount('');setEditingItem(null)}}>Selisih PCS</button></div></div>
   <form onSubmit={e=>void saveVariance(e)} className="ids-input-row"><label>Outlet<select value={invOutlet} onChange={e=>{setInvOutlet(e.target.value);setEditingItem(null);setItem('');setAmount('')}}>{visibleOutlets.map(o=><option key={o.id} value={o.id}>{o.outlet_name}</option>)}</select></label><label>Item<input value={item} onChange={e=>setItem(e.target.value)} required placeholder={unit==='KG'?'Contoh: Saus Cabe':'Contoh: Torbig'}/></label><label>Selisih ({unit})<input value={amount} onChange={e=>setAmount(e.target.value)} required placeholder="Contoh: -8" inputMode="decimal"/></label><button type="submit" disabled={saving}>{editingItem?'Simpan Edit':'Tambah Item'}</button>{editingItem&&<button type="button" onClick={()=>{setEditingItem(null);setItem('');setAmount('')}}>Batal</button>}</form>
   <label>Catatan / arahan AM — {outletName(invOutlet,outlets)} ({unit})<textarea placeholder="Contoh: Lakukan latihan kalibrasi, evaluasi penggunaan bahan dan cek takaran." value={noteText} onChange={e=>setNoteText(e.target.value)}/></label><button type="button" onClick={()=>void saveNotes()} disabled={saving||!invOutlet}>Simpan Catatan AM</button>
  </div>}
 </section>
}
