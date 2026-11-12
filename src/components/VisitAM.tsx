import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import './VisitAM.css'

type Outlet = { id: string; outlet_code: string; outlet_name: string }
type Props = { role: 'AM' | 'LEADER'; outletId: string; outlets: Outlet[]; month: number; year: number }
type Status = 'open'|'submitted'|'revision'|'done'
type Finding = {
  id:string; outlet_id:string; visit_date:string; category:string; priority:string;
  finding:string; due_date:string; finding_photo_path:string|null; corrective_action:string|null;
  correction_photo_path:string|null; correction_submitted_at:string|null; status:Status;
  am_notes:string|null; verified_at:string|null; created_at:string
}
const labels:Record<Status,string> = {open:'Menunggu Koreksi',submitted:'Menunggu Verifikasi AM',revision:'Perlu Revisi',done:'Done'}
const blank = {outlet_id:'',visit_date:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()),category:'Store Ambience',priority:'Medium',finding:'',due_date:'',am_notes:''}
const displayDate=(d:string)=>new Date(d+'T12:00:00').toLocaleDateString('id-ID',{day:'2-digit',month:'short',year:'numeric'})
const validateFile=(file:File|null)=>!file || (['image/jpeg','image/png','image/webp'].includes(file.type)&&file.size<=5*1024*1024)
const filename=(file:File)=>file.type==='image/png'?'png':file.type==='image/webp'?'webp':'jpg'

export default function VisitAM({role,outletId,outlets,month,year}:Props){
  const [rows,setRows]=useState<Finding[]>([])
  const [form,setForm]=useState(blank)
  const [photo,setPhoto]=useState<File|null>(null)
  const [correctiveFiles,setCorrectiveFiles]=useState<Record<string,File|null>>({})
  const [actions,setActions]=useState<Record<string,string>>({})
  const [reviews,setReviews]=useState<Record<string,{status:'done'|'revision';notes:string}>>({})
  const [imageLinks,setImageLinks]=useState<Record<string,string>>({})
  const [showForm,setShowForm]=useState(false)
  const [statusFilter,setStatusFilter]=useState('all')
  const [busy,setBusy]=useState(false)
  const [loading,setLoading]=useState(true)
  const [error,setError]=useState('')
  const [success,setSuccess]=useState('')

  const fetchRows=useCallback(async()=>{
    setLoading(true);setError('')
    let q=supabase.from('am_visit_findings').select('*').gte('visit_date',`${year}-${String(month).padStart(2,'0')}-01`).lte('visit_date',`${year}-${String(month).padStart(2,'0')}-${new Date(year,month,0).getDate()}`).order('visit_date',{ascending:false}).limit(300)
    if(outletId)q=q.eq('outlet_id',outletId)
    const {data,error:fetchError}=await q
    if(fetchError){setError('Gagal memuat Report Visit: '+fetchError.message);setRows([])}
    else {
      const list=(data||[]) as Finding[]
      setRows(list)
      setActions(Object.fromEntries(list.map(r=>[r.id,r.corrective_action||''])))
      setReviews(Object.fromEntries(list.map(r=>[r.id,{status:r.status==='revision'?'revision':'done',notes:r.am_notes||''}])))
      const entries=await Promise.all(list.flatMap(r=>[
        ...(r.finding_photo_path?[{key:r.id+':finding',path:r.finding_photo_path}]:[]),
        ...(r.correction_photo_path?[{key:r.id+':correction',path:r.correction_photo_path}]:[]),
      ]).map(async p=>{
        const {data:link}=await supabase.storage.from('am-visit-photos').createSignedUrl(p.path,3600)
        return [p.key,link?.signedUrl||''] as const
      }))
      setImageLinks(Object.fromEntries(entries))
    }
    setLoading(false)
  },[month,year,outletId])
  useEffect(()=>{void fetchRows()},[fetchRows])

  async function uploadFile(file:File,oid:string,uid:string){
    const path=`${oid}/${uid}/${crypto.randomUUID()}.${filename(file)}`
    const {error:uploadError}=await supabase.storage.from('am-visit-photos').upload(path,file,{upsert:false,contentType:file.type})
    if(uploadError)throw new Error('Upload foto gagal: '+uploadError.message)
    return path
  }
  async function createFinding(e:FormEvent){
    e.preventDefault();setError('');setSuccess('')
    if(role!=='AM')return
    const oid=outletId||form.outlet_id
    if(!oid){setError('Pilih outlet.');return}
    if(!validateFile(photo)){setError('Foto wajib JPG/PNG/WEBP maksimal 5 MB.');return}
    if(form.due_date<form.visit_date){setError('Due date tidak boleh sebelum tanggal visit.');return}
    setBusy(true)
    try{
      const {data:{user}}=await supabase.auth.getUser()
      if(!user)throw new Error('Silakan login kembali')
      const photoPath=photo?await uploadFile(photo,oid,user.id):null
      const {error:insertError}=await supabase.from('am_visit_findings').insert({
        outlet_id:oid,visit_date:form.visit_date,category:form.category,
        priority:form.priority,finding:form.finding.trim(),due_date:form.due_date,
        am_notes:form.am_notes.trim()||null,finding_photo_path:photoPath,created_by:user.id
      })
      if(insertError)throw insertError
      setShowForm(false);setPhoto(null);setForm(blank);setSuccess('Temuan AM berhasil dibuat.');await fetchRows()
    }catch(e){setError(e instanceof Error?e.message:'Gagal membuat temuan')}
    finally{setBusy(false)}
  }
  async function submitCorrection(r:Finding){
    setBusy(true);setError('');setSuccess('')
    try{
      if(role!=='LEADER')throw new Error('Hanya leader dapat mengirim koreksi')
      if((actions[r.id]||'').trim().length<5)throw new Error('Corrective action minimal 5 karakter')
      const file=correctiveFiles[r.id]
      if(file&&!validateFile(file))throw new Error('Foto wajib JPG/PNG/WEBP maksimal 5 MB')
      const {data:{user}}=await supabase.auth.getUser()
      if(!user)throw new Error('Sesi berakhir')
      const newPath=file?await uploadFile(file,r.outlet_id,user.id):r.correction_photo_path
      const {error:saveError}=await supabase.from('am_visit_findings').update({
        corrective_action:(actions[r.id]||'').trim(),correction_photo_path:newPath
      }).eq('id',r.id)
      if(saveError)throw saveError
      setSuccess('Corrective action dikirim ke AM untuk verifikasi.');await fetchRows()
    }catch(e){setError(e instanceof Error?e.message:'Gagal mengirim koreksi')}
    finally{setBusy(false)}
  }
  async function verify(r:Finding){
    setBusy(true);setError('');setSuccess('')
    try{
      if(role!=='AM')throw new Error('Khusus Area Manager')
      const review=reviews[r.id]
      if(!review)throw new Error('Review tidak tersedia')
      const {error:saveError}=await supabase.from('am_visit_findings').update({status:review.status,am_notes:review.notes}).eq('id',r.id)
      if(saveError)throw saveError
      setSuccess(review.status==='done'?'Temuan diverifikasi Done.':'Temuan dikembalikan untuk revisi.');await fetchRows()
    }catch(e){setError(e instanceof Error?e.message:'Gagal verifikasi')}
    finally{setBusy(false)}
  }
  function deletionErrorMessage(value: unknown): string {
    if (value instanceof Error) return value.message
    if (typeof value === 'string') return value
    if (value && typeof value === 'object') {
      const obj = value as Record<string, unknown>
      const details = [obj.message, obj.details, obj.hint, obj.code]
        .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
      if (details.length) return details.join(' | ')
    }
    return 'Gagal menghapus. Buka DevTools (F12) untuk melihat respons Supabase.'
  }

  async function deleteFinding(r:Finding){
    if(role!=='AM'||busy)return
    const outletName=outlets.find(o=>o.id===r.outlet_id)?.outlet_name||'Outlet'
    const agreed=window.confirm(`Hapus temuan Report Visit AM untuk ${outletName} (${displayDate(r.visit_date)})?\n\n${r.finding}\n\nTindakan ini tidak dapat dibatalkan.`)
    if(!agreed)return
    setBusy(true);setError('');setSuccess('')
    try{
      const {data:{user},error:authError}=await supabase.auth.getUser()
      if(authError||!user)throw new Error('Sesi login berakhir. Silakan masuk kembali.')
      const {data:deleted,error:deleteError}=await supabase.from('am_visit_findings').delete().eq('id',r.id).select('id')
      if(deleteError)throw deleteError
      if(!deleted?.length)throw new Error('Temuan tidak terhapus. Periksa izin DELETE (RLS) untuk akun AM di Supabase.')
      await fetchRows()
      setSuccess('Temuan Report Visit AM berhasil dihapus.')
    }catch(e){console.error('Delete Report Visit AM gagal:', e);setError('Gagal menghapus temuan: '+deletionErrorMessage(e))}
    finally{setBusy(false)}
  }

  const visible=rows.filter(r=>statusFilter==='all'||r.status===statusFilter)
  const renderPhoto=(key:string,path:string|null)=>path?(imageLinks[key]?
    <a className="visit-photo-link" href={imageLinks[key]} target="_blank" rel="noopener noreferrer" title="Klik untuk melihat foto ukuran penuh">
      <img className="visit-photo-thumb" src={imageLinks[key]} alt={key.endsWith(':finding')?'Foto temuan AM':'Foto hasil perbaikan'} loading="lazy" />
      <span>Lihat foto</span>
    </a>:<span className="visit-muted">Memuat foto...</span>):<span className="visit-muted">—</span>
  return <section className="panel visit-module">
    <div className="visit-head"><div><h3>Report Visit AM</h3><p>Temuan Area Manager, corrective action Leader, dan verifikasi penyelesaian.</p></div><div className="visit-buttons"><button type="button" onClick={()=>void fetchRows()} disabled={busy}>↻ Refresh</button>{role==='AM'&&<button className="visit-primary" type="button" onClick={()=>setShowForm(v=>!v)}>{showForm?'Tutup form':'+ Tambah temuan'}</button>}</div></div>
    {error&&<div className="visit-alert visit-error" role="alert">{error}</div>}
    {success&&<div className="visit-alert visit-success" role="status">{success}</div>}
    {role==='AM'&&showForm&&<form className="visit-form" onSubmit={createFinding}>
      <h3>Input Temuan Visit</h3><div className="visit-grid">
      {!outletId&&<label>Outlet<select required value={form.outlet_id} onChange={e=>setForm(p=>({...p,outlet_id:e.target.value}))}><option value="">Pilih outlet</option>{outlets.map(o=><option key={o.id} value={o.id}>{o.outlet_name}</option>)}</select></label>}
      <label>Tanggal Visit<input type="date" required value={form.visit_date} onChange={e=>setForm(p=>({...p,visit_date:e.target.value}))}/></label>
      <label>Due Date Perbaikan<input type="date" required value={form.due_date} onChange={e=>setForm(p=>({...p,due_date:e.target.value}))}/></label>
      <label>Kategori<select value={form.category} onChange={e=>setForm(p=>({...p,category:e.target.value}))}>{['Product Quality','Service Quality','Store Ambience','Inventory','Administration','Other'].map(x=><option key={x}>{x}</option>)}</select></label>
      <label>Priority<select value={form.priority} onChange={e=>setForm(p=>({...p,priority:e.target.value}))}>{['Low','Medium','High','Urgent'].map(x=><option key={x}>{x}</option>)}</select></label>
      <label className="visit-wide">Detail Temuan<textarea required minLength={5} rows={3} value={form.finding} onChange={e=>setForm(p=>({...p,finding:e.target.value}))}/></label>
      <label className="visit-wide">Catatan AM (opsional)<textarea rows={2} value={form.am_notes} onChange={e=>setForm(p=>({...p,am_notes:e.target.value}))}/></label>
      <label className="visit-wide">Foto Temuan (JPG/PNG/WEBP maks 5MB)<input type="file" accept="image/jpeg,image/png,image/webp" onChange={e=>setPhoto(e.target.files?.[0]||null)}/></label>
      </div><button className="visit-primary" disabled={busy} type="submit">{busy?'Menyimpan...':'Simpan Temuan AM'}</button>
    </form>}
    <div className="visit-toolbar"><span><b>{visible.length} temuan</b> · {new Date(year,month-1,1).toLocaleDateString('id-ID',{month:'long',year:'numeric'})}</span><label>Filter status <select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}><option value="all">Semua</option>{Object.entries(labels).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label></div>
    {loading?<p>Memuat report visit...</p>:visible.length===0?<div className="visit-empty">Belum ada temuan untuk periode dan filter ini.</div>:<div className="visit-scroll"><table className={`visit-table ${role==='AM'?'visit-table-am':'visit-table-leader'}`}><thead><tr>{(role==='AM'?['Outlet','Tanggal Visit','Kategori','Temuan','Foto','Priority','Due Date','Corrective Action','Foto Perbaikan','Status','Catatan AM','Verifikasi','Aksi']:['Tanggal Visit','Kategori','Temuan','Foto','Priority','Due Date','Corrective Action','Foto Perbaikan','Status','Catatan AM','Kirim Koreksi']).map(c=><th key={c}>{c}</th>)}</tr></thead><tbody>{visible.map(r=><tr key={r.id}>
      {role==='AM'&&<td>{outlets.find(o=>o.id===r.outlet_id)?.outlet_name||'—'}</td>}
      <td>{displayDate(r.visit_date)}</td><td>{r.category}</td><td className="visit-long">{r.finding}</td><td>{renderPhoto(r.id+':finding',r.finding_photo_path)}</td><td>{r.priority}</td>
      <td><span className={r.due_date<new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())&&r.status!=='done'?'visit-overdue':''}>{displayDate(r.due_date)}</span></td>
      <td className="visit-long">{role==='LEADER'&&r.status!=='done'?<textarea rows={3} aria-label={'Koreksi '+r.id} value={actions[r.id]||''} onChange={e=>setActions(p=>({...p,[r.id]:e.target.value}))}/>:r.corrective_action||'—'}</td>
      <td>{role==='LEADER'&&r.status!=='done'?<><input aria-label={'Foto koreksi '+r.id} type="file" accept="image/jpeg,image/png,image/webp" onChange={e=>setCorrectiveFiles(p=>({...p,[r.id]:e.target.files?.[0]||null}))}/>{renderPhoto(r.id+':correction',r.correction_photo_path)}</>:renderPhoto(r.id+':correction',r.correction_photo_path)}</td>
      <td><span className={'visit-status status-'+r.status}>{labels[r.status]}</span></td>
      <td className="visit-long">{role==='AM'&&r.status==='submitted'?<textarea rows={3} aria-label={'Catatan AM '+r.id} value={reviews[r.id]?.notes||''} onChange={e=>setReviews(p=>({...p,[r.id]:{...(p[r.id]||{status:'done'}),notes:e.target.value}}))}/>:r.am_notes||'—'}</td>
      <td>{role==='AM' ? (r.status==='submitted'?<div className="visit-row-actions"><select aria-label={'Verifikasi '+r.id} value={reviews[r.id]?.status||'done'} onChange={e=>setReviews(p=>({...p,[r.id]:{...(p[r.id]||{notes:''}),status:e.target.value as 'done'|'revision'}}))}><option value="done">Done</option><option value="revision">Perlu Revisi</option></select><button className="visit-primary" disabled={busy} onClick={()=>void verify(r)}>Simpan</button></div>:<span className="visit-muted">{r.status==='done'?'Terverifikasi':'Menunggu Leader'}</span>) : (r.status!=='done'?<button className="visit-primary" disabled={busy} onClick={()=>void submitCorrection(r)}>Kirim koreksi</button>:<span className="visit-muted">Selesai</span>)}</td>
      {role==='AM'&&<td className="visit-delete-cell"><button type="button" className="visit-delete-icon" title="Hapus temuan" aria-label={`Hapus temuan: ${r.finding}`} disabled={busy} onClick={()=>void deleteFinding(r)}><svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M5 6l1 14h12l1-14"/><path d="M10 10v6M14 10v6"/></svg></button></td>}
    </tr>)}</tbody></table></div>}
    <p className="visit-footnote">* Tabel dapat digeser ke samping. Status Done hanya dapat diberikan AM setelah Leader mengirim corrective action.</p>
  </section>
}
