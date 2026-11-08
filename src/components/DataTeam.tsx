import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import './DataTeam.css'

type Outlet = { id: string; outlet_code: string; outlet_name: string }
type Props = { role: 'AM' | 'LEADER'; outletId: string; outlets: Outlet[] }
type Availability = 'Ada' | 'Belum ada' | 'Tidak berlaku'
type Headwear = 'Ada' | 'Tidak Ada' | 'Hijab'
type Qty = 0 | 1 | 2
type UniformSize = '' | 'XS' | 'S' | 'M' | 'L' | 'XL' | 'XXL' | 'XXXL'
type Member = {
  id: string; outlet_id: string; nik: string; full_name: string; job_title: string;
  joined_at: string; employment_status: 'Aktif' | 'Nonaktif';
  chef_uniform_qty: Qty; chef_uniform_size: UniformSize | null;
  polo_uniform_qty: Qty; polo_uniform_size: UniformSize | null;
  apron: Availability; name_tag: Availability; headwear: Headwear;
  notes: string; sort_order: number | null; created_at: string; updated_at: string
}
type Editor = Omit<Member, 'id' | 'sort_order' | 'created_at' | 'updated_at'>
const NEW = (outletId = ''): Editor => ({
  outlet_id: outletId, nik: '', full_name: '', job_title: 'Crew', joined_at: '',
  employment_status: 'Aktif', chef_uniform_qty: 0, chef_uniform_size: '',
  polo_uniform_qty: 0, polo_uniform_size: '', apron: 'Belum ada',
  name_tag: 'Belum ada', headwear: 'Tidak Ada', notes: ''
})
const STATUS: Availability[] = ['Ada', 'Belum ada', 'Tidak berlaku']
const HEADWEAR: Headwear[] = ['Ada', 'Tidak Ada', 'Hijab']
const SIZES: UniformSize[] = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL']
const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']
const uniformTotal = (m: Pick<Member, 'chef_uniform_qty' | 'polo_uniform_qty'>) => Number(m.chef_uniform_qty || 0) + Number(m.polo_uniform_qty || 0)
type OutletPosition = { outlet_id: string; sort_order: number }
const leaderFirst = (job: string) => /\b(leader|kepala outlet|store leader|shift leader)\b/i.test(job) ? 0 : 1
function seniorityCompare(a: Member, b: Member) {
  const rank = leaderFirst(a.job_title) - leaderFirst(b.job_title)
  if (rank) return rank
  const date = (a.joined_at || '9999').localeCompare(b.joined_at || '9999')
  if (date) return date
  return a.full_name.localeCompare(b.full_name, 'id')
}
function orderCrew(list: Member[]) {
  const hasCustom = list.some(m => m.sort_order !== null && m.sort_order !== undefined)
  return [...list].sort((a, b) => {
    if (hasCustom) {
      const position = (a.sort_order ?? Number.MAX_SAFE_INTEGER) - (b.sort_order ?? Number.MAX_SAFE_INTEGER)
      if (position) return position
    }
    return seniorityCompare(a, b)
  })
}

function tenure(iso: string) {
  if (!iso) return '—'
  const d = new Date(iso + 'T12:00:00'), now = new Date()
  if (Number.isNaN(d.getTime()) || d > now) return '—'
  let y = now.getFullYear() - d.getFullYear(), m = now.getMonth() - d.getMonth()
  if (now.getDate() < d.getDate()) m--
  if (m < 0) { y--; m += 12 }
  return [y ? `${y} th` : '', m ? `${m} bln` : ''].filter(Boolean).join(' ') || '< 1 bulan'
}
function dateLabel(iso: string) {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-').map(Number)
  return `${d} ${MONTHS[m - 1] || ''} ${y}`
}
const fromMember = (m: Member): Editor => ({
  outlet_id: m.outlet_id, nik: m.nik, full_name: m.full_name, job_title: m.job_title,
  joined_at: m.joined_at, employment_status: m.employment_status,
  chef_uniform_qty: m.chef_uniform_qty ?? 0, chef_uniform_size: m.chef_uniform_size ?? '',
  polo_uniform_qty: m.polo_uniform_qty ?? 0, polo_uniform_size: m.polo_uniform_size ?? '',
  apron: m.apron, name_tag: m.name_tag, headwear: m.headwear || 'Tidak Ada', notes: m.notes || ''
})

export default function DataTeam({ role, outletId, outlets }: Props) {
  const [members, setMembers] = useState<Member[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<Editor>(() => NEW(outletId || outlets[0]?.id || ''))
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('Aktif')
  const [outletFilter, setOutletFilter] = useState('')
  const [outletPositions, setOutletPositions] = useState<OutletPosition[]>([])
  const [sortOpen, setSortOpen] = useState(false)
  const [sortOutletId, setSortOutletId] = useState('')
  const [sortSaving, setSortSaving] = useState(false)
  const nameById = useMemo(() => new Map(outlets.map(o => [o.id, o.outlet_name])), [outlets])
  const orderedOutlets = useMemo(() => [...outlets].sort((a, b) => {
    const ap = outletPositions.find(o => o.outlet_id === a.id)?.sort_order ?? Number.MAX_SAFE_INTEGER
    const bp = outletPositions.find(o => o.outlet_id === b.id)?.sort_order ?? Number.MAX_SAFE_INTEGER
    return ap - bp || a.outlet_name.localeCompare(b.outlet_name, 'id')
  }), [outlets, outletPositions])
  const load = useCallback(async () => {
    setLoading(true); setError('')
    let query = supabase.from('ops_team_members').select('*').limit(1000)
    if (role === 'LEADER') {
      if (!outletId) { setMembers([]); setLoading(false); return }
      query = query.eq('outlet_id', outletId)
    }
    const [memberResult, orderingResult] = await Promise.all([query, supabase.from('ops_team_outlet_order').select('outlet_id,sort_order')])
    const { data, error: e } = memberResult
    if (orderingResult.error) { setError(`Gagal membaca urutan outlet: ${orderingResult.error.message}`) }
    else setOutletPositions((orderingResult.data || []) as OutletPosition[])
    if (e) setError(`Gagal memuat Data Team: ${e.message}`)
    else setMembers((data || []) as Member[])
    setLoading(false)
  }, [role, outletId])
  useEffect(() => { void load() }, [load])
  const visible = useMemo(() => {
    const list = members.filter(p => {
      const own = role === 'AM' ? (outletFilter ? p.outlet_id === outletFilter : outletId ? p.outlet_id === outletId : true) : p.outlet_id === outletId
      const status = statusFilter === 'Semua' || p.employment_status === statusFilter
      const term = search.trim().toLowerCase()
      return own && status && (!term || [p.full_name, p.nik, p.job_title, nameById.get(p.outlet_id) || ''].some(v => v.toLowerCase().includes(term)))
    })
    const groupRank = new Map(orderedOutlets.map((o, i) => [o.id, i]))
    const grouped = new Map<string, Member[]>()
    for (const item of list) grouped.set(item.outlet_id, [...(grouped.get(item.outlet_id) || []), item])
    return [...grouped.entries()]
      .sort(([a], [b]) => (groupRank.get(a) ?? 999) - (groupRank.get(b) ?? 999))
      .flatMap(([, crew]) => orderCrew(crew))
  }, [members, role, outletId, outletFilter, statusFilter, search, nameById, orderedOutlets])
  const reorderOutlets = async (at: number, step: number) => {
    if (role !== 'AM' || sortSaving) return
    const copy = [...orderedOutlets], destination = at + step
    if (destination < 0 || destination >= copy.length) return
    ;[copy[at], copy[destination]] = [copy[destination], copy[at]]
    setSortSaving(true); setError(''); setMessage('')
    const { error: e } = await supabase.rpc('ops_team_reorder_outlets', { p_ids: copy.map(o => o.id) })
    if (e) setError(`Gagal menyimpan urutan outlet: ${e.message}`)
    else { setMessage('Urutan outlet tersimpan untuk AM dan Leader.'); await load() }
    setSortSaving(false)
  }
  const reorderCrew = async (at: number, step: number) => {
    if (role !== 'AM' || sortSaving || !sortOutletId) return
    const list = orderCrew(members.filter(m => m.outlet_id === sortOutletId))
    const destination = at + step
    if (destination < 0 || destination >= list.length) return
    ;[list[at], list[destination]] = [list[destination], list[at]]
    setSortSaving(true); setError(''); setMessage('')
    const { error: e } = await supabase.rpc('ops_team_reorder_crew', { p_outlet_id: sortOutletId, p_ids: list.map(m => m.id) })
    if (e) setError(`Gagal menyimpan urutan crew: ${e.message}`)
    else { setMessage('Urutan crew tersimpan dan tampil juga pada akun Leader.'); await load() }
    setSortSaving(false)
  }
  const resetCrewOrder = async () => {
    if (role !== 'AM' || sortSaving || !sortOutletId) return
    setSortSaving(true); setError(''); setMessage('')
    const { error: e } = await supabase.rpc('ops_team_reset_crew_order', { p_outlet_id: sortOutletId })
    if (e) setError(`Gagal reset urutan: ${e.message}`)
    else { setMessage('Kembali ke urutan default: Leader → masa kerja terlama.'); await load() }
    setSortSaving(false)
  }
  const activeCount = visible.filter(m => m.employment_status === 'Aktif').length
  const missingAttributes = visible.filter(m => m.employment_status === 'Aktif' && (uniformTotal(m) === 0 || m.apron === 'Belum ada' || m.name_tag === 'Belum ada' || m.headwear === 'Tidak Ada')).length
  const setField = <K extends keyof Editor>(k: K, value: Editor[K]) => setForm(f => ({ ...f, [k]: value }))
  const beginCreate = () => {
    setError(''); setMessage(''); setEditingId(null)
    setForm(NEW(outletFilter || outletId || outlets[0]?.id || '')); setEditorOpen(true)
  }
  const beginEdit = (m: Member) => {
    setError(''); setMessage(''); setEditingId(m.id)
    setForm(fromMember(m)); setEditorOpen(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const save = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); if (role !== 'AM' || saving) return
    setError(''); setMessage('')
    if (!form.outlet_id || !form.nik.trim() || !form.full_name.trim() || !form.job_title.trim() || !form.joined_at) {
      setError('Outlet, NIK, nama, jabatan, dan tanggal bergabung wajib diisi.'); return
    }
    if (form.joined_at > new Date().toISOString().slice(0, 10)) {
      setError('Tanggal bergabung tidak boleh di masa depan.'); return
    }
    if ((form.chef_uniform_qty > 0 && !form.chef_uniform_size) || (form.polo_uniform_qty > 0 && !form.polo_uniform_size)) {
      setError('Pilih ukuran untuk setiap jenis seragam yang jumlahnya lebih dari 0.'); return
    }
    setSaving(true)
    const payload = {
      ...form, nik: form.nik.trim(), full_name: form.full_name.trim(),
      job_title: form.job_title.trim(), notes: form.notes.trim(),
      chef_uniform_size: form.chef_uniform_qty ? form.chef_uniform_size : null,
      polo_uniform_size: form.polo_uniform_qty ? form.polo_uniform_size : null
    }
    const result = editingId
      ? await supabase.from('ops_team_members').update(payload).eq('id', editingId).select('id').single()
      : await supabase.from('ops_team_members').insert(payload).select('id').single()
    setSaving(false)
    if (result.error) {
      setError(result.error.code === '23505' ? 'NIK sudah terdaftar. Periksa data crew yang sudah ada.' : result.error.message)
      return
    }
    setMessage(editingId ? 'Data crew berhasil diperbarui.' : 'Data crew berhasil ditambahkan.')
    setEditorOpen(false); setEditingId(null); await load()
  }
  return <section className="dt-root">
    <div className="dt-head"><div><h3>Data Team — Area Bandung 2</h3><p>Data crew, masa kerja, jumlah seragam, dan kelengkapan atribut per outlet.</p></div><div className="dt-actions"><button type="button" className="dt-btn dt-secondary" onClick={() => void load()}>↻ Refresh</button>{role === 'AM' && <><button type="button" className="dt-btn dt-primary" onClick={beginCreate}>+ Tambah crew</button><button type="button" className="dt-btn dt-secondary" onClick={() => { setSortOpen(o => !o); setSortOutletId(current => current || orderedOutlets[0]?.id || '') }}>{sortOpen ? 'Tutup Urutan' : '⚙ Atur Urutan'}</button></>}</div></div>
    {message && <div className="dt-msg dt-ok" role="status">{message}</div>}
    {error && <div className="dt-msg dt-error" role="alert">{error}</div>}
    {role === 'AM' && sortOpen && <div className="dt-sort-panel">
      <div className="dt-sort-panel-header"><div><h4>Atur Susunan Data Team</h4><p>Default: tiap outlet dikelompokkan; Leader pertama, kemudian crew berdasarkan join date paling lama. Tombol panah menyimpan urutan khusus untuk semua pengguna.</p></div></div>
      <div className="dt-sort-columns">
        <div className="dt-sort-col"><strong>Urutan outlet</strong>
          {orderedOutlets.map((o, i) => <div className="dt-sort-row" key={o.id}><span>{i + 1}. {o.outlet_name}</span><div className="dt-sort-arrows"><button type="button" title="Naikkan outlet" disabled={sortSaving || i === 0} onClick={() => void reorderOutlets(i, -1)}>↑</button><button type="button" title="Turunkan outlet" disabled={sortSaving || i === orderedOutlets.length - 1} onClick={() => void reorderOutlets(i, 1)}>↓</button></div></div>)}
        </div>
        <div className="dt-sort-col"><label>Urutan crew per outlet<select value={sortOutletId} onChange={e => setSortOutletId(e.target.value)}>{orderedOutlets.map(o => <option key={o.id} value={o.id}>{o.outlet_name}</option>)}</select></label>
          {orderCrew(members.filter(m => m.outlet_id === sortOutletId)).map((m, i, list) => <div className="dt-sort-row" key={m.id}><span>{i + 1}. <strong>{m.full_name}</strong><small>{m.job_title} · {dateLabel(m.joined_at)}</small></span><div className="dt-sort-arrows"><button type="button" title="Naikkan crew" disabled={sortSaving || i === 0} onClick={() => void reorderCrew(i, -1)}>↑</button><button type="button" title="Turunkan crew" disabled={sortSaving || i === list.length - 1} onClick={() => void reorderCrew(i, 1)}>↓</button></div></div>)}
          <button type="button" className="dt-btn dt-secondary dt-reset" disabled={sortSaving || !sortOutletId} onClick={() => void resetCrewOrder()}>Reset: Leader → masa kerja</button>
        </div>
      </div>
    </div>}
    {role === 'AM' && editorOpen && <form className="dt-editor" onSubmit={e => void save(e)}>
      <div className="dt-editor-head"><h4>{editingId ? 'Edit Data Crew' : 'Tambah Data Crew'}</h4><button type="button" className="dt-btn dt-secondary" onClick={() => setEditorOpen(false)}>Tutup</button></div>
      <div className="dt-form-grid">
        <label>Outlet<select value={form.outlet_id} disabled={!!editingId} onChange={e => setField('outlet_id', e.target.value)} required><option value="">Pilih outlet</option>{orderedOutlets.map(o => <option key={o.id} value={o.id}>{o.outlet_name}</option>)}</select></label>
        <label>NIK<input value={form.nik} onChange={e => setField('nik', e.target.value)} maxLength={40} required placeholder="NIK karyawan" /></label>
        <label>Nama Lengkap<input value={form.full_name} onChange={e => setField('full_name', e.target.value)} maxLength={160} required placeholder="Nama crew" /></label>
        <label>Jabatan<input value={form.job_title} onChange={e => setField('job_title', e.target.value)} maxLength={100} required placeholder="Crew / Leader / Kasir" /></label>
        <label>Tanggal bergabung<input type="date" value={form.joined_at} max={new Date().toISOString().slice(0, 10)} onChange={e => setField('joined_at', e.target.value)} required /></label>
        <label>Status kerja<select value={form.employment_status} onChange={e => setField('employment_status', e.target.value as Editor['employment_status'])}><option value="Aktif">Aktif</option><option value="Nonaktif">Nonaktif</option></select></label>
        <div className="dt-uniform-heading dt-wide"><strong>Seragam</strong><span>Total baju seragam: <b>{uniformTotal(form)} pcs</b> (Chef + Polo)</span></div>
        <label>Seragam Chef — Jumlah<select value={form.chef_uniform_qty} onChange={e => setField('chef_uniform_qty', Number(e.target.value) as Qty)}>{[0, 1, 2].map(n => <option key={n} value={n}>{n}</option>)}</select></label>
        <label>Ukuran Seragam Chef<select value={form.chef_uniform_size || ''} disabled={form.chef_uniform_qty === 0} required={form.chef_uniform_qty > 0} onChange={e => setField('chef_uniform_size', e.target.value as UniformSize)}><option value="">{form.chef_uniform_qty === 0 ? 'Tidak diperlukan' : 'Pilih ukuran'}</option>{SIZES.map(s => <option key={s} value={s}>{s}</option>)}</select></label>
        <label>Seragam Polo — Jumlah<select value={form.polo_uniform_qty} onChange={e => setField('polo_uniform_qty', Number(e.target.value) as Qty)}>{[0, 1, 2].map(n => <option key={n} value={n}>{n}</option>)}</select></label>
        <label>Ukuran Seragam Polo<select value={form.polo_uniform_size || ''} disabled={form.polo_uniform_qty === 0} required={form.polo_uniform_qty > 0} onChange={e => setField('polo_uniform_size', e.target.value as UniformSize)}><option value="">{form.polo_uniform_qty === 0 ? 'Tidak diperlukan' : 'Pilih ukuran'}</option>{SIZES.map(s => <option key={s} value={s}>{s}</option>)}</select></label>
        <label>Apron<select value={form.apron} onChange={e => setField('apron', e.target.value as Availability)}>{STATUS.map(s => <option key={s} value={s}>{s}</option>)}</select></label>
        <label>Name Tag<select value={form.name_tag} onChange={e => setField('name_tag', e.target.value as Availability)}>{STATUS.map(s => <option key={s} value={s}>{s}</option>)}</select></label>
        <label>Topi<select value={form.headwear} onChange={e => setField('headwear', e.target.value as Headwear)}>{HEADWEAR.map(s => <option key={s} value={s}>{s}</option>)}</select></label>
        <label className="dt-wide">Catatan AM<textarea value={form.notes} onChange={e => setField('notes', e.target.value)} rows={2} maxLength={1000} placeholder="Catatan atribut atau kebutuhan kerja (opsional)" /></label>
      </div>
      <div className="dt-editor-foot"><button type="submit" disabled={saving} className="dt-btn dt-primary">{saving ? 'Menyimpan...' : editingId ? 'Simpan Perubahan' : 'Simpan Crew'}</button></div>
    </form>}
    <div className="dt-stats"><div><span>Jumlah crew ditampilkan</span><strong>{visible.length}</strong></div><div><span>Crew aktif</span><strong>{activeCount}</strong></div><div><span>Crew aktif dengan atribut belum lengkap</span><strong>{missingAttributes}</strong></div></div>
    <div className="dt-filters">
      {role === 'AM' && <label>Filter Outlet<select value={outletFilter} onChange={e => setOutletFilter(e.target.value)}><option value="">{outletId ? 'Semua pada pilihan halaman' : 'Semua Outlet'}</option>{orderedOutlets.map(o => <option key={o.id} value={o.id}>{o.outlet_name}</option>)}</select></label>}
      <label>Status<select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}><option value="Aktif">Aktif</option><option value="Nonaktif">Nonaktif</option><option value="Semua">Semua</option></select></label>
      <label className="dt-search">Cari crew<input value={search} onChange={e => setSearch(e.target.value)} placeholder="Nama, NIK, jabatan..." /></label>
    </div>
    <div className="dt-scroll" tabIndex={0} aria-label="Tabel data team dapat digeser horizontal"><table><thead><tr>{role === 'AM' && <th>Outlet</th>}<th>Nama</th><th>NIK</th><th>Jabatan</th><th>Join Date</th><th>Masa Kerja</th><th>Status</th><th>Total Baju</th><th>Chef (Pcs)</th><th>Ukuran Chef</th><th>Polo (Pcs)</th><th>Ukuran Polo</th><th>Apron</th><th>Name Tag</th><th>Topi</th><th>Catatan AM</th>{role === 'AM' && <th>Aksi</th>}</tr></thead><tbody>
      {visible.map(m => <tr key={m.id}>{role === 'AM' && <td className="dt-strong">{nameById.get(m.outlet_id) || '—'}</td>}<td className="dt-strong">{m.full_name}</td><td>{m.nik}</td><td>{m.job_title}</td><td>{dateLabel(m.joined_at)}</td><td>{tenure(m.joined_at)}</td><td><span className={'dt-tag ' + (m.employment_status === 'Aktif' ? 'dt-green' : 'dt-grey')}>{m.employment_status}</span></td><td className="dt-strong">{uniformTotal(m)}</td><td>{m.chef_uniform_qty ?? 0}</td><td>{m.chef_uniform_size || '—'}</td><td>{m.polo_uniform_qty ?? 0}</td><td>{m.polo_uniform_size || '—'}</td><td><span className={'dt-tag ' + (m.apron === 'Ada' ? 'dt-green' : m.apron === 'Belum ada' ? 'dt-yellow' : 'dt-grey')}>{m.apron}</span></td><td><span className={'dt-tag ' + (m.name_tag === 'Ada' ? 'dt-green' : m.name_tag === 'Belum ada' ? 'dt-yellow' : 'dt-grey')}>{m.name_tag}</span></td><td><span className={'dt-tag ' + (m.headwear === 'Ada' || m.headwear === 'Hijab' ? 'dt-green' : 'dt-yellow')}>{m.headwear || 'Tidak Ada'}</span></td><td className="dt-notes">{m.notes || '—'}</td>{role === 'AM' && <td><button type="button" className="dt-btn dt-secondary" onClick={() => beginEdit(m)}>Edit</button></td>}</tr>)}
      {!loading && visible.length === 0 && <tr><td colSpan={role === 'AM' ? 17 : 15} className="dt-empty">Belum ada data crew untuk filter ini.</td></tr>}
      {loading && <tr><td colSpan={role === 'AM' ? 17 : 15} className="dt-empty">Memuat data crew...</td></tr>}
    </tbody></table></div>
  </section>
}
