import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import './TemplateBA.css'

type Props = { role: 'AM' | 'LEADER' }
type Category = 'Operasional' | 'Inventory' | 'SDM' | 'Maintenance' | 'Lainnya'
type Template = {
  id: string
  title: string
  category: Category
  description: string
  extra_notes: string
  file_url: string
  is_active: boolean
  sort_order: number
  updated_at: string
}
const categories: Category[] = ['Operasional', 'Inventory', 'SDM', 'Maintenance', 'Lainnya']
type Draft = Pick<Template, 'title' | 'category' | 'description' | 'extra_notes' | 'file_url' | 'is_active' | 'sort_order'>
const blank: Draft = { title: '', category: 'Operasional', description: '', extra_notes: '', file_url: '', is_active: true, sort_order: 100 }

function validLink(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname.length > 0 && !url.username && !url.password
  } catch { return false }
}

export default function TemplateBA({ role }: Props) {
  const isAM = role === 'AM'
  const [items, setItems] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<Category | 'Semua'>('Semua')
  const [showInactive, setShowInactive] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [draft, setDraft] = useState<Draft>({ ...blank })

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    const { data, error: err } = await supabase.from('ops_ba_templates')
      .select('id,title,category,description,extra_notes,file_url,is_active,sort_order,updated_at')
      .order('sort_order', { ascending: true }).order('title', { ascending: true })
    if (err) setError(`Gagal memuat daftar template: ${err.message}`)
    else setItems((data ?? []) as Template[])
    setLoading(false)
  }, [])
  useEffect(() => { void load() }, [load])

  const visible = useMemo(() => items.filter(item =>
    (showInactive && isAM || item.is_active) &&
    (category === 'Semua' || item.category === category) &&
    `${item.title} ${item.description} ${item.extra_notes} ${item.category}`.toLocaleLowerCase('id-ID').includes(query.trim().toLocaleLowerCase('id-ID'))
  ), [items, showInactive, isAM, category, query])

  const openNew = () => { setDraft({ ...blank }); setEditingId(null); setFormOpen(true); setMessage(''); setError('') }
  const openEdit = (item: Template) => {
    setDraft({ title: item.title, category: item.category, description: item.description, extra_notes: item.extra_notes || '', file_url: item.file_url, is_active: item.is_active, sort_order: item.sort_order })
    setEditingId(item.id); setFormOpen(true); setError(''); setMessage('')
  }
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!isAM || saving) return
    const payload = {
      title: draft.title.trim(), category: draft.category,
      description: draft.description.trim(), extra_notes: draft.extra_notes.trim(), file_url: draft.file_url.trim(),
      is_active: draft.is_active, sort_order: Number(draft.sort_order)
    }
    if (payload.title.length < 3) { setError('Nama template minimal 3 karakter.'); return }
    if (!validLink(payload.file_url)) { setError('Gunakan URL HTTPS lengkap, contoh: https://drive.google.com/file/d/...'); return }
    if (!Number.isInteger(payload.sort_order) || payload.sort_order < 0 || payload.sort_order > 99999) { setError('Urutan harus angka 0 sampai 99999.'); return }
    setSaving(true); setError(''); setMessage('')
    const { error: err } = editingId
      ? await supabase.from('ops_ba_templates').update(payload).eq('id', editingId)
      : await supabase.from('ops_ba_templates').insert(payload)
    if (err) setError(`Gagal menyimpan template: ${err.message}`)
    else { setMessage(editingId ? 'Template berhasil diperbarui.' : 'Template berhasil ditambahkan.'); setFormOpen(false); setEditingId(null); await load() }
    setSaving(false)
  }
  const remove = async (item: Template) => {
    if (!isAM || saving || !window.confirm(`Hapus template "${item.title}" dari daftar? File di tautan asli tidak akan dihapus.`)) return
    setSaving(true); setError(''); setMessage('')
    const { error: err } = await supabase.from('ops_ba_templates').delete().eq('id', item.id)
    if (err) setError(`Gagal menghapus template: ${err.message}`)
    else { setMessage('Template dihapus dari daftar. File sumber tetap ada.'); await load() }
    setSaving(false)
  }
  return (
    <section className="tba-root">
      <div className="tba-heading">
        <div><h3>Template BA — Area Bandung 2</h3><p>Pilih dan unduh template Berita Acara atau dokumen operasional melalui tautan yang disediakan AM.</p></div>
        <div className="tba-actions"><button type="button" onClick={() => void load()} disabled={loading}>↻ Refresh</button>{isAM && <button type="button" className="tba-primary" onClick={openNew}>+ Tambah Template</button>}</div>
      </div>
      {error && <div role="alert" className="tba-alert tba-error">{error}</div>}
      {message && <div role="status" className="tba-alert tba-success">{message}</div>}
      {isAM && formOpen && <form className="tba-form" onSubmit={event => void save(event)}>
        <div className="tba-form-header"><strong>{editingId ? 'Edit Template' : 'Tambah Template Baru'}</strong><button type="button" onClick={() => setFormOpen(false)}>Tutup</button></div>
        <div className="tba-fields">
          <label>Nama dokumen<input required minLength={3} maxLength={160} value={draft.title} onChange={e => setDraft(d => ({ ...d, title: e.target.value }))} placeholder="Contoh: BA Selisih Stock Opname"/></label>
          <label>Kategori<select value={draft.category} onChange={e => setDraft(d => ({ ...d, category: e.target.value as Category }))}>{categories.map(c => <option key={c}>{c}</option>)}</select></label>
          <label className="tba-wide">URL template (HTTPS)<input required type="url" maxLength={2000} value={draft.file_url} onChange={e => setDraft(d => ({ ...d, file_url: e.target.value }))} placeholder="https://drive.google.com/..."/></label>
          <label className="tba-wide">Deskripsi dokumen (tampil di bawah nama BA)<textarea rows={2} maxLength={1000} value={draft.description} onChange={e => setDraft(d => ({ ...d, description: e.target.value }))} placeholder="Contoh: Digunakan saat ada selisih item PCS dalam 1 pack"/></label>
          <label className="tba-wide">Catatan tambahan AM (kolom paling kanan, opsional)<textarea rows={2} maxLength={1000} value={draft.extra_notes} onChange={e => setDraft(d => ({ ...d, extra_notes: e.target.value }))} placeholder="Contoh: Approval AM, RM, HR"/></label>
          <label>Urutan tampil<input type="number" min={0} max={99999} value={draft.sort_order} onChange={e => setDraft(d => ({ ...d, sort_order: Number(e.target.value) }))}/></label>
          <label>Status<select value={draft.is_active ? 'active' : 'hidden'} onChange={e => setDraft(d => ({ ...d, is_active: e.target.value === 'active' }))}><option value="active">Aktif — terlihat Leader</option><option value="hidden">Nonaktif — disembunyikan</option></select></label>
        </div>
        <div className="tba-form-actions"><button type="submit" className="tba-primary" disabled={saving}>{saving ? 'Menyimpan...' : 'Simpan Template'}</button></div>
      </form>}
      <div className="tba-filters">
        <label>Cari template<input value={query} onChange={e => setQuery(e.target.value)} placeholder="Nama atau keterangan..."/></label>
        <label>Kategori<select value={category} onChange={e => setCategory(e.target.value as Category | 'Semua')}><option value="Semua">Semua kategori</option>{categories.map(c => <option key={c}>{c}</option>)}</select></label>
        {isAM && <label className="tba-check"><input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)}/> Tampilkan nonaktif</label>}
      </div>
      <div className="tba-table-wrap"><table className="tba-table">
        <colgroup>
          <col className="tba-col-document" />
          <col className="tba-col-category" />
          <col className="tba-col-updated" />
          <col className="tba-col-link" />
          <col className="tba-col-description" />
          {isAM && <col className="tba-col-actions" />}
        </colgroup>
        <thead><tr><th>Dokumen</th><th>Kategori</th><th>Update</th><th>Link Template</th><th>Catatan Tambahan AM</th>{isAM && <th>Aksi AM</th>}</tr></thead><tbody>
        {loading ? <tr><td colSpan={isAM ? 6 : 5} className="tba-empty">Memuat template...</td></tr>
          : visible.length === 0 ? <tr><td colSpan={isAM ? 6 : 5} className="tba-empty">Belum ada template yang sesuai. {isAM ? 'Klik Tambah Template untuk membuat daftar baru.' : 'Hubungi AM jika membutuhkan dokumen.'}</td></tr>
          : visible.map(item => <tr key={item.id}>
            <td><strong>{item.title}</strong>{item.description && <small>{item.description}</small>}{!item.is_active && <span className="tba-inactive">Nonaktif</span>}</td>
            <td>{item.category}</td><td>{new Date(item.updated_at).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Jakarta' })}</td>
            <td><a className="tba-download" href={item.file_url} target="_blank" rel="noopener noreferrer">Buka / Unduh ↗</a></td>
            <td className="tba-desc-cell">{item.extra_notes || '—'}</td>
            {isAM && <td className="tba-row-actions"><button type="button" disabled={saving} onClick={() => openEdit(item)}>Edit</button><button type="button" className="tba-danger" disabled={saving} onClick={() => void remove(item)}>Hapus</button></td>}
          </tr>)}
      </tbody></table></div>
      <p className="tba-note">Buka link URL, download template → buat berita acara di POS Outlet → simpan PDF dan kirim PDF ke AM untuk approval</p>
    </section>
  )
}
