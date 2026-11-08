import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import './ProfileOutlet.css'

type Outlet = { id: string; outlet_code: string; outlet_name: string }
type Props = { role: 'AM' | 'LEADER'; outletId: string; outlets: Outlet[] }
type ProfileData = {
  outlet_id: string; address: string; google_maps_url: string; opening_hours: string;
  opening_hours_weekday: string; opening_hours_weekend: string;
  outlet_type: string; outlet_class: string; open_month: number | null; open_year: number | null;
  seating_capacity: number | null; crew_count: number | null;
  sales_generators: string; facilities: string; notes: string;
  photo_path: string | null; updated_at: string
}
type GalleryRow = { id: string; outlet_id: string; photo_path: string; sort_order: number; created_at: string }
type GalleryPhoto = GalleryRow & { url: string }
type Editor = {
  address: string; google_maps_url: string;
  opening_hours_weekday: string; opening_hours_weekend: string;
  outlet_type: string; outlet_class: string; open_month: string; open_year: string;
  seating_capacity: string; crew_count: string;
  sales_generators: string; facilities: string; notes: string
}
const EMPTY: Editor = {
  address:'',google_maps_url:'',opening_hours_weekday:'',opening_hours_weekend:'',
  outlet_type:'',outlet_class:'',open_month:'',open_year:'',seating_capacity:'',crew_count:'',
  sales_generators:'',facilities:'',notes:''
}
const MONTHS = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember']
const BUCKET = 'outlet-profile-photos'
const LIMIT = 12
const validImage = (f:File) => ['image/jpeg','image/png','image/webp'].includes(f.type) && f.size <= 5*1024*1024
const fileExt = (f:File) => f.type === 'image/png'?'png':f.type === 'image/webp'?'webp':'jpg'
const validMapLink = (url:string) => {
  if(!url)return true
  try {const p=new URL(url);return p.protocol==='https:' && (p.hostname==='maps.google.com'||p.hostname==='google.com'||p.hostname.endsWith('.google.com')||p.hostname==='maps.app.goo.gl')}
  catch {return false}
}
const editFrom = (p?:ProfileData):Editor => p?{
  address:p.address||'',google_maps_url:p.google_maps_url||'',
  opening_hours_weekday:p.opening_hours_weekday||p.opening_hours||'',
  opening_hours_weekend:p.opening_hours_weekend||'',
  outlet_type:p.outlet_type||'',outlet_class:p.outlet_class||'',
  open_month:p.open_month?String(p.open_month):'',open_year:p.open_year?String(p.open_year):'',
  seating_capacity:p.seating_capacity==null?'':String(p.seating_capacity),
  crew_count:p.crew_count==null?'':String(p.crew_count),
  sales_generators:p.sales_generators||'',facilities:p.facilities||'',notes:p.notes||''
}: {...EMPTY}
const display=(s:string|number|null|undefined)=>s===null||s===undefined||String(s).trim()===''?'Belum diisi':String(s)

function Gallery({photos,title}:{photos:GalleryPhoto[];title:string}){
  const rail=useRef<HTMLDivElement>(null)
  const [index,setIndex]=useState(0)
  useEffect(()=>setIndex(0),[photos.length,photos[0]?.id])
  const go=(next:number)=>{
    const i=Math.max(0,Math.min(photos.length-1,next))
    if(!rail.current)return
    rail.current.scrollTo({left:rail.current.clientWidth*i,behavior:'smooth'})
    setIndex(i)
  }
  return <div className="op-gallery">
    {photos.length? <>
      <div ref={rail} className="op-gallery-rail" onScroll={e=>{
        const el=e.currentTarget;if(el.clientWidth) setIndex(Math.max(0,Math.min(photos.length-1,Math.round(el.scrollLeft/el.clientWidth))))
      }}>
        {photos.map((p,i)=><a key={p.id} className="op-gallery-slide" href={p.url} target="_blank" rel="noopener noreferrer" title="Klik untuk melihat foto penuh">
          <img src={p.url} alt={`${title} — foto ${i+1}`} loading="lazy" />
        </a>)}
      </div>
      {photos.length>1 && <>
        <button type="button" className="op-slide-btn op-prev" onClick={()=>go(index-1)} disabled={index===0} aria-label="Foto sebelumnya">‹</button>
        <button type="button" className="op-slide-btn op-next" onClick={()=>go(index+1)} disabled={index===photos.length-1} aria-label="Foto berikutnya">›</button>
        <div className="op-gallery-count">{index+1} / {photos.length}</div>
        <div className="op-gallery-dots">{photos.map((p,i)=><button key={p.id} type="button" className={i===index?'current':''} aria-label={`Lihat foto ${i+1}`} onClick={()=>go(i)}/>)}</div>
      </>}
    </>:<div className="op-gallery-empty">Foto outlet belum tersedia</div>}
  </div>
}

export default function ProfileOutlet({role,outletId,outlets}:Props){
  const [rows,setRows]=useState<ProfileData[]>([])
  const [gallery,setGallery]=useState<Record<string,GalleryPhoto[]>>({})
  const [loading,setLoading]=useState(true)
  const [saving,setSaving]=useState(false)
  const [error,setError]=useState('')
  const [success,setSuccess]=useState('')
  const [editingId,setEditingId]=useState<string|null>(null)
  const [quickOutlet,setQuickOutlet]=useState('')
  const [form,setForm]=useState<Editor>({...EMPTY})
  const [newFiles,setNewFiles]=useState<File[]>([])
  const [removeIds,setRemoveIds]=useState<string[]>([])
  const editorRef=useRef<HTMLDivElement>(null)
  const pickerRef=useRef<HTMLInputElement>(null)

  const load=useCallback(async()=>{
    setLoading(true);setError('')
    let profileQuery=supabase.from('outlet_profiles').select('*').order('updated_at',{ascending:false})
    let galleryQuery=supabase.from('outlet_profile_photos').select('*').order('sort_order',{ascending:true}).order('created_at',{ascending:true})
    if(role==='LEADER'){
      if(!outletId){setRows([]);setGallery({});setLoading(false);return}
      profileQuery=profileQuery.eq('outlet_id',outletId)
      galleryQuery=galleryQuery.eq('outlet_id',outletId)
    }
    const [profileResult,photoResult]=await Promise.all([profileQuery.limit(100),galleryQuery.limit(200)])
    if(profileResult.error || photoResult.error){
      setError('Gagal memuat Profile Outlet: '+(profileResult.error?.message||photoResult.error?.message))
      setLoading(false);return
    }
    const list=(profileResult.data||[]) as ProfileData[]
    const picList=(photoResult.data||[]) as GalleryRow[]
    const grouped:Record<string,GalleryPhoto[]>={}
    const signed=await Promise.all(picList.map(async p=>{
      const {data}=await supabase.storage.from(BUCKET).createSignedUrl(p.photo_path,3600)
      return {...p,url:data?.signedUrl||''}
    }))
    signed.filter(p=>p.url).forEach(p=>{(grouped[p.outlet_id]??=[]).push(p)})
    // Fallback foto lama kalau migrasi galeri belum mencakup foto tersebut.
    for(const p of list){
      if(p.photo_path && !picList.some(g=>g.outlet_id===p.outlet_id&&g.photo_path===p.photo_path)){
        const {data}=await supabase.storage.from(BUCKET).createSignedUrl(p.photo_path,3600)
        if(data?.signedUrl)(grouped[p.outlet_id]??=[]).unshift({id:`legacy-${p.outlet_id}`,outlet_id:p.outlet_id,photo_path:p.photo_path,sort_order:-1,created_at:'',url:data.signedUrl})
      }
    }
    setRows(list);setGallery(grouped);setLoading(false)
  },[role,outletId])
  useEffect(()=>{void load()},[load])
  const byOutlet=useMemo(()=>new Map(rows.map(p=>[p.outlet_id,p])),[rows])
  const visibleOutlets=role==='LEADER'?outlets.filter(o=>o.id===outletId):outletId?outlets.filter(o=>o.id===outletId):outlets
  const photoCount=(id:string)=>gallery[id]?.length||0
  const openEditor=(id:string)=>{
    if(role!=='AM'||!id)return
    setEditingId(id);setQuickOutlet(id);setForm(editFrom(byOutlet.get(id)))
    setNewFiles([]);setRemoveIds([]);setError('');setSuccess('')
    requestAnimationFrame(()=>editorRef.current?.scrollIntoView({behavior:'smooth',block:'start'}))
  }
  const update=(key:keyof Editor,val:string)=>setForm(prev=>({...prev,[key]:val}))
  const addFiles=(files:FileList|null)=>{
    if(!files)return
    const added=Array.from(files)
    if(added.some(f=>!validImage(f))){setError('Setiap foto wajib JPG/PNG/WEBP dengan ukuran maksimal 5 MB.');return}
    if(newFiles.length+added.length+photoCount(editingId||'')-removeIds.length>LIMIT){setError(`Maksimal ${LIMIT} foto untuk satu outlet.`);return}
    setNewFiles(prev=>[...prev,...added]);setError('')
    if(pickerRef.current)pickerRef.current.value=''
  }
  const availableOld:GalleryPhoto[]=editingId?(gallery[editingId]||[]):[]
  const retainedOld=availableOld.filter(p=>!removeIds.includes(p.id))
  async function save(e:FormEvent<HTMLFormElement>){
    e.preventDefault()
    if(role!=='AM'||!editingId)return
    if(!validMapLink(form.google_maps_url.trim())){setError('Link Google Maps harus URL HTTPS Google Maps.');return}
    for(const key of ['seating_capacity','crew_count'] as const){
      const value=form[key].trim()
      if(value&&(!/^\d+$/.test(value)||Number(value)>(key==='crew_count'?500:2000))){setError('Jumlah kursi/crew harus angka positif sesuai batas maksimum.');return}
    }
    if(form.open_year && (!/^\d{4}$/.test(form.open_year)||Number(form.open_year)<1990||Number(form.open_year)>2100)){
      setError('Tahun opening harus 1990–2100.');return
    }
    if(newFiles.length+retainedOld.length>LIMIT){setError(`Maksimal ${LIMIT} foto per outlet.`);return}
    setSaving(true);setError('');setSuccess('')
    const uploaded:string[]=[]
    try{
      const {data:{user},error:userErr}=await supabase.auth.getUser()
      if(userErr||!user)throw new Error('Sesi login habis. Silakan login kembali.')
      for(const f of newFiles){
        const path=`${editingId}/${user.id}/${crypto.randomUUID()}.${fileExt(f)}`
        const {error:uploadErr}=await supabase.storage.from(BUCKET).upload(path,f,{contentType:f.type,upsert:false})
        if(uploadErr)throw new Error('Upload foto gagal: '+uploadErr.message)
        uploaded.push(path)
      }
      const previous=byOutlet.get(editingId)
      const payload={
        outlet_id:editingId,address:form.address.trim(),google_maps_url:form.google_maps_url.trim(),
        opening_hours:form.opening_hours_weekday.trim(),
        opening_hours_weekday:form.opening_hours_weekday.trim(),opening_hours_weekend:form.opening_hours_weekend.trim(),
        outlet_type:form.outlet_type.trim(),outlet_class:form.outlet_class,
        open_month:form.open_month?Number(form.open_month):null,
        open_year:form.open_year?Number(form.open_year):null,
        seating_capacity:form.seating_capacity?Number(form.seating_capacity):null,
        crew_count:form.crew_count?Number(form.crew_count):null,
        sales_generators:form.sales_generators.trim(),facilities:form.facilities.trim(),notes:form.notes.trim(),
        // Foto lama tetap ada di kolom legacy sampai user menghapusnya.
        photo_path:previous?.photo_path||null
      }
      const {error:saveErr}=await supabase.from('outlet_profiles').upsert(payload,{onConflict:'outlet_id'})
      if(saveErr)throw new Error('Simpan profil gagal: '+saveErr.message)
      if(uploaded.length){
        const currentMax=Math.max(-1,...(gallery[editingId]||[]).map(p=>p.sort_order))
        const {error:galleryErr}=await supabase.from('outlet_profile_photos').insert(uploaded.map((path,i)=>({outlet_id:editingId,photo_path:path,sort_order:currentMax+i+1})))
        if(galleryErr)throw new Error('Simpan daftar foto gagal: '+galleryErr.message)
      }
      // Hapus hanya foto yang memang dipilih oleh AM. File lama legacy tidak dihapus diam-diam.
      for(const id of removeIds){
        const row=(gallery[editingId]||[]).find(p=>p.id===id)
        if(!row)continue
        if(id.startsWith('legacy-')){
          const {error:legacyErr}=await supabase.from('outlet_profiles').update({photo_path:null}).eq('outlet_id',editingId)
          if(legacyErr)throw new Error('Hapus foto lama gagal: '+legacyErr.message)
        }else{
          const {error:delErr}=await supabase.from('outlet_profile_photos').delete().eq('id',id)
          if(delErr)throw new Error('Hapus foto galeri gagal: '+delErr.message)
        }
        // Jika foto juga masih menjadi foto_path lama, kosongkan referensinya.
        if(previous?.photo_path===row.photo_path){
          const {error:legacyErr}=await supabase.from('outlet_profiles').update({photo_path:null}).eq('outlet_id',editingId)
          if(legacyErr)throw new Error('Perbarui referensi foto lama gagal: '+legacyErr.message)
        }
        const {error:storageErr}=await supabase.storage.from(BUCKET).remove([row.photo_path])
        if(storageErr)throw new Error('Hapus file foto gagal: '+storageErr.message)
      }
      setEditingId(null);setNewFiles([]);setRemoveIds([])
      setSuccess('Profile Outlet dan galeri foto berhasil disimpan.')
      await load()
    }catch(err){
      // Cleanup file upload jika gagal SEBELUM registrasi ke galeri. Jangan menghapus file yang telah didaftarkan.
      if(uploaded.length){
        const {data:used}=await supabase.from('outlet_profile_photos').select('photo_path').in('photo_path',uploaded)
        const registered=new Set((used||[]).map(p=>p.photo_path))
        const orphan=uploaded.filter(p=>!registered.has(p))
        if(orphan.length)await supabase.storage.from(BUCKET).remove(orphan)
      }
      setError(err instanceof Error?err.message:'Gagal menyimpan profil outlet.')
      await load()
    }finally{setSaving(false)}
  }
  return <section className="op-root">
    <div className="op-panel">
      <div className="op-heading">
        <div><h3>Profile Outlet — Area Bandung 2</h3><p>Galeri outlet, data operasional, klasifikasi, dan segmen customer.</p></div>
        <div className="op-head-actions">
          {role==='AM'&& <>
            <select aria-label="Pilih outlet untuk diedit" className="op-outlet-select" value={quickOutlet} onChange={e=>setQuickOutlet(e.target.value)}>
              <option value="">Pilih Outlet</option>
              {outlets.map(o=><option key={o.id} value={o.id}>{o.outlet_name}</option>)}
            </select>
            <button type="button" className="op-btn op-yellow" disabled={!quickOutlet} onClick={()=>openEditor(quickOutlet)}>Isi / Edit Profil</button>
          </>}
          <button type="button" className="op-btn" onClick={()=>void load()}>↻ Refresh</button>
        </div>
      </div>
      {error&&<div className="op-notice op-error" role="alert">{error}</div>}
      {success&&<div className="op-notice op-success">{success}</div>}
      {role==='AM'&&editingId&&<div ref={editorRef} className="op-editor" id="op-editor">
        <form onSubmit={e=>void save(e)}>
          <div className="op-editor-head"><h3>Isi / Edit Profil — {outlets.find(o=>o.id===editingId)?.outlet_name}</h3><button type="button" className="op-btn" disabled={saving} onClick={()=>setEditingId(null)}>Tutup</button></div>
          <div className="op-form-grid">
            <label className="op-full">Alamat lengkap<textarea rows={2} maxLength={1000} value={form.address} onChange={e=>update('address',e.target.value)} placeholder="Alamat lengkap outlet"/></label>
            <label>Google Maps<input type="url" maxLength={1000} value={form.google_maps_url} onChange={e=>update('google_maps_url',e.target.value)} placeholder="https://maps.app.goo.gl/..."/></label>
            <label>Tipe tempat / lokasi<input maxLength={100} value={form.outlet_type} onChange={e=>update('outlet_type',e.target.value)} placeholder="Mall / Street / Ruko / Booth"/></label>
            <label>Klasifikasi outlet<select value={form.outlet_class} onChange={e=>update('outlet_class',e.target.value)}><option value="">Belum ditentukan</option><option value="A">Tipe A</option><option value="B">Tipe B</option><option value="C">Tipe C</option></select></label>
            <label>Jam operasional weekday (Senin–Jumat)<input maxLength={250} value={form.opening_hours_weekday} onChange={e=>update('opening_hours_weekday',e.target.value)} placeholder="10.00–22.00 WIB"/></label>
            <label>Jam operasional weekend (Sabtu–Minggu)<input maxLength={250} value={form.opening_hours_weekend} onChange={e=>update('opening_hours_weekend',e.target.value)} placeholder="10.00–23.00 WIB"/></label>
            <label>Open Date — Bulan<select value={form.open_month} onChange={e=>update('open_month',e.target.value)}><option value="">Pilih bulan</option>{MONTHS.map((m,i)=><option key={m} value={i+1}>{m}</option>)}</select></label>
            <label>Open Date — Tahun<input type="number" min={1990} max={2100} value={form.open_year} onChange={e=>update('open_year',e.target.value)} placeholder="2026"/></label>
            <label>Kapasitas tempat duduk<input type="number" min={0} max={2000} value={form.seating_capacity} onChange={e=>update('seating_capacity',e.target.value)} placeholder="12"/></label>
            <label>Jumlah crew<input type="number" min={0} max={500} value={form.crew_count} onChange={e=>update('crew_count',e.target.value)} placeholder="8"/></label>
            <label className="op-full">Sales Generator (profil customer)<textarea rows={2} maxLength={1500} value={form.sales_generators} onChange={e=>update('sales_generators',e.target.value)} placeholder="Contoh: Family, Tourist, Student, Office Worker, Local Resident"/></label>
            <label className="op-full">Fasilitas<textarea rows={2} maxLength={1500} value={form.facilities} onChange={e=>update('facilities',e.target.value)} placeholder="Contoh: dine-in, AC, parkir, akses lift"/></label>
            <label className="op-full">Catatan AM<textarea rows={2} maxLength={2000} value={form.notes} onChange={e=>update('notes',e.target.value)}/></label>
            <label className="op-full">Tambah foto outlet (maks. {LIMIT} foto/outlet, JPG/PNG/WEBP, 5 MB per foto)
              <input ref={pickerRef} type="file" multiple accept="image/jpeg,image/png,image/webp" onChange={e=>addFiles(e.target.files)}/>
            </label>
          </div>
          {availableOld.length>0&&<div className="op-edit-gallery"><strong>Foto tersimpan — centang untuk hapus saat Simpan</strong><div className="op-edit-thumbs">
            {availableOld.map((p,i)=><label key={p.id} className="op-thumb"><img src={p.url} alt={`Foto tersimpan ${i+1}`} /><span><input type="checkbox" checked={removeIds.includes(p.id)} onChange={e=>setRemoveIds(prev=>e.target.checked?[...prev,p.id]:prev.filter(x=>x!==p.id))}/> Hapus foto</span></label>)}
          </div></div>}
          {newFiles.length>0&&<div className="op-pending"><strong>Foto baru ({newFiles.length})</strong>{newFiles.map((f,i)=><div key={`${f.name}-${i}`}>{f.name} <button type="button" onClick={()=>setNewFiles(prev=>prev.filter((_,j)=>j!==i))}>Batalkan</button></div>)}</div>}
          <div className="op-form-actions"><button type="button" className="op-btn" disabled={saving} onClick={()=>setEditingId(null)}>Batal</button><button type="submit" className="op-btn op-yellow" disabled={saving}>{saving?'Menyimpan...':'Simpan Profile Outlet'}</button></div>
        </form>
      </div>}
      {loading?<p className="op-empty">Memuat Profile Outlet...</p>:visibleOutlets.length===0?<p className="op-empty">Tidak ada outlet yang ditampilkan.</p>:<div className="op-grid">
        {visibleOutlets.map(outlet=>{
          const info=byOutlet.get(outlet.id)
          return <article key={outlet.id} className="op-card">
            <Gallery title={outlet.outlet_name} photos={gallery[outlet.id]||[]}/>
            <div className="op-body">
              <div className="op-cardtop"><div><h4>{outlet.outlet_name}</h4><small>{outlet.outlet_code||'AREA BANDUNG 2'}</small></div>
                {role==='AM'&&<button type="button" className="op-btn op-yellow" onClick={()=>openEditor(outlet.id)}>{info?'Edit Profil':'+ Isi Profil'}</button>}
              </div>
              <div className="op-details">
                <div><span>Alamat</span><strong>{display(info?.address)}</strong></div>
                <div><span>Tipe tempat</span><strong>{display(info?.outlet_type)}</strong></div>
                <div><span>Jam weekday</span><strong>{display(info?.opening_hours_weekday||info?.opening_hours)}</strong></div>
                <div><span>Jam weekend</span><strong>{display(info?.opening_hours_weekend)}</strong></div>
                <div><span>Klasifikasi</span><strong>{info?.outlet_class?`Tipe ${info.outlet_class}`:'Belum diisi'}</strong></div>
                <div><span>Open Date</span><strong>{info?.open_month&&info?.open_year?`${MONTHS[info.open_month-1]} ${info.open_year}`:'Belum diisi'}</strong></div>
                <div><span>Kapasitas duduk</span><strong>{info?.seating_capacity==null?'Belum diisi':`${info.seating_capacity} kursi`}</strong></div>
                <div><span>Jumlah crew</span><strong>{info?.crew_count==null?'Belum diisi':`${info.crew_count} orang`}</strong></div>
              </div>
              <div className="op-textfield"><span>Sales Generator / Segmen Customer</span><p>{display(info?.sales_generators)}</p></div>
              <div className="op-textfield"><span>Fasilitas</span><p>{display(info?.facilities)}</p></div>
              {info?.notes&&<div className="op-textfield"><span>Catatan AM</span><p>{info.notes}</p></div>}
              {info?.google_maps_url&&validMapLink(info.google_maps_url)&&<a className="op-map-link" href={info.google_maps_url} target="_blank" rel="noopener noreferrer">Buka Google Maps ↗</a>}
              {info?.updated_at&&<small className="op-updated">Update: {new Date(info.updated_at).toLocaleDateString('id-ID',{day:'2-digit',month:'short',year:'numeric'})}</small>}
            </div>
          </article>
        })}
      </div>}
    </div>
  </section>
}
