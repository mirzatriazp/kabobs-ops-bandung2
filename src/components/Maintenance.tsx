import { useCallback, useEffect, useState } from 'react'
import type { CSSProperties, FormEvent } from 'react'
import { supabase } from '../lib/supabase'

type Outlet = { id: string; outlet_name: string; outlet_code: string }
type Props = { role: 'AM' | 'LEADER'; outletId: string; outlets: Outlet[]; month: number; year: number }
type Status = 'pending_am' | 'coordinated' | 'in_progress' | 'done' | 'rejected'
type Request = {
  id: string; outlet_id: string; reported_by: string; category: string; equipment: string;
  problem: string; impact: string; priority: string; pic: string; photo_path: string | null;
  status: Status; am_verified: boolean; am_coordinated: boolean; am_notes: string | null;
  created_at: string; updated_at: string; completed_at: string | null
}
const statusLabels: Record<Status, string> = {
  pending_am: 'Menunggu AM', coordinated: 'Sudah dikoordinasikan',
  in_progress: 'Dalam perbaikan', done: 'Selesai', rejected: 'Ditolak / Perlu revisi',
}
const empty = { category: 'Equipment', equipment: '', problem: '', impact: '', priority: 'Medium', pic: '' }
const prettyDate = (x: string) => new Date(x).toLocaleDateString('id-ID', {day:'2-digit',month:'short',year:'numeric',timeZone:'Asia/Jakarta'})

export default function Maintenance({role,outletId,outlets,month,year}:Props) {
  const [items,setItems] = useState<Request[]>([])
  const [form,setForm] = useState(empty)
  const [file,setFile] = useState<File|null>(null)
  const [busy,setBusy] = useState(false)
  const [loading,setLoading] = useState(true)
  const [error,setError] = useState('')
  const [success,setSuccess] = useState('')
  const [showForm,setShowForm] = useState(false)
  const [selectedOutlet,setSelectedOutlet] = useState('')
  const [statusFilter,setStatusFilter] = useState('all')
  const [photoUrls,setPhotoUrls] = useState<Record<string,string>>({})
  const [updates,setUpdates] = useState<Record<string,{status:Status;am_verified:boolean;am_coordinated:boolean;am_notes:string}>>({})
  const currentOutlet = outletId || selectedOutlet

  const load = useCallback(async () => {
    setLoading(true);setError('')
    let q=supabase.from('maintenance_requests').select('*').order('created_at',{ascending:false}).limit(200)
    if(outletId) q=q.eq('outlet_id',outletId)
    const {data,error:err}=await q
    if(err) setError('Gagal memuat pengajuan: '+err.message)
    else {
      const rows=(data||[]) as Request[]
      setItems(rows)
      setUpdates(Object.fromEntries(rows.map(r=>[r.id,{
        status:r.status,am_verified:r.am_verified,am_coordinated:r.am_coordinated,am_notes:r.am_notes||''
      }])))
      const photos=rows.filter(r=>r.photo_path)
      const pairs=await Promise.all(photos.map(async r=>{
        const {data:link}=await supabase.storage.from('maintenance-photos').createSignedUrl(r.photo_path!,3600)
        return [r.id,link?.signedUrl||''] as const
      }))
      setPhotoUrls(Object.fromEntries(pairs))
    }
    setLoading(false)
  },[outletId])
  useEffect(()=>{void load()},[load])

  async function createRequest(e:FormEvent) {
    e.preventDefault();setError('');setSuccess('')
    if(!currentOutlet){setError('Pilih outlet terlebih dahulu.');return}
    if(file && (!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>5*1024*1024)){
      setError('Foto harus JPG, PNG, atau WEBP maksimal 5 MB.');return
    }
    setBusy(true)
    try {
      const {data:auth}=await supabase.auth.getUser()
      if(!auth.user) throw new Error('Sesi sudah berakhir. Silakan login kembali.')
      let photo_path: string|null=null
      if(file){
        const ext=file.type==='image/png'?'png':file.type==='image/webp'?'webp':'jpg'
        photo_path=`${currentOutlet}/${auth.user.id}/${crypto.randomUUID()}.${ext}`
        const {error:uploadError}=await supabase.storage.from('maintenance-photos')
          .upload(photo_path,file,{contentType:file.type,upsert:false})
        if(uploadError) throw new Error('Upload foto gagal: '+uploadError.message)
      }
      const {error:insertError}=await supabase.from('maintenance_requests').insert({
        outlet_id:currentOutlet,reported_by:auth.user.id, ...form,photo_path
      })
      if(insertError) throw new Error(insertError.message)
      setSuccess('Pengajuan diterima dan menunggu review Area Manager.')
      setShowForm(false);setForm(empty);setFile(null)
      await load()
    }catch(e){setError(e instanceof Error?e.message:'Pengajuan gagal disimpan')}
    finally{setBusy(false)}
  }

  async function saveReview(id:string){
    const update=updates[id]; if(!update) return
    setBusy(true);setError('');setSuccess('')
    const {error:err}=await supabase.from('maintenance_requests').update({
      status:update.status,am_verified:update.am_verified,
      am_coordinated:update.am_coordinated,am_notes:update.am_notes
    }).eq('id',id)
    if(err)setError('Gagal menyimpan review AM: '+err.message)
    else {setSuccess('Review AM berhasil diperbarui.');await load()}
    setBusy(false)
  }
  async function deleteRequest(request: Request) {
    if (role !== 'AM' || busy) return
    const confirmed = window.confirm(
      `Hapus pengajuan ${request.equipment} (${prettyDate(request.created_at)})?\n\nLaporan dan data review akan dihapus permanen. Tindakan ini tidak dapat dibatalkan.`
    )
    if (!confirmed) return
    setBusy(true); setError(''); setSuccess('')
    try {
      const {data:deleted, error:deleteError} = await supabase
        .from('maintenance_requests')
        .delete()
        .eq('id',request.id)
        .select('id')
      if (deleteError) throw new Error(deleteError.message)
      if (!deleted?.length) throw new Error('Penghapusan tidak diizinkan atau pengajuan sudah tidak tersedia.')

      let photoWarning = ''
      if (request.photo_path) {
        const {error:storageError} = await supabase.storage
          .from('maintenance-photos')
          .remove([request.photo_path])
        if (storageError) photoWarning = ' Foto gagal dihapus dari Storage: ' + storageError.message
      }
      setSuccess('Pengajuan berhasil dihapus.' + photoWarning)
      await load()
    } catch (e) {
      setError('Gagal menghapus pengajuan: ' + (e instanceof Error ? e.message : 'Terjadi kesalahan'))
    } finally {
      setBusy(false)
    }
  }

  const updateOne=(id:string,part:Partial<(typeof updates)[string]>)=>setUpdates(s=>({
    ...s,[id]:{...s[id],...part}
  }))
  const visible=items.filter(x=>{
    const d=new Date(x.created_at)
    return d.getFullYear()===year && d.getMonth()+1===month && (statusFilter==='all'||x.status===statusFilter)
  })
  return <section className="panel maint-module">
    <div className="maint-head"><div><h3>Defect & Maintenance — Service Order</h3><p>Leader mengajukan kerusakan, AM memverifikasi dan mencatat koordinasi perbaikan. Periode mengikuti bulan pembuatan laporan.</p></div>
      <div className="maint-actions"><button className="sales-button secondary" onClick={()=>void load()} disabled={loading}>↻ Refresh</button>
        <button className="sales-button" onClick={()=>setShowForm(v=>!v)}>{showForm?'Tutup form':'+ Buat pengajuan'}</button></div>
    </div>
    {error&&<p className="maint-alert maint-error" role="alert">{error}</p>}
    {success&&<p className="maint-alert maint-success" role="status">{success}</p>}
    {showForm&&<form className="maint-form" onSubmit={createRequest}>
      <h3>Pengajuan Perbaikan Baru</h3>
      <div className="maint-fields">
        {role==='AM'&&!outletId&&<label>Outlet<select required value={selectedOutlet} onChange={e=>setSelectedOutlet(e.target.value)}><option value="">Pilih outlet</option>{outlets.map(o=><option value={o.id} key={o.id}>{o.outlet_name}</option>)}</select></label>}
        <label>Kategori<select value={form.category} onChange={e=>setForm(p=>({...p,category:e.target.value}))}>{['Equipment','Sipil','Utensil'].map(v=><option key={v}>{v}</option>)}</select></label>
        <label>Equipment / lokasi kerusakan<input required minLength={2} maxLength={160} value={form.equipment} onChange={e=>setForm(p=>({...p,equipment:e.target.value}))} placeholder="Contoh: Freezer"/></label>
        <label>Prioritas<select value={form.priority} onChange={e=>setForm(p=>({...p,priority:e.target.value}))}>{['Low','Medium','High','Urgent'].map(v=><option key={v}>{v}</option>)}</select></label>
        <label>PIC Outlet<input required minLength={2} maxLength={120} value={form.pic} onChange={e=>setForm(p=>({...p,pic:e.target.value}))} placeholder="Nama penanggung jawab"/></label>
        <label className="maint-wide">Problem / detail kerusakan<textarea required minLength={5} maxLength={2000} rows={3} value={form.problem} placeholder="Isi detail kerusakan dengan jelas" onChange={e=>setForm(p=>({...p,problem:e.target.value}))}/></label>
        <label className="maint-wide">Impact operasional<textarea required minLength={3} maxLength={1200} rows={2} value={form.impact} placeholder="Contoh: Bahan baku berisiko rusak" onChange={e=>setForm(p=>({...p,impact:e.target.value}))}/></label>
        <label className="maint-wide">Foto kerusakan (JPG/PNG/WEBP, maks 5 MB)<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>setFile(e.target.files?.[0]||null)}/></label>
      </div>
      <button className="sales-button" disabled={busy||!currentOutlet}>{busy?'Menyimpan...':'Kirim pengajuan ke AM'}</button>
    </form>}
    <div className="maint-toolbar"><div><strong>{visible.length} pengajuan</strong><span> · {new Date(year,month-1,1).toLocaleDateString('id-ID',{month:'long',year:'numeric'})}</span></div>
      <label>Status <select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}><option value="all">Semua status</option>{(Object.entries(statusLabels) as [Status,string][]).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label></div>
    {loading ? <p>Memuat laporan maintenance...</p> : visible.length === 0 ? (
      <div className="maint-empty">Belum ada pengajuan pada periode dan filter ini.</div>
    ) : (
      <div style={{ overflowX: 'auto', width: '100%', WebkitOverflowScrolling: 'touch', border: '1px solid #e2e8f0', borderRadius: 12 }}>
        <table style={{ width: '100%', minWidth: role === 'AM' ? 1520 : 1230, borderCollapse: 'separate', borderSpacing: 0, fontSize: 12, textAlign: 'left' }}>
          <thead>
            <tr style={{ background: '#14213c', color: '#fff' }}>
              {(role === 'AM' ? ['Outlet','Date','Equipment','Problem','Impact','Foto','Priority','PIC','Status','Catatan / Tindak Lanjut AM','Simpan / Edit'] : ['Date','Equipment','Problem','Impact','Foto','Priority','PIC','Status','Catatan / Tindak Lanjut AM']).map(label => (
                <th key={label} style={{ padding: '13px 11px', whiteSpace: 'nowrap', fontWeight: 600, borderBottom: '1px solid #243754' }}>{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((r, index) => {
              const u = updates[r.id]
              const cell: CSSProperties = { padding: '12px 10px', verticalAlign: 'top', borderBottom: '1px solid #e6eaf0', lineHeight: 1.6, overflowWrap: 'anywhere' }
              return (
                <tr key={r.id} style={{ background: index % 2 === 0 ? '#fff' : '#f7f9fc', color: '#14213c' }}>
                  {role === 'AM' && <td style={{...cell, minWidth: 120, fontWeight: 600}}>{outlets.find(o => o.id === r.outlet_id)?.outlet_name || 'Outlet'}</td>}
                  <td style={{...cell, minWidth: 92, whiteSpace: 'nowrap'}}>{prettyDate(r.created_at)}</td>
                  <td style={{...cell, minWidth: 115}}><strong>{r.equipment}</strong><div style={{fontSize: 11, color: '#7b879b'}}>{r.category}</div></td>
                  <td style={{...cell, minWidth: 165, maxWidth: 240}}>{r.problem}</td>
                  <td style={{...cell, minWidth: 165, maxWidth: 240}}>{r.impact}</td>
                  <td style={{...cell, minWidth: 105}}>{r.photo_path ? (photoUrls[r.id] ? (
                    <a href={photoUrls[r.id]} target="_blank" rel="noopener noreferrer" style={{color: '#a46a00', textDecoration: 'underline', display: 'inline-block'}}>
                      <img src={photoUrls[r.id]} alt={'Kerusakan '+r.equipment} style={{width: 78, height: 58, objectFit: 'cover', borderRadius: 7, display: 'block', marginBottom: 4}} />Lihat foto
                    </a>
                  ) : <span style={{color: '#8793a4'}}>Klik Refresh untuk memuat foto</span>) : <span style={{color: '#8793a4'}}>Tidak ada</span>}</td>
                  <td style={{...cell, minWidth: 80}}><span className={'priority-'+r.priority.toLowerCase()} style={{display:'inline-block', padding: '5px 8px', borderRadius: 6}}>{r.priority}</span></td>
                  <td style={{...cell, minWidth: 85}}>{r.pic}</td>
                  <td style={{...cell, minWidth: 170}}>{role === 'AM' ? (
                    <div style={{display:'grid', gap:8}}>
                      <select aria-label={'Status '+r.equipment} value={u?.status || r.status} onChange={e => updateOne(r.id,{status: e.target.value as Status})} style={{width:'100%', padding:8, border:'1px solid #d7dee8', borderRadius:7, background:'#fff', color:'#14213c'}}>
                        {(Object.entries(statusLabels) as [Status,string][]).map(([key,value]) => <option key={key} value={key}>{value}</option>)}
                      </select>
                      <label style={{display:'flex', alignItems:'center', gap:5, fontSize:11}}><input type="checkbox" checked={u?.am_verified || false} onChange={e => updateOne(r.id,{am_verified:e.target.checked})}/> Verifikasi AM</label>
                      <label style={{display:'flex', alignItems:'center', gap:5, fontSize:11}}><input type="checkbox" checked={u?.am_coordinated || false} onChange={e => updateOne(r.id,{am_coordinated:e.target.checked})}/> Koordinasi pusat</label>
                    </div>
                  ) : <span className={'maint-status status-'+r.status} style={{display:'inline-block', padding: '6px 9px', borderRadius:7, whiteSpace:'nowrap'}}>{statusLabels[r.status]}</span>}</td>
                  <td style={{...cell, minWidth: role === 'AM' ? 245 : 205}}>{role === 'AM' ? (
                    <textarea aria-label={'Catatan AM untuk '+r.equipment} rows={4} maxLength={3000} value={u?.am_notes || ''} onChange={e => updateOne(r.id,{am_notes:e.target.value})} placeholder="Tulis tindak lanjut AM..." style={{width:'100%', minHeight:85, boxSizing:'border-box', border:'1px solid #d7dee8', borderRadius:8, padding:9, fontFamily:'inherit', resize:'vertical'}} />
                  ) : <span>{r.am_notes || 'Belum ada catatan AM'}</span>}</td>
                  {role === 'AM' && <td style={{...cell, minWidth: 128}}>
                    <div style={{display:'flex', flexDirection:'column', gap:9, alignItems:'stretch'}}>
                      <button className="sales-button" disabled={busy} onClick={() => void saveReview(r.id)} style={{whiteSpace:'nowrap'}}>{busy ? 'Memproses...' : 'Simpan / Edit'}</button>
                      <button type="button" disabled={busy} onClick={() => void deleteRequest(r)}
                        aria-label={'Hapus pengajuan '+r.equipment}
                        style={{padding:'10px 12px', borderRadius:8, background:'#fff4f4', border:'1px solid #efb5b5', color:'#b91c1c', fontWeight:700, cursor:busy?'not-allowed':'pointer', fontFamily:'inherit'}}>
                        Hapus
                      </button>
                    </div>
                  </td>}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    )}
    <p style={{fontSize:12,color:'#77849a',marginTop:10}}>Geser tabel ke kanan untuk melihat seluruh kolom.</p>
  </section>
}
