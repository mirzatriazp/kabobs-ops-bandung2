import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '../lib/supabase'

export type OpsOutlet = { id: string; outlet_code: string; outlet_name: string }
export type CalendarEvent = {
  id: string; outlet_id: string | null; title: string; description: string | null
  activity_date: string; due_date: string | null; category: string; created_at: string
}
export type Announcement = {
  id: string; outlet_id: string | null; message: string; is_active: boolean
  starts_at: string; ends_at: string | null; updated_at: string
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

export function GeneralInformation({role, outletId, outlets, month, year, compact = false}: Context & {compact?:boolean}) {
  const data = useOpsCalendar({role, outletId, outlets, month, year})
  const [message, setMessage] = useState('')
  const [targetOutlet, setTargetOutlet] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')
  const [actionError, setActionError] = useState('')
  const clear = () => { setMessage('');setTargetOutlet('');setEditingId(null) }
  async function save(e: FormEvent) {
    e.preventDefault()
    if (!message.trim()) return
    setSaving(true);setActionError('');setNotice('')
    const record = {message: message.trim(), outlet_id: targetOutlet || null, is_active: true}
    const response = editingId ? await supabase.from('ops_announcements').update(record).eq('id',editingId) : await supabase.from('ops_announcements').insert(record)
    setSaving(false)
    if(response.error) {setActionError(response.error.message);return}
    clear();data.reload();setNotice('Pengumuman berhasil disimpan.')
  }
  async function toggle(item: Announcement) {
    const {error} = await supabase.from('ops_announcements').update({is_active: !item.is_active}).eq('id',item.id)
    if(error)setActionError(error.message);else data.reload()
  }
  return <section className="panel ops-card">
    <div className="ops-heading"><div><h3>General Information</h3><p className="muted">Pengumuman Area Manager untuk tim outlet</p></div>{!compact && <button type="button" className="sales-button secondary" onClick={data.reload}>↻ Refresh</button>}</div>
    {data.error && <div className="sales-alert error">{data.error}</div>}
    {actionError && <div role="alert" className="sales-alert error">{actionError}</div>}
    {notice && <div role="status" className="sales-alert success">{notice}</div>}
    {data.loading ? <p className="muted">Memuat informasi...</p> : data.activeAnnouncements.length === 0 ? <p className="ops-empty">Belum ada pengumuman aktif.</p> : <div className="ops-message-list">{data.activeAnnouncements.slice(0,compact?3:20).map(a=><article className="ops-message" key={a.id}><span className="ops-tag">{a.outlet_id ? outlets.find(o => o.id === a.outlet_id)?.outlet_name ?? 'Outlet' : 'Semua Outlet'}</span><p>{a.message}</p><small>Diperbarui {new Date(a.updated_at).toLocaleString('id-ID',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Jakarta'})}</small></article>)}</div>}
    {role === 'AM' && !compact && <>
      <h4 className="ops-section-title">{editingId ? 'Edit pengumuman' : 'Buat pengumuman'}</h4>
      <form className="ops-editor" onSubmit={save}><label>Ditujukan ke<select value={targetOutlet} onChange={e=>setTargetOutlet(e.target.value)}><option value="">Semua Outlet</option>{outlets.map(o=><option value={o.id} key={o.id}>{o.outlet_name}</option>)}</select></label><label>Isi informasi<textarea rows={3} maxLength={2000} value={message} onChange={e=>setMessage(e.target.value)} placeholder="Contoh: Semangat weekend guys, jangan lupa senyum ya!" required /></label><div className="ops-buttons"><button className="sales-button" disabled={saving}>{saving?'Menyimpan...':'Simpan Pengumuman'}</button>{editingId && <button type="button" className="sales-button secondary" onClick={clear}>Batal</button>}</div></form>
      <h4 className="ops-section-title">Kelola pengumuman</h4><div className="ops-manage-list">{data.announcements.map(a=><div className="ops-manage-row" key={a.id}><div><strong>{a.message}</strong><small>{a.outlet_id ? outlets.find(o=>o.id===a.outlet_id)?.outlet_name : 'Semua Outlet'} · {a.is_active?'Aktif':'Nonaktif'}</small></div><div className="ops-buttons"><button type="button" className="sales-button secondary" onClick={()=>{setEditingId(a.id);setMessage(a.message);setTargetOutlet(a.outlet_id??'')}}>Edit</button><button type="button" className="sales-button secondary" onClick={()=>toggle(a)}>{a.is_active?'Nonaktifkan':'Aktifkan'}</button></div></div>)}</div>
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
