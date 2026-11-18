import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent, ChangeEvent } from 'react'
import { supabase } from '../lib/supabase'
import { downloadXlsx, type ExcelCell } from '../lib/exportXlsx'
import { readPIQExcel, type PIQExcelPreview } from '../lib/piq_excel_import'
import './PIQPerformance.css'

type Outlet = { id: string; outlet_code: string; outlet_name: string }
type Props = { role: 'AM' | 'LEADER'; outletId: string; outlets: Outlet[]; month: number; year: number }
type Audit = {
  id: string; outlet_id: string; audit_year: number; audit_month: number; notes: string;
  score_1: number; score_2: number; score_3: number; score_4: number;
  score_5: number; score_6: number; score_7: number; updated_at: string
}
type Pillar = { pillar_no: number; pillar_name: string }
const scoreKeys = ['score_1', 'score_2', 'score_3', 'score_4', 'score_5', 'score_6', 'score_7'] as const
const blank = ['', '', '', '', '', '', '']
const grade = (score: number) => score === 2 ? 'A' : score === 1 ? 'B' : 'C'
const sum = (audit: Audit) => scoreKeys.reduce((n, key) => n + audit[key], 0)
const percentage = (score: number) => (score / 14 * 100).toLocaleString('id-ID', { maximumFractionDigits: 1 }) + '%'
const monthNames = Array.from({ length: 12 }, (_, i) => new Date(2026, i, 1).toLocaleDateString('id-ID', { month: 'long' }))

export default function PIQPerformance({ role, outletId, outlets, year }: Props) {
  const [chosenOutlet, setChosenOutlet] = useState('')
  const [pillars, setPillars] = useState<Pillar[]>([])
  const [records, setRecords] = useState<Audit[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [showPillars, setShowPillars] = useState(false)
  const [editMonth, setEditMonth] = useState(new Date().getMonth() + 1)
  const [scores, setScores] = useState<string[]>([...blank])
  const [notes, setNotes] = useState('')
  const [pillarNames, setPillarNames] = useState<string[]>(Array(7).fill(''))
  const [showExcel, setShowExcel] = useState(false)
  const [importing, setImporting] = useState(false)
  const [preview, setPreview] = useState<(PIQExcelPreview & { outletId:string; year:number; filename:string }) | null>(null)
  const [overwrite, setOverwrite] = useState(false)

  // AM may select an outlet inside PIQ. Global outlet selection still works;
  // leader's outlet is fixed by the authenticated profile and server-side RLS.
  useEffect(() => {
    if (role === 'AM') setChosenOutlet(current => outletId || (outlets.some(o => o.id === current) ? current : outlets[0]?.id || ''))
    else setChosenOutlet(outletId)
  }, [role, outletId, outlets])
  const effectiveOutlet = role === 'AM' ? chosenOutlet : outletId
  const outletName = outlets.find(o => o.id === effectiveOutlet)?.outlet_name || 'Outlet belum dipilih'

  const load = useCallback(async () => {
    setLoading(true); setError('')
    if (!effectiveOutlet) { setRecords([]); setLoading(false); return }
    const [result, pillarResult] = await Promise.all([
      supabase.from('piq_audits').select('*').eq('audit_year', year).eq('outlet_id', effectiveOutlet).order('audit_month', { ascending: true }),
      supabase.from('piq_pillars').select('pillar_no,pillar_name').order('pillar_no')
    ])
    if (result.error || pillarResult.error) {
      setError('Gagal memuat data PIQ: ' + (result.error?.message || pillarResult.error?.message))
    } else {
      setRecords((result.data || []) as Audit[])
      const p = (pillarResult.data || []) as Pillar[]
      setPillars(p)
      setPillarNames(Array.from({ length: 7 }, (_, i) => p.find(x => x.pillar_no === i + 1)?.pillar_name || `Pilar ${i + 1}`))
    }
    setLoading(false)
  }, [effectiveOutlet, year])
  useEffect(() => { void load() }, [load])

  const byMonth = useMemo(() => new Map(records.map(a => [a.audit_month, a])), [records])
  const audited = records.length
  const rewardMonths = records.filter(a => sum(a) >= 9).length
  const avgScore = audited ? records.reduce((v, a) => v + sum(a), 0) / audited : 0
  const pillarName = (index: number) => pillars.find(p => p.pillar_no === index + 1)?.pillar_name || `Pilar ${index + 1}`

  const exportPIQ = (template:boolean) => {
    if(role!=='AM'||!effectiveOutlet||loading)return
    const header:ExcelCell[] = ['Bulan', ...scoreKeys.map((_,i)=>pillarName(i)), 'Total', 'Achievement', 'Reward', 'Catatan AM', 'Update Terakhir']
    const body:ExcelCell[][] = monthNames.map((name,i)=>{
      const audit = template?undefined:byMonth.get(i+1)
      if(!audit)return [name,...Array(7).fill(''),'','','','','']
      const points=sum(audit)
      return [name,...scoreKeys.map(k=>`${grade(audit[k])} · ${audit[k]}`),`${points} / 14`,percentage(points),points>=9?'Dapat':'Tidak',audit.notes||'',new Date(audit.updated_at).toLocaleDateString('id-ID',{day:'2-digit',month:'short',year:'numeric'})]
    })
    const clean=outletName.replace(/[^a-z0-9]+/gi,'_').replace(/^_|_$/g,'')
    downloadXlsx(`KABOBS_PIQ_${template?'Template':'Rekap'}_${clean}_${year}.xlsx`,[{name:'PIQ Tahunan',rows:[header,...body]}])
  }

  const chooseExcel=async(event:ChangeEvent<HTMLInputElement>)=>{
    const file=event.target.files?.[0]
    event.target.value=''
    if(role!=='AM'||!file||!effectiveOutlet)return
    setImporting(true);setError('');setMessage('');setPreview(null);setOverwrite(false)
    try{
      const parsed=await readPIQExcel(file)
      setPreview({...parsed,outletId:effectiveOutlet,year,filename:file.name})
    }catch(e){setError('Gagal membaca Excel PIQ: '+(e instanceof Error?e.message:'File tidak valid.'))}
    finally{setImporting(false)}
  }

  const saveExcel=async()=>{
    if(role!=='AM'||!preview||saving||preview.outletId!==effectiveOutlet||preview.year!==year)return
    const existing=preview.rows.filter(r=>byMonth.has(r.month))
    if(existing.length&&!overwrite){setError('Centang konfirmasi untuk mengganti audit bulan yang sudah tersimpan.');return}
    if(!window.confirm(`Simpan ${preview.rows.length} bulan PIQ untuk ${outletName} (${year})?${existing.length?` ${existing.length} bulan yang sudah ada akan diganti.`:''}`))return
    setSaving(true);setError('');setMessage('')
    const payload=preview.rows.map(row=>{
      const item:Record<string,string|number>={outlet_id:effectiveOutlet,audit_year:year,audit_month:row.month,notes:row.notes.trim()}
      scoreKeys.forEach((k,i)=>{item[k]=row.scores[i]})
      return item
    })
    const {error:saveError}=await supabase.from('piq_audits').upsert(payload,{onConflict:'outlet_id,audit_year,audit_month'})
    if(saveError)setError('Gagal menyimpan import PIQ: '+saveError.message)
    else{
      const total=preview.rows.length
      setPreview(null);setOverwrite(false)
      await load()
      setMessage(`${total} bulan audit PIQ berhasil diimpor untuk ${outletName} · ${year}.`)
    }
    setSaving(false)
  }

  const edit = (month: number) => {
    const found = byMonth.get(month)
    setEditMonth(month)
    setScores(found ? scoreKeys.map(key => String(found[key])) : [...blank])
    setNotes(found?.notes || '')
    setError(''); setMessage(''); setShowPillars(false); setShowForm(true)
  }
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (role !== 'AM' || !effectiveOutlet) return
    if (scores.some(v => !['0', '1', '2'].includes(v))) { setError('Pilih A, B, atau C untuk semua pilar.'); return }
    setSaving(true); setError(''); setMessage('')
    const payload: Record<string, string | number> = {
      outlet_id: effectiveOutlet, audit_year: year, audit_month: editMonth, notes: notes.trim()
    }
    scoreKeys.forEach((key, index) => { payload[key] = Number(scores[index]) })
    const { error: saveError } = await supabase.from('piq_audits').upsert(payload, { onConflict: 'outlet_id,audit_year,audit_month' })
    if (saveError) setError('Gagal menyimpan audit: ' + saveError.message)
    else { setShowForm(false); setMessage(`Audit ${monthNames[editMonth - 1]} ${year} berhasil disimpan.`); await load() }
    setSaving(false)
  }
  const savePillars = async () => {
    if (role !== 'AM') return
    if (pillarNames.some(v => v.trim().length < 2 || v.trim().length > 100)) { setError('Nama setiap pilar harus 2–100 karakter.'); return }
    setSaving(true); setError(''); setMessage('')
    const results = await Promise.all(pillarNames.map((name, index) =>
      supabase.from('piq_pillars').update({ pillar_name: name.trim(), updated_at: new Date().toISOString() }).eq('pillar_no', index + 1)
    ))
    const failure = results.find(item => item.error)
    if (failure?.error) setError('Gagal menyimpan nama pilar: ' + failure.error.message)
    else { setShowPillars(false); setMessage('Nama 7 pilar berhasil disimpan.'); await load() }
    setSaving(false)
  }

  return <div className="piq-root"><section className="piq-panel">
    <div className="piq-head">
      <div><h3>PIQ Performance — Rekap Tahunan</h3><p>Progres Januari–Desember {year} · {outletName} · Skor maksimal 14 poin</p></div>
      <div className="piq-head-actions">
        <button type="button" onClick={() => void load()}>↻ Refresh</button>
        {role === 'AM' && <button type="button" onClick={() => {setShowExcel(v=>!v);setPreview(null);setOverwrite(false);setError('')}}>{showExcel?'↑ Tutup Import Excel':'↓ Buka Import Excel'}</button>}
        {role === 'AM' && <><button type="button" onClick={() => { setShowPillars(v => !v); setShowForm(false) }}>Atur 7 Pilar</button><button type="button" className="piq-yellow" onClick={() => edit(new Date().getFullYear() === year ? new Date().getMonth() + 1 : 1)} disabled={!effectiveOutlet}>+ Input Audit</button></>}
      </div>
    </div>
    {role === 'AM' && <div className="piq-outlet-filter"><label htmlFor="piq-outlet-select">Outlet</label><select id="piq-outlet-select" value={effectiveOutlet} onChange={e => { setChosenOutlet(e.target.value); setShowForm(false); setPreview(null); setOverwrite(false) }}>{outlets.map(o => <option key={o.id} value={o.id}>{o.outlet_name}</option>)}</select></div>}
    {error && <p role="alert" className="piq-error">{error}</p>}
    {message && <p className="piq-success">{message}</p>}
    {role==='AM'&&showExcel&&<section className="piq-excel-panel" aria-label="Import dan export Excel PIQ">
      <div className="piq-excel-title"><strong>Excel PIQ — Khusus Area Manager</strong><p>Outlet: <b>{outletName}</b> · Tahun: <b>{year}</b>. Template mengikuti urutan kolom tabel PIQ di bawah.</p></div>
      <div className="piq-excel-actions">
        <button type="button" disabled={loading||saving} onClick={()=>exportPIQ(true)}>↓ Download Template</button>
        <button type="button" disabled={loading||saving} onClick={()=>exportPIQ(false)}>↓ Download Data</button>
        <label className="piq-excel-upload">↑ Upload Excel (.xlsx)<input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={loading||saving||importing} onChange={e=>void chooseExcel(e)}/></label>
      </div>
      <p className="piq-excel-help">Isi tujuh pilar dengan <b>A / B / C</b> atau <b>A · 2 / B · 1 / C · 0</b>. Baris bulan kosong dilewati. Total, Achievement, Reward, dan Update Terakhir hanya informasi: dihitung ulang oleh website. File berlaku untuk outlet dan tahun yang dipilih di atas.</p>
      {importing&&<p className="piq-excel-progress">Membaca Excel…</p>}
      {preview&&preview.outletId===effectiveOutlet&&preview.year===year&&<div className="piq-excel-preview">
        <strong>Preview: {preview.filename}</strong>
        <p>{preview.rows.length} bulan siap diimpor · {preview.skipped} bulan kosong dilewati.</p>
        <div className="piq-excel-table-scroll"><table><thead><tr><th>Bulan</th>{scoreKeys.map((key,i)=><th key={key}>{pillarName(i)}</th>)}<th>Total</th><th>Status</th></tr></thead><tbody>{preview.rows.map(r=><tr key={r.month}><td>{monthNames[r.month-1]}</td>{r.scores.map((v,i)=><td key={i}>{grade(v)} · {v}</td>)}<td>{r.scores.reduce((a,b)=>a+b,0)} / 14</td><td>{byMonth.has(r.month)?'Sudah ada':'Baru'}</td></tr>)}</tbody></table></div>
        {preview.rows.some(r=>byMonth.has(r.month))&&<label className="piq-excel-confirm"><input type="checkbox" checked={overwrite} onChange={e=>setOverwrite(e.target.checked)}/> Saya setuju mengganti data audit pada bulan yang sudah terisi.</label>}
        <div className="piq-buttons"><button type="button" disabled={saving} onClick={()=>setPreview(null)}>Batal</button><button type="button" className="piq-yellow" disabled={saving||preview.rows.some(r=>byMonth.has(r.month))&&!overwrite} onClick={()=>void saveExcel()}>{saving?'Menyimpan…':'✓ Terapkan & Simpan Excel'}</button></div>
      </div>}
    </section>}
    {role === 'AM' && showPillars && <div className="piq-editor"><h4>Pengaturan nama 7 pilar</h4><div className="piq-pillar-grid">{pillarNames.map((name, i) => <label key={i}>Pilar {i + 1}<input maxLength={100} value={name} onChange={e => setPillarNames(previous => previous.map((v, j) => i === j ? e.target.value : v))}/></label>)}</div><div className="piq-buttons"><button type="button" onClick={() => setShowPillars(false)}>Batal</button><button type="button" className="piq-yellow" disabled={saving} onClick={() => void savePillars()}>{saving ? 'Menyimpan...' : 'Simpan Nama Pilar'}</button></div></div>}
    {role === 'AM' && showForm && <form className="piq-editor" onSubmit={e => void save(e)}>
      <h4>Input / Edit Audit PIQ</h4>
      <div className="piq-formtop"><label>Bulan audit<select value={editMonth} onChange={e => edit(Number(e.target.value))}>{monthNames.map((name, i) => <option key={name} value={i + 1}>{name}</option>)}</select></label><div><span>Outlet · Tahun</span><strong>{outletName} · {year}</strong></div></div>
      <div className="piq-pillar-grid">{scoreKeys.map((key, i) => <label key={key}>{pillarName(i)}<select value={scores[i]} required onChange={e => setScores(previous => previous.map((v, j) => i === j ? e.target.value : v))}><option value="">Pilih grade</option><option value="2">A — 2 poin</option><option value="1">B — 1 poin</option><option value="0">C — 0 poin</option></select></label>)}</div>
      <label>Catatan hasil audit<textarea rows={3} maxLength={2000} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Temuan audit dan arahan perbaikan (opsional)"/></label>
      <p className="piq-preview">Total: <strong>{scores.every(v => ['0','1','2'].includes(v)) ? `${scores.reduce((v, n) => v + Number(n), 0)} / 14 (${percentage(scores.reduce((v, n) => v + Number(n), 0))})` : 'Lengkapi 7 pilar'}</strong></p>
      <div className="piq-buttons"><button type="button" onClick={() => setShowForm(false)}>Batal</button><button type="submit" className="piq-yellow" disabled={saving}>{saving ? 'Menyimpan...' : 'Simpan / Edit Audit'}</button></div>
    </form>}
    <div className="piq-kpis">
      <div><span>Rata-rata achievement</span><strong>{audited ? percentage(avgScore) : '—'}</strong><small>Rata-rata bulan yang sudah diaudit</small></div>
      <div><span>Bulan sudah diaudit</span><strong>{audited} / 12</strong><small>Jumlah bulan dengan hasil audit</small></div>
      <div><span>Bulan mendapatkan reward</span><strong>{rewardMonths} bulan</strong><small>Reward untuk skor 9–14</small></div>
    </div>
    <div className="piq-table-wrap"><table><thead><tr><th>Bulan</th>{scoreKeys.map((key, i) => <th key={key} className="piq-pillar-heading" title={pillarName(i)}>{pillarName(i)}</th>)}<th>Total</th><th>Achievement</th><th>Reward</th><th>Catatan AM</th><th>Update Terakhir</th>{role === 'AM' && <th>Aksi</th>}</tr></thead>
      <tbody>{loading ? <tr><td colSpan={role === 'AM' ? 14 : 13} className="piq-empty">Memuat PIQ tahunan...</td></tr> : monthNames.map((monthName, i) => {
        const record = byMonth.get(i + 1)
        return <tr key={i}><td className="piq-month"><strong>{monthName}</strong></td>{scoreKeys.map(key => <td key={key}>{record ? <span className={`piq-grade piq-grade-${grade(record[key]).toLowerCase()}`}>{grade(record[key])} · {record[key]}</span> : <span className="piq-unfilled">—</span>}</td>)}<td><strong>{record ? `${sum(record)} / 14` : '—'}</strong></td><td><strong>{record ? percentage(sum(record)) : '—'}</strong></td><td>{record ? <span className={sum(record) >= 9 ? 'piq-reward-yes' : 'piq-reward-no'}>{sum(record) >= 9 ? 'Dapat' : 'Tidak'}</span> : '—'}</td><td className="piq-notes">{record?.notes || '—'}</td><td>{record ? new Date(record.updated_at).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}</td>{role === 'AM' && <td><button type="button" className="piq-small-edit" onClick={() => edit(i + 1)}>{record ? 'Edit' : 'Input'}</button></td>}</tr>
      })}</tbody></table></div>
  </section></div>
}
