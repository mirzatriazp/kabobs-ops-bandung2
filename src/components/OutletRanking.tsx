import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import './OutletRanking.css'

type Outlet = { id: string; outlet_code: string; outlet_name: string }
type Props = { role: 'AM' | 'LEADER'; outletId: string; outlets: Outlet[]; month: number; year: number }
type Metric = 'sales' | 'piq' | 'membership'
type RankingRow = { outlet_id: string; outlet_name: string; achievement: number | string | null; updated_at: string | null }
const months = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember']
const metrics: { key: Metric; label: string; unit: string }[] = [
  { key: 'sales', label: 'Sales MTD', unit: 'Rp' },
  { key: 'piq', label: 'PIQ Performance', unit: 'poin' },
  { key: 'membership', label: 'Membership', unit: 'member' }
]
const formattedNumber = (value: number) => value.toLocaleString('id-ID')
// Field Sales MTD ditampilkan dengan titik ribuan, tetapi state tetap digit mentah.
const formatThousandsInput = (value: string) => value ? value.replace(/\B(?=(\d{3})+(?!\d))/g, '.') : ''

export default function OutletRanking({ role, outlets, month, year }: Props) {
  const [metric, setMetric] = useState<Metric>('sales')
  const [records, setRecords] = useState<RankingRow[]>([])
  const [allRankedOutlets, setAllRankedOutlets] = useState<{ id: string; outlet_name: string }[]>([])
  const [form, setForm] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [showEditor, setShowEditor] = useState(false)
  const [generalNote, setGeneralNote] = useState('')
  const [noteDraft, setNoteDraft] = useState('')
  const [editingNote, setEditingNote] = useState(false)
  const [savingNote, setSavingNote] = useState(false)
  const monthName = months[month - 1] || String(month)
  const metricInfo = metrics.find(m => m.key === metric) || metrics[0]

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    // RPC khusus mengembalikan delapan outlet & nilai ranking untuk semua user aktif.
    // Tidak bergantung pada props `outlets`, yang dapat berisi hanya outlet Leader.
    const { data, error: err } = await supabase.rpc('ops_rankings_manual_overview_v2', {
      p_year: year, p_month: month, p_metric: metric
    })
    if (err) {
      setError('Gagal mengambil peringkat: ' + err.message + '. Jalankan SQL 19_outlet_rankings_overview_v2.sql terlebih dahulu.')
    } else {
      const result = (data || []) as RankingRow[]
      if (result.length < 8) {
        setError(`Sumber ranking hanya mengembalikan ${result.length} dari 8 outlet. Pastikan SQL 19 dijalankan pada project Supabase yang dipakai website. Jika tetap terjadi, kirim screenshot pesan ini.`)
      }
      setAllRankedOutlets(result.map(r => ({ id: r.outlet_id, outlet_name: r.outlet_name })))
      setRecords(result.filter(r => r.achievement !== null))
      setForm(Object.fromEntries(result.filter(r => r.achievement !== null).map(r => [r.outlet_id, String(r.achievement)])))
    }
    setLoading(false)
  }, [year, month, metric])

  const loadNote = useCallback(async () => {
    const { data, error: noteError } = await supabase.from('ops_outlet_rankings_notes')
      .select('note').eq('period_year', year).eq('period_month', month).maybeSingle()
    if (noteError) { setError('Gagal memuat Notes General: ' + noteError.message); return }
    const text = typeof data?.note === 'string' ? data.note : ''
    setGeneralNote(text)
    setNoteDraft(text)
    setEditingNote(false)
  }, [year, month])

  useEffect(() => { void load() }, [load])
  useEffect(() => { void loadNote() }, [loadNote])
  useEffect(() => { setShowEditor(false); setMessage('') }, [metric, month, year])

  const ranked = useMemo(() => {
    return records.map(r => ({
      ...r, value: Number(r.achievement), name: r.outlet_name
    })).sort((a, b) => b.value - a.value || a.name.localeCompare(b.name, 'id'))
  }, [records])
  const unrankedOutlets = useMemo(() => allRankedOutlets.filter(o => !records.some(r => r.outlet_id === o.id)), [allRankedOutlets, records])
  const lastUpdated = ranked.reduce<string | null>((latest, r) => (r.updated_at && (!latest || r.updated_at > latest)) ? r.updated_at : latest, null)

  const saveNote = async () => {
    if (role !== 'AM' || savingNote) return
    setSavingNote(true)
    setError('')
    const { error: noteError } = await supabase.from('ops_outlet_rankings_notes')
      .upsert({ period_year: year, period_month: month, note: noteDraft.trim() },
        { onConflict: 'period_year,period_month' })
    if (noteError) setError('Gagal menyimpan Notes General: ' + noteError.message)
    else { setGeneralNote(noteDraft.trim()); setEditingNote(false); setMessage('Notes General berhasil disimpan.') }
    setSavingNote(false)
  }

  const formatValue = (v: number) => metric === 'sales' ? `Rp ${formattedNumber(v)}` : `${formattedNumber(v)} ${metricInfo.unit}`
  const updateForm = (id: string, value: string) => {
    setMessage('')
    setForm(prev => ({ ...prev, [id]: value }))
  }

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (role !== 'AM' || saving || loading) return
    const toUpsert: { outlet_id: string; period_year: number; period_month: number; metric: Metric; achievement: number }[] = []
    const toDelete: string[] = []
    for (const outlet of outlets) {
      const raw = (form[outlet.id] ?? '').trim()
      const existing = records.find(r => r.outlet_id === outlet.id)
      if (raw === '') {
        if (existing) toDelete.push(outlet.id)
        continue
      }
      const n = Number(raw)
      if (!/^\d+$/.test(raw) || !Number.isSafeInteger(n) || (metric === 'piq' && n > 14)) {
        setError(`Nilai ${outlet.outlet_name} tidak valid. Gunakan bilangan bulat ${metric === 'piq' ? '0–14' : 'non-negatif'} tanpa tanda titik/koma.`)
        return
      }
      if (!existing || Number(existing.achievement) !== n) {
        toUpsert.push({ outlet_id: outlet.id, period_year: year, period_month: month, metric, achievement: n })
      }
    }
    if (toUpsert.length === 0 && toDelete.length === 0) { setMessage('Tidak ada perubahan nilai.'); return }
    setSaving(true)
    setError('')
    setMessage('')
    if (toUpsert.length) {
      const { error: err } = await supabase.from('ops_outlet_rankings_manual').upsert(toUpsert,
        { onConflict: 'outlet_id,period_year,period_month,metric' })
      if (err) {
        setSaving(false)
        setError('Gagal menyimpan nilai: ' + err.message)
        return
      }
    }
    if (toDelete.length) {
      const { error: err } = await supabase.from('ops_outlet_rankings_manual').delete()
        .eq('period_year', year).eq('period_month', month).eq('metric', metric).in('outlet_id', toDelete)
      if (err) {
        setSaving(false)
        setError('Nilai baru tersimpan, tetapi gagal menghapus nilai yang dikosongkan: ' + err.message)
        await load()
        return
      }
    }
    await load()
    setShowEditor(false)
    setMessage('Pencapaian berhasil diperbarui. Peringkat otomatis diurutkan dari terbesar ke terkecil.')
    setSaving(false)
  }

  return <section className="okr-root">
    <header className="okr-header">
      <div>
        <h3>Peringkat Outlet — Area Bandung 2</h3>
        <p>{monthName} {year} · Pencapaian yang diinput Area Manager</p>
      </div>
      <button type="button" onClick={() => { void load(); void loadNote() }} disabled={loading || saving || savingNote}>↻ Refresh</button>
    </header>

    {(generalNote || role === 'AM') && <div className="okr-general-note">
      <div className="okr-general-note-heading">
        {role === 'AM' && !editingNote && <button type="button" onClick={() => { setNoteDraft(generalNote); setEditingNote(true) }}>✎ {generalNote ? 'Edit Notes' : 'Isi Notes'}</button>}
      </div>
      {role === 'AM' && editingNote ? <div className="okr-note-editor">
        <textarea value={noteDraft} maxLength={2000} rows={3} onChange={e => setNoteDraft(e.target.value)}
          placeholder="Contoh: PERIODE 1–15 NOVEMBER 2026" aria-label="Notes General Peringkat Outlet" />
        <div className="okr-note-actions">
          <button type="button" onClick={() => { setEditingNote(false); setNoteDraft(generalNote) }} disabled={savingNote}>Batal</button>
          <button className="okr-primary" type="button" disabled={savingNote} onClick={() => void saveNote()}>{savingNote ? 'Menyimpan…' : 'Simpan Notes'}</button>
        </div>
      </div> : <p className="okr-note-text">{generalNote || (role === 'AM' ? 'Belum ada catatan. Klik Isi Notes untuk menambahkan periode informasi.' : 'Belum ada informasi periode dari AM.')}</p>}
    </div>}

    <div className="okr-tabs" role="tablist" aria-label="Kategori peringkat">
      {metrics.map(m => <button type="button" key={m.key} role="tab" aria-selected={metric === m.key}
        className={metric === m.key ? 'active' : ''} onClick={() => setMetric(m.key)}>{m.label}</button>)}
    </div>

    {error && <div className="okr-error" role="alert">{error}</div>}
    {message && <div className="okr-success" role="status">{message}</div>}

    <div className="okr-toolbar">
      <div>
        <strong>{metricInfo.label}</strong>
        <p>{ranked.length} dari {allRankedOutlets.length || 8} outlet memiliki data{lastUpdated ? ` · Pembaruan terakhir ${new Date(lastUpdated).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} WIB` : ''}</p>
      </div>
      {role === 'AM' && <button type="button" className="okr-primary" onClick={() => setShowEditor(s => !s)}>
        {showEditor ? 'Tutup Input' : '+ Input / Update Pencapaian'}
      </button>}
    </div>

    {showEditor && role === 'AM' && <form className="okr-form" onSubmit={e => void save(e)}>
      <strong>Input {metricInfo.label} — {monthName} {year}</strong>
      <p>Isi pencapaian kumulatif terbaru per outlet. Kosongkan nilai untuk menghapusnya dari ranking. Nilai 0 tetap diperbolehkan.</p>
      <div className="okr-entry-list">
        {outlets.map(o => <label key={o.id}>
          <span>{o.outlet_name}</span>
          <div className="okr-input-group">
            {metric === 'sales' && <span>Rp</span>}
            <input
              type={metric === 'piq' ? 'number' : 'text'}
              inputMode="numeric"
              min={metric === 'piq' ? '0' : undefined}
              max={metric === 'piq' ? '14' : undefined}
              step={metric === 'piq' ? '1' : undefined}
              value={metric === 'piq' ? (form[o.id] ?? '') : formatThousandsInput(form[o.id] ?? '')}
              onChange={e => updateForm(o.id, metric === 'piq' ? e.target.value : e.target.value.replace(/\D/g, ''))}
              placeholder={metric === 'sales' ? '100.000.000' : metric === 'piq' ? '14' : '1.202'}
              aria-label={`Pencapaian ${metricInfo.label} ${o.outlet_name}`}
            />
            {metric !== 'sales' && <span>{metric === 'piq' ? 'poin' : 'member'}</span>}
          </div>
        </label>)}
      </div>
      <button className="okr-primary" type="submit" disabled={saving || loading}>{saving ? 'Menyimpan…' : 'Simpan Semua Perubahan'}</button>
    </form>}

    <div className="okr-table-wrap">
      <table className="okr-table">
        <thead><tr><th>Peringkat</th><th>Outlet</th><th>Pencapaian</th></tr></thead>
        <tbody>
          {loading ? <tr><td colSpan={3}>Memuat peringkat...</td></tr>
            : ranked.map((r, i) => <tr key={r.outlet_id}>
                <td><span className={i < 3 ? 'okr-rank top' : 'okr-rank'}>{i + 1}</span></td>
                <td><strong>{r.name}</strong></td>
                <td className="okr-value">{formatValue(r.value)}</td>
              </tr>)}
          {!loading && unrankedOutlets.map(o => <tr key={o.id} className="okr-not-entered">
            <td>—</td><td><strong>{o.outlet_name}</strong></td><td>Belum diinput</td>
          </tr>)}
        </tbody>
      </table>
    </div>
  </section>
}
