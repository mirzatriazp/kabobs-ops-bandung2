import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import './PIQPerformance.css'

type Outlet = { id: string; outlet_code: string; outlet_name: string }
type Props = { role: 'AM' | 'LEADER'; outletId: string; outlets: Outlet[]; month: number; year: number }
type Audit = {
  id: string; outlet_id: string; audit_year: number; audit_month: number; notes: string;
  score_1: number; score_2: number; score_3: number; score_4: number;
  score_5: number; score_6: number; score_7: number; updated_at: string
}
type Pillar = { pillar_no: number; pillar_name: string }
const numericKeys = ['score_1','score_2','score_3','score_4','score_5','score_6','score_7'] as const
const defaultScores = ['', '', '', '', '', '', '']
const gradeLabel = (v: number | string) => v === 2 || v === '2' ? 'A' : v === 1 || v === '1' ? 'B' : v === 0 || v === '0' ? 'C' : '—'
const total = (audit: Audit) => numericKeys.reduce((n, k) => n + audit[k], 0)
const pct = (n: number) => (n / 14 * 100).toLocaleString('id-ID', { maximumFractionDigits: 1 }) + '%'
const monthLabel = (m: number, y: number) => new Date(y, m - 1, 1).toLocaleDateString('id-ID',{month:'long',year:'numeric'})

export default function PIQPerformance({ role, outletId, outlets, month, year }: Props) {
  const [pillars, setPillars] = useState<Pillar[]>([])
  const [rows, setRows] = useState<Audit[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [showPillars, setShowPillars] = useState(false)
  const [editOutlet, setEditOutlet] = useState('')
  const [scores, setScores] = useState<string[]>([...defaultScores])
  const [notes, setNotes] = useState('')
  const [pillarNames, setPillarNames] = useState<string[]>(Array(7).fill(''))

  const load = useCallback(async () => {
    setLoading(true); setError('')
    let query = supabase.from('piq_audits').select('*').eq('audit_year',year).eq('audit_month',month)
    if (role === 'LEADER' && outletId) query = query.eq('outlet_id',outletId)
    const [auditResult,pillarResult] = await Promise.all([
      query.order('updated_at',{ascending:false}).limit(100),
      supabase.from('piq_pillars').select('pillar_no,pillar_name').order('pillar_no')
    ])
    if (auditResult.error || pillarResult.error) setError('Gagal memuat data PIQ: ' + (auditResult.error?.message || pillarResult.error?.message))
    else {
      setRows((auditResult.data || []) as Audit[])
      const p = (pillarResult.data || []) as Pillar[]
      setPillars(p)
      setPillarNames(Array.from({length:7},(_,i) => p.find(x=>x.pillar_no===i+1)?.pillar_name || `Pilar ${i+1}`))
    }
    setLoading(false)
  },[role,outletId,year,month])
  useEffect(()=>{void load()},[load])

  const ranked = useMemo(() => [...rows].sort((a,b)=>total(b)-total(a) || a.outlet_id.localeCompare(b.outlet_id)),[rows])
  const byOutlet = useMemo(() => new Map(rows.map(r=>[r.outlet_id,r])),[rows])
  const outletName = (id:string) => outlets.find(o=>o.id===id)?.outlet_name || 'Outlet'
  const avg = rows.length ? rows.reduce((s,r)=>s+total(r),0)/rows.length : 0
  const rewarded = rows.filter(r=>total(r)>=9).length
  const leaderAudit = role === 'LEADER' ? rows.find(r=>r.outlet_id===outletId) : undefined
  const pillarName = (index:number) => pillars.find(p=>p.pillar_no===index+1)?.pillar_name || `Pilar ${index+1}`
  const edit = (id:string) => {
    const existing = byOutlet.get(id)
    setEditOutlet(id)
    setScores(existing ? numericKeys.map(k=>String(existing[k])) : [...defaultScores])
    setNotes(existing?.notes || '')
    setError(''); setMessage(''); setShowForm(true)
  }
  const save = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if(role!=='AM')return
    if(!editOutlet){setError('Pilih outlet.');return}
    if(scores.some(s=>!['0','1','2'].includes(s))){setError('Isi grade A, B, atau C untuk semua 7 pilar.');return}
    setSaving(true);setError('');setMessage('')
    const payload: Record<string,string|number> = {
      outlet_id:editOutlet,audit_year:year,audit_month:month,notes:notes.trim(),
    }
    numericKeys.forEach((key,i)=>{payload[key]=Number(scores[i])})
    const {error:saveError} = await supabase.from('piq_audits').upsert(payload,{onConflict:'outlet_id,audit_year,audit_month'})
    if(saveError) setError('Gagal menyimpan audit: '+saveError.message)
    else {setShowForm(false);setMessage('Audit PIQ berhasil disimpan.');await load()}
    setSaving(false)
  }
  const savePillars = async () => {
    if(role!=='AM')return
    if(pillarNames.some(s=>s.trim().length<2 || s.trim().length>100)){setError('Nama setiap pilar minimal 2 dan maksimal 100 karakter.');return}
    setSaving(true);setError('');setMessage('')
    const results = await Promise.all(pillarNames.map((name,i) => supabase.from('piq_pillars').update({pillar_name:name.trim(),updated_at:new Date().toISOString()}).eq('pillar_no',i+1)))
    const fail = results.find(x=>x.error)
    if(fail?.error)setError('Gagal menyimpan nama pilar: '+fail.error.message)
    else {setShowPillars(false);setMessage('Nama 7 pilar tersimpan.');await load()}
    setSaving(false)
  }
  return <div className="piq-root">
    <section className="piq-panel">
      <div className="piq-head">
        <div><h3>PIQ Performance — Audit Internal</h3><p>Skor A = 2, B = 1, C = 0 · Maksimum 14 poin per outlet · {monthLabel(month,year)}</p></div>
        <div className="piq-head-actions"><button type="button" onClick={()=>void load()}>↻ Refresh</button>{role==='AM'&&<><button type="button" onClick={()=>{setShowPillars(v=>!v);setShowForm(false)}}>Atur 7 Pilar</button><button type="button" className="piq-yellow" onClick={()=>{edit(outletId||outlets[0]?.id||'');setShowPillars(false)}}>+ Input Audit</button></>}</div>
      </div>
      {error&&<p className="piq-error" role="alert">{error}</p>}
      {message&&<p className="piq-success">{message}</p>}
      {role==='AM'&&showPillars&&<div className="piq-editor"><h4>Pengaturan nama 7 pilar</h4><p>Nama bawaan masih placeholder. Ganti dengan nama pilar PIQ resmi yang digunakan Kabobs. Perubahan nama berlaku pada tampilan seluruh riwayat.</p><div className="piq-pillar-grid">{pillarNames.map((name,i)=><label key={i}>Pilar {i+1}<input maxLength={100} value={name} onChange={e=>setPillarNames(arr=>arr.map((x,j)=>j===i?e.target.value:x))}/></label>)}</div><div className="piq-buttons"><button type="button" onClick={()=>setShowPillars(false)}>Batal</button><button type="button" className="piq-yellow" disabled={saving} onClick={()=>void savePillars()}>{saving?'Menyimpan...':'Simpan Nama Pilar'}</button></div></div>}
      {role==='AM'&&showForm&&<form className="piq-editor" onSubmit={e=>void save(e)}><h4>Input / Edit Audit PIQ</h4><div className="piq-formtop"><label>Outlet<select value={editOutlet} onChange={e=>edit(e.target.value)} required>{outlets.map(o=><option key={o.id} value={o.id}>{o.outlet_name}</option>)}</select></label><div><span>Periode audit</span><strong>{monthLabel(month,year)}</strong></div></div><div className="piq-pillar-grid">{Array.from({length:7},(_,i)=><label key={i}>{pillars.find(p=>p.pillar_no===i+1)?.pillar_name||`Pilar ${i+1}`}<select value={scores[i]} required onChange={e=>setScores(arr=>arr.map((x,j)=>j===i?e.target.value:x))}><option value="">Pilih grade</option><option value="2">A — 2 poin</option><option value="1">B — 1 poin</option><option value="0">C — 0 poin</option></select></label>)}</div><label>Catatan hasil audit<textarea rows={3} maxLength={2000} value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Temuan audit dan arahan perbaikan (opsional)"/></label><p className="piq-preview">Total: <strong>{scores.every(s=>['0','1','2'].includes(s))?`${scores.reduce((s,v)=>s+Number(v),0)} / 14 (${pct(scores.reduce((s,v)=>s+Number(v),0))})`:'Lengkapi 7 pilar'}</strong></p><div className="piq-buttons"><button type="button" onClick={()=>setShowForm(false)}>Batal</button><button type="submit" className="piq-yellow" disabled={saving}>{saving?'Menyimpan...':'Simpan / Edit Audit'}</button></div></form>}
      <div className="piq-kpis"><div><span>Reward didapatkan</span><strong>{role==='LEADER' ? (leaderAudit ? (total(leaderAudit)>=9 ? 'Dapat Reward' : 'Tidak Dapat Reward') : 'Belum diaudit') : `${rewarded} dari ${rows.length} outlet`}</strong><small>Skor 9–14: dapat reward · 0–8: tidak</small></div><div><span>Rata-rata achievement</span><strong>{rows.length?pct(avg):'—'}</strong></div><div><span>Nilai</span><strong>{role==='LEADER' ? (leaderAudit ? `${total(leaderAudit)} / 14` : '—') : rows.length ? `${Number(avg.toFixed(1)).toLocaleString('id-ID')} / 14` : '—'}</strong>{role==='AM'&&<small>Rata-rata nilai outlet yang diaudit</small>}</div></div>
      <div className="piq-table-wrap"><table><thead><tr>{role==='AM'&&<th>Rank</th>}<th>Outlet</th>{Array.from({length:7},(_,i)=><th key={i} className="piq-pillar-heading" title={pillarName(i)}>{pillarName(i)}</th>)}<th>Total</th><th>Achievement</th><th>Catatan AM</th><th>Update Terakhir</th>{role==='AM'&&<th>Aksi</th>}</tr></thead><tbody>{loading?<tr><td colSpan={role==='AM'?14:12}>Memuat audit PIQ...</td></tr>:ranked.length===0?<tr><td className="piq-empty" colSpan={role==='AM'?14:12}>Belum ada hasil audit pada periode ini.</td></tr>:ranked.map((r,i)=><tr key={r.id}>{role==='AM'&&<td><strong>#{i+1}</strong></td>}<td className="piq-outlet">{outletName(r.outlet_id)}</td>{numericKeys.map(k=><td key={k} title={`${pillars.find(p=>p.pillar_no===Number(k.slice(-1)))?.pillar_name||`Pilar ${k.slice(-1)}`}: ${gradeLabel(r[k])} = ${r[k]} poin`}><span className={`piq-grade piq-grade-${gradeLabel(r[k]).toLowerCase()}`}>{gradeLabel(r[k])} · {r[k]}</span></td>)}<td><strong>{total(r)} / 14</strong></td><td><strong>{pct(total(r))}</strong></td><td className="piq-notes">{r.notes||'—'}</td><td>{new Date(r.updated_at).toLocaleDateString('id-ID',{day:'2-digit',month:'short',year:'numeric'})}</td>{role==='AM'&&<td><button type="button" className="piq-small-edit" onClick={()=>edit(r.outlet_id)}>Edit</button></td>}</tr>)}</tbody></table></div>
      <p className="piq-foot">Judul kolom menampilkan nama 7 pilar yang diatur AM. A = 2, B = 1, C = 0. Ubah bulan/tahun untuk melihat riwayat. {role==='AM'?'Peringkat hanya menghitung outlet yang sudah memiliki audit pada periode ini.':'Leader hanya dapat melihat audit outlet sendiri.'}</p>
    </section>
  </div>
}
