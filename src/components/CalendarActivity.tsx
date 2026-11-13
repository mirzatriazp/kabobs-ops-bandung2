import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import './GeneralInformationMemo.css'

export type OpsOutlet = { id: string; outlet_code: string; outlet_name: string }
export type CalendarEvent = {
  id: string; outlet_id: string | null; title: string; description: string | null
  activity_date: string; due_date: string | null; category: string; created_at: string
}
export type Announcement = {
  id: string; outlet_id: string | null; message: string; is_active: boolean
  starts_at: string; ends_at: string | null; updated_at: string
  memo_path: string | null; memo_name: string | null; memo_type: string | null
}

type Context = { role: 'AM' | 'LEADER'; outletId: string; outlets: OpsOutlet[]; month: number; year: number }
const dayKey = (year: number, month: number, day: number) => `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
const prettyDate = (date: string) => new Intl.DateTimeFormat('id-ID', {day: 'numeric', month: 'short', year: 'numeric',timeZone:'UTC'}).format(new Date(`${date}T12:00:00Z`))
const visibleFor = (target: string | null, outletId: string, role: 'AM' | 'LEADER') => target === null || (role === 'AM' && !outletId) || target === outletId
const commonError = (e: unknown) => e instanceof Error ? e.message : 'Terjadi kesalahan'

export function useOpsCalendar({role, outletId, month, year}: Context) {
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  const reload = useCallback(() => setRefresh(x => x + 1), [])
  const dateStart = dayKey(year, month, 1)
  const dateEnd = dayKey(year, month, new Date(year, month, 0).getDate())
  useEffect(() => {
    let active = true
    async function run() {
      setLoading(true); setError('')
      try {
        const [calendarResponse, infoResponse] = await Promise.all([
          supabase.from('ops_calendar_events').select('*').or(`and(activity_date.gte.${dateStart},activity_date.lte.${dateEnd}),and(due_date.gte.${dateStart},due_date.lte.${dateEnd})`).order('activity_date'),
          supabase.from('ops_announcements').select('*').order('updated_at', {ascending:false}),
        ])
        if (calendarResponse.error) throw calendarResponse.error
        if (infoResponse.error) throw infoResponse.error
        if (active) {
          setEvents(((calendarResponse.data ?? []) as CalendarEvent[]).filter(e => visibleFor(e.outlet_id, outletId, role)))
          setAnnouncements(((infoResponse.data ?? []) as Announcement[]).filter(a => visibleFor(a.outlet_id, outletId, role)))
        }
      } catch (e) { if(active) setError(commonError(e)) }
      finally { if(active) setLoading(false) }
    }
    run()
    return () => { active = false }
  }, [dateStart, dateEnd, outletId, role, refresh])
  const activeAnnouncements = announcements.filter(a => a.is_active && new Date(a.starts_at).getTime() <= Date.now() && (!a.ends_at || new Date(a.ends_at).getTime() >= Date.now()))
  return {events, announcements, activeAnnouncements, loading, error, reload}
}

const MEMO_BUCKET = 'ops-announcement-memos'
const MAX_MEMO_BYTES = 10 * 1024 * 1024
const MEMO_EXTENSIONS: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/msword': 'doc',
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
}
const memoIsPreviewable = (type: string | null) => type === 'application/pdf' || Boolean(type?.startsWith('image/'))
const fileSizeLabel = (bytes: number) => bytes >= 1048576 ? `${(bytes/1048576).toFixed(1)} MB` : `${Math.ceil(bytes/1024)} KB`
function validateMemo(file: File): string {
  const ext = file.name.toLowerCase().split('.').pop() || ''
  if (!MEMO_EXTENSIONS[file.type] || MEMO_EXTENSIONS[file.type] !== ext && !(file.type === 'image/jpeg' && ext === 'jpeg'))
    return 'Format memo harus PDF, DOC, DOCX, JPG, PNG, atau WEBP.'
  if (file.size > MAX_MEMO_BYTES) return 'Ukuran memo maksimal 10 MB.'
  if (file.size === 0) return 'File memo kosong.'
  return ''
}

export function GeneralInformation({role, outletId, outlets, month, year, compact = false}: Context & {compact?:boolean}) {
  const data = useOpsCalendar({role, outletId, outlets, month, year})
  const [message, setMessage] = useState('')
  const [targetOutlet, setTargetOutlet] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [memoFile, setMemoFile] = useState<File | null>(null)
  const [removeMemo, setRemoveMemo] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [openingMemo, setOpeningMemo] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [actionError, setActionError] = useState('')
  const clear = () => { setMessage('');setTargetOutlet('');setEditingId(null);setMemoFile(null);setRemoveMemo(false);setFormOpen(false) }
  const editing = data.announcements.find(a=>a.id===editingId)

  async function openMemo(item: Announcement) {
    if (!item.memo_path || openingMemo) return
    setOpeningMemo(item.id); setActionError('')
    try {
      // Signed URLs expire in five minutes; do not store them permanently.
      const { data: signed, error } = await supabase.storage.from(MEMO_BUCKET).createSignedUrl(item.memo_path, 300)
      if (error || !signed?.signedUrl) throw error || new Error('Link memo tidak tersedia')
      const link = document.createElement('a')
      link.href = signed.signedUrl
      link.target = '_blank'
      link.rel = 'noopener noreferrer'
      if (!memoIsPreviewable(item.memo_type)) link.download = item.memo_name || 'Memo'
      document.body.appendChild(link)
      link.click()
      link.remove()
    } catch (e) { setActionError(`Memo belum dapat dibuka: ${commonError(e)}`) }
    finally { setOpeningMemo(null) }
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    if (role !== 'AM' || !message.trim() || saving) return
    setActionError('');setNotice('')
    if (memoFile) { const err=validateMemo(memoFile); if(err){setActionError(err);return} }
    setSaving(true)
    let newPath: string | null = null
    try {
      const record: {message:string;outlet_id:string|null;is_active:boolean;memo_path?:string|null;memo_name?:string|null;memo_type?:string|null} =
        {message:message.trim(),outlet_id:targetOutlet||null,is_active:true}
      if (memoFile) {
        const ext = memoFile.name.toLowerCase().split('.').pop() === 'jpeg' ? 'jpg' : memoFile.name.toLowerCase().split('.').pop()
        newPath = `${crypto.randomUUID()}.${ext}`
        const {error:uploadError}=await supabase.storage.from(MEMO_BUCKET).upload(newPath,memoFile,{contentType:memoFile.type,upsert:false})
        if(uploadError)throw new Error('Upload memo gagal: '+uploadError.message)
        record.memo_path=newPath;record.memo_name=memoFile.name;record.memo_type=memoFile.type
      } else if (editingId && removeMemo) {
        record.memo_path=null;record.memo_name=null;record.memo_type=null
      }
      const result=editingId
        ? await supabase.from('ops_announcements').update(record).eq('id',editingId).select('id').single()
        : await supabase.from('ops_announcements').insert(record).select('id').single()
      if(result.error)throw new Error('Gagal menyimpan pengumuman: '+result.error.message)
      // Cleanup is best-effort. The updated database record remains authoritative.
      if (editing?.memo_path && (memoFile || removeMemo) && editing.memo_path !== newPath)
        void supabase.storage.from(MEMO_BUCKET).remove([editing.memo_path])
      clear();data.reload();setNotice(memoFile ? 'Pengumuman dan memo berhasil disimpan.' : 'Pengumuman berhasil disimpan.')
    } catch (err) {
      if (newPath) void supabase.storage.from(MEMO_BUCKET).remove([newPath])
      setActionError(commonError(err))
    } finally { setSaving(false) }
  }
  async function toggle(item: Announcement) {
    if(role!=='AM')return
    setActionError('');setNotice('')
    const {error} = await supabase.from('ops_announcements').update({is_active: !item.is_active}).eq('id',item.id)
    if(error)setActionError(error.message);else data.reload()
  }
  const beginEdit=(a:Announcement)=>{
    setEditingId(a.id);setMessage(a.message);setTargetOutlet(a.outlet_id??'')
    setMemoFile(null);setRemoveMemo(false);setFormOpen(true);setActionError('');setNotice('')
  }
  return <section className="panel ops-card ops-info-panel">
    <div className="ops-heading"><div><h3>General Information</h3><p className="muted">Pengumuman resmi & memo operasional untuk tim outlet</p></div>{!compact&&<button type="button" className="sales-button secondary" onClick={data.reload}>↻ Refresh</button>}</div>
    {data.error&&<div className="sales-alert error">{data.error}</div>}
    {actionError&&<div role="alert" className="sales-alert error">{actionError}</div>}
    {notice&&<div role="status" className="sales-alert success">{notice}</div>}
    {data.loading?<p className="muted">Memuat informasi...</p>:data.activeAnnouncements.length===0?<p className="ops-empty">Belum ada pengumuman aktif.</p>:
    <div className="ops-message-list ops-memo-list">{data.activeAnnouncements.slice(0,compact?3:20).map(a=><article className={'ops-memo-card'+(a.memo_path?' has-attachment':'')} key={a.id}>
      <div className="ops-memo-card-top"><span className="ops-memo-audience">{a.outlet_id?outlets.find(o=>o.id===a.outlet_id)?.outlet_name??'Outlet':'Semua Outlet'}</span>{a.memo_path&&<span className="ops-memo-label">▣ MEMO TERLAMPIR</span>}</div>
      <p className="ops-memo-message">{a.message}</p>
      {a.memo_path&&<div className="ops-memo-attachment">
        <div className="ops-memo-doc-icon" aria-hidden="true">▤</div>
        <div className="ops-memo-doc-detail"><strong title={a.memo_name||'Memo'}>{a.memo_name||'Dokumen Memo'}</strong><small>Dokumen resmi · Akses sesuai outlet</small></div>
        <button type="button" className="ops-memo-open" onClick={()=>void openMemo(a)} disabled={openingMemo!==null}>{openingMemo===a.id?'Membuka…':memoIsPreviewable(a.memo_type)?'Lihat Memo ↗':'Buka Memo ↗'}</button>
      </div>}
      <small className="ops-memo-updated">Diperbarui {new Date(a.updated_at).toLocaleString('id-ID',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Jakarta'})}</small>
    </article>)}</div>}
    {role==='AM'&&!compact&&<>
      <div className="ops-memo-edit-head"><div><h4>Kelola Pengumuman & Memo</h4><p>Tambahkan memo PDF atau dokumen pendukung saat membuat pengumuman.</p></div><button type="button" className="sales-button" onClick={()=>{if(formOpen)clear();else setFormOpen(true)}}>{formOpen?'Tutup Form':'+ Buat Pengumuman'}</button></div>
      {formOpen&&<form className="ops-editor ops-memo-form" onSubmit={save}>
        <h4>{editingId?'Edit Pengumuman':'Pengumuman Baru'}</h4>
        <label>Ditujukan ke<select value={targetOutlet} onChange={e=>setTargetOutlet(e.target.value)}><option value="">Semua Outlet</option>{outlets.map(o=><option value={o.id} key={o.id}>{o.outlet_name}</option>)}</select></label>
        <label>Isi informasi<textarea rows={3} maxLength={2000} value={message} onChange={e=>setMessage(e.target.value)} placeholder="Tulis isi pengumuman resmi untuk Leader outlet…" required /></label>
        <div className="ops-memo-upload"><label htmlFor="ops-memo-file">▤ Lampirkan Memo <span>(Opsional)</span></label><p>PDF direkomendasikan. Mendukung PDF, DOC, DOCX, JPG, PNG, WEBP · Maksimal 10 MB.</p><input id="ops-memo-file" type="file" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.webp" onChange={e=>{setMemoFile(e.target.files?.[0]||null);setRemoveMemo(false)}} />
          {memoFile&&<small>Dipilih: <strong>{memoFile.name}</strong> · {fileSizeLabel(memoFile.size)}</small>}
          {editing?.memo_path&&!memoFile&&<div className="ops-memo-current"><span>Memo saat ini: <strong>{editing.memo_name||'Dokumen memo'}</strong></span><label><input type="checkbox" checked={removeMemo} onChange={e=>setRemoveMemo(e.target.checked)}/> Lepaskan memo dari pengumuman</label></div>}
        </div>
        <div className="ops-buttons"><button className="sales-button" disabled={saving}>{saving?'Menyimpan…':editingId?'Simpan Perubahan':'Terbitkan Pengumuman'}</button><button type="button" className="sales-button secondary" disabled={saving} onClick={clear}>Batal</button></div>
      </form>}
      <h4 className="ops-section-title">Daftar Pengumuman</h4>
      <div className="ops-manage-list">{data.announcements.map(a=><div className="ops-manage-row ops-memo-manage" key={a.id}><div><strong>{a.message}</strong><small>{a.outlet_id?outlets.find(o=>o.id===a.outlet_id)?.outlet_name:'Semua Outlet'} · {a.is_active?'Aktif':'Nonaktif'} {a.memo_path?'· ▣ Memo terlampir':''}</small></div><div className="ops-buttons"><button type="button" className="sales-button secondary" onClick={()=>beginEdit(a)}>Edit</button><button type="button" className="sales-button secondary" onClick={()=>void toggle(a)}>{a.is_active?'Nonaktifkan':'Aktifkan'}</button></div></div>)}</div>
    </>}
  </section>
}

const categories = ['Aktivitas','Training','Launching','Deadline','Meeting','Lainnya']
export function CalendarActivity({role, outletId, outlets, month, year, compact = false}: Context & {compact?:boolean}) {
  const data=useOpsCalendar({role,outletId,outlets,month,year})
  const [editingId,setEditingId]=useState<string|null>(null)
  const [title,setTitle]=useState('')
  const [description,setDescription]=useState('')
  const [activityDate,setActivityDate]=useState(dayKey(year,month,1))
  const [dueDate,setDueDate]=useState('')
  const [category,setCategory]=useState('Aktivitas')
  const [targetOutlet,setTargetOutlet]=useState('')
  const [saving,setSaving]=useState(false)
  const [feedback,setFeedback]=useState('')
  const [actionError,setActionError]=useState('')
  const daysInMonth=new Date(year,month,0).getDate()
  const startIndex=(new Date(year,month-1,1).getDay()+6)%7
  const calendarCells = Array.from({length:Math.ceil((startIndex+daysInMonth)/7)*7},(_,index)=>index-startIndex+1)
  const reset=()=>{setEditingId(null);setTitle('');setDescription('');setActivityDate(dayKey(year,month,1));setDueDate('');setCategory('Aktivitas');setTargetOutlet('')}
  const listed=useMemo(()=>[...data.events].sort((a,b)=>a.activity_date.localeCompare(b.activity_date)),[data.events])
  async function save(e:FormEvent){
    e.preventDefault();setActionError('');setFeedback('')
    if(dueDate && dueDate<activityDate){setActionError('Deadline tidak boleh sebelum tanggal aktivitas.');return}
    setSaving(true)
    const record={title:title.trim(),description:description.trim()||null,activity_date:activityDate,due_date:dueDate||null,category,outlet_id:targetOutlet||null}
    const response=editingId?await supabase.from('ops_calendar_events').update(record).eq('id',editingId):await supabase.from('ops_calendar_events').insert(record)
    setSaving(false)
    if(response.error){setActionError(response.error.message);return}
    reset();data.reload();setFeedback('Aktivitas berhasil disimpan.')
  }
  async function remove(id:string){
    if(!window.confirm('Hapus aktivitas ini?'))return
    const {error}=await supabase.from('ops_calendar_events').delete().eq('id',id)
    if(error)setActionError(error.message);else{data.reload();setFeedback('Aktivitas dihapus.')}
  }
  const startEdit=(item:CalendarEvent)=>{setEditingId(item.id);setTitle(item.title);setDescription(item.description??'');setActivityDate(item.activity_date);setDueDate(item.due_date??'');setCategory(item.category);setTargetOutlet(item.outlet_id??'')}
  return <section className="panel ops-card">
    <div className="ops-heading"><div><h3>Calendar Activity & Deadline</h3><p className="muted">{new Intl.DateTimeFormat('id-ID',{month:'long',year:'numeric'}).format(new Date(year,month-1,1))} · {role==='AM'&&!outletId?'Semua outlet':outlets.find(o=>o.id===outletId)?.outlet_name ?? 'Outlet'}</p></div><button className="sales-button secondary" onClick={data.reload}>↻ Refresh</button></div>
    {data.error && <div className="sales-alert error">{data.error}</div>}{actionError && <div className="sales-alert error">{actionError}</div>}{feedback && <div className="sales-alert success">{feedback}</div>}
    <div className="ops-calendar-grid">{['Sen','Sel','Rab','Kam','Jum','Sab','Min'].map(d=><div key={d} className="ops-calendar-weekday">{d}</div>)}{calendarCells.map((day,index)=>{const date=dayKey(year,month,day);const entries=day>0&&day<=daysInMonth?data.events.filter(e=>e.activity_date===date||e.due_date===date):[];return <div key={index} className={'ops-calendar-cell'+(day<1||day>daysInMonth?' outside':'')+(date===new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())?' today':'')}><strong>{day>0&&day<=daysInMonth?day:''}</strong>{entries.slice(0,compact?2:4).map(e=><div className={'ops-calendar-chip'+(e.due_date===date&&e.activity_date!==date?' deadline':'')} key={e.id} title={e.title}>{e.due_date===date&&e.activity_date!==date?'⏰ ':''}{e.title}</div>)}{entries.length>(compact?2:4)&&<small>+{entries.length-(compact?2:4)} lagi</small>}</div>})}</div>
    {!compact && <><h4 className="ops-section-title">Agenda dan deadline bulan ini</h4>{data.loading?<p className="muted">Memuat agenda...</p>:listed.length===0?<p className="ops-empty">Belum ada aktivitas di periode ini.</p>:<div className="ops-agenda-list">{listed.map(e=><article className="ops-agenda-item" key={e.id}><div className="ops-date-tile"><strong>{e.activity_date.slice(8,10)}</strong><small>{new Intl.DateTimeFormat('id-ID',{month:'short'}).format(new Date(`${e.activity_date}T12:00:00Z`))}</small></div><div className="ops-agenda-body"><span className="ops-tag">{e.category} · {e.outlet_id?outlets.find(o=>o.id===e.outlet_id)?.outlet_name:'Semua Outlet'}</span><strong>{e.title}</strong>{e.description&&<p>{e.description}</p>}{e.due_date&&<small>Deadline: {prettyDate(e.due_date)}</small>}</div>{role==='AM'&&<div className="ops-buttons"><button className="sales-button secondary" onClick={()=>startEdit(e)}>Edit</button><button className="sales-button secondary" onClick={()=>remove(e.id)}>Hapus</button></div>}</article>)}</div>}
      {role==='AM'&&<><h4 className="ops-section-title">{editingId?'Edit aktivitas':'Tambah aktivitas baru'}</h4><form className="ops-editor" onSubmit={save}><div className="ops-form-grid"><label>Judul<input value={title} onChange={e=>setTitle(e.target.value)} maxLength={150} required placeholder="Launching menu / Training leader"/></label><label>Kategori<select value={category} onChange={e=>setCategory(e.target.value)}>{categories.map(c=><option key={c}>{c}</option>)}</select></label><label>Tanggal aktivitas<input type="date" value={activityDate} onChange={e=>setActivityDate(e.target.value)} required /></label><label>Deadline (opsional)<input type="date" value={dueDate} onChange={e=>setDueDate(e.target.value)}/></label><label>Ditujukan ke<select value={targetOutlet} onChange={e=>setTargetOutlet(e.target.value)}><option value="">Semua Outlet</option>{outlets.map(o=><option value={o.id} key={o.id}>{o.outlet_name}</option>)}</select></label></div><label>Detail aktivitas<textarea rows={3} value={description} onChange={e=>setDescription(e.target.value)} placeholder="Instruksi atau catatan untuk outlet"/></label><div className="ops-buttons"><button className="sales-button" disabled={saving}>{saving?'Menyimpan...':editingId?'Simpan Perubahan':'Tambah ke Calendar'}</button>{editingId&&<button type="button" className="sales-button secondary" onClick={reset}>Batal</button>}</div></form></>}
    </>}
  </section>
}
