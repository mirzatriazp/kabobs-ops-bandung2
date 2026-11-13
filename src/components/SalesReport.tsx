import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { downloadXlsx } from '../lib/exportXlsx'
import { readSalesExcel, type SalesImportMode, type SalesImportPreview } from '../lib/sales_excel_import'
import './SalesReportCompact.css'

type Outlet = {id: string; outlet_name: string; outlet_code: string}
type Props = {role:'AM'|'LEADER'; outletId:string; outlets:Outlet[]; month:number; year:number}
type Sale = {outlet_id:string; sales_date:string; actual_amount:number}
type Target = {outlet_id:string; sales_date:string; target_amount:number}
const fmt = (v:number) => 'Rp '+Math.round(v).toLocaleString('id-ID')
const pct = (a:number,b:number) => b > 0 ? (a/b*100).toFixed(2)+'%' : '—'
const dateKey=(y:number,m:number,d:number)=>`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`
const todayID = ()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
const formatInputRupiah = (value: string | number) => {
  const angka = String(value).replace(/\D/g, '')
  return angka.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}

const parseInputRupiah = (value: string) => {
  return Number(value.replace(/\D/g, ''))
}
export default function SalesReport({role,outletId,outlets,month,year}:Props) {
  const [actuals,setActuals]=useState<Sale[]>([])
  const [targets,setTargets]=useState<Target[]>([])
  const [drafts,setDrafts]=useState<Record<string,string>>({})
  const [targetDrafts,setTargetDrafts]=useState<Record<string,string>>({})
  const [working,setWorking]=useState(false)
  const [busyKey,setBusyKey]=useState('')
  const [feedback,setFeedback]=useState('')
  const [messageType,setMessageType]=useState<'error'|'success'>('success')
  const [version,setVersion]=useState(0)
  const [periodError,setPeriodError]=useState('')
  const [importMode,setImportMode]=useState<SalesImportMode>('target')
  const [importPreview,setImportPreview]=useState<SalesImportPreview|null>(null)
  const [importFileName,setImportFileName]=useState('')
  const [importReading,setImportReading]=useState(false)
  const [importSaving,setImportSaving]=useState(false)
  const [overwriteExisting,setOverwriteExisting]=useState(false)
  const [importError,setImportError]=useState('')
  const [importSuccess,setImportSuccess]=useState('')
  const [showImportForm,setShowImportForm]=useState(false)
  const days = new Date(year,month,0).getDate()
  const start = dateKey(year,month,1)
  const end = dateKey(year,month,days)
  const activeOutletName = outlets.find(o=>o.id===outletId)?.outlet_name
  const isAll = role==='AM'&&!outletId
  const selectedMonthLabel = new Intl.DateTimeFormat('id-ID',{month:'long',year:'numeric'}).format(new Date(year,month-1,1))

  const load = useCallback(async () => {
    setWorking(true);setPeriodError('')
    let tq=supabase.from('sales_daily_targets').select('outlet_id,sales_date,target_amount').gte('sales_date',start).lte('sales_date',end)
    let aq=supabase.from('sales_daily_actuals').select('outlet_id,sales_date,actual_amount').gte('sales_date',start).lte('sales_date',end)
    if(outletId){tq=tq.eq('outlet_id',outletId);aq=aq.eq('outlet_id',outletId)}
    const [t,a]=await Promise.all([tq,aq])
    if(t.error||a.error){setPeriodError(t.error?.message||a.error?.message||'Gagal memuat data');setTargets([]);setActuals([])}
    else{setTargets((t.data||[]) as Target[]);setActuals((a.data||[]) as Sale[])}
    setWorking(false)
  },[start,end,outletId])
  useEffect(()=>{load()},[load,version])
  useEffect(()=>{setDrafts({});setTargetDrafts({});setFeedback('')},[outletId,month,year])
  useEffect(()=>{setImportPreview(null);setImportError('');setImportSuccess('');setOverwriteExisting(false)},[outletId,month,year,importMode])

  const tableRows=useMemo(()=>{
    if(!outletId)return []
    const rows=[];let runningTarget=0;let runningActual=0;let targetComplete=true;let actualComplete=true
    for(let d=1;d<=days;d++){
      const date=dateKey(year,month,d)
      const t=targets.find(x=>x.sales_date===date&&x.outlet_id===outletId)
      const a=actuals.find(x=>x.sales_date===date&&x.outlet_id===outletId)
      if(t)runningTarget+=Number(t.target_amount);else targetComplete=false
      if(a)runningActual+=Number(a.actual_amount);else actualComplete=false
      rows.push({date,day:d,target:t?Number(t.target_amount):null,actual:a?Number(a.actual_amount):null,
        cumulativeTarget:targetComplete?runningTarget:null,cumulativeActual:actualComplete?runningActual:null,
        runningTarget,runningActual, actualCovered:actualComplete,targetCovered:targetComplete})
    }
    return rows
  },[outletId,actuals,targets,days,month,year])
  const today = todayID()
  const asOf = today < start ? null : today > end ? end : today
  const eligibleRows = tableRows.filter(r=>asOf && r.date<=asOf)
  const totalTarget=eligibleRows.reduce((sum,r)=>sum+(r.target||0),0)
  const totalActual=eligibleRows.reduce((sum,r)=>sum+(r.actual||0),0)
  const allActual=actuals.reduce((s,r)=>s+Number(r.actual_amount),0)
  const allTarget=targets.reduce((s,r)=>s+Number(r.target_amount),0)
  // Area totals only compare recorded actuals/targets; unfilled days remain missing, not zero.
  const areaComparable=actuals.length>0 && targets.length>0
  const areaGap=areaComparable ? allActual-allTarget : null
  const areaAchievement=areaComparable ? pct(allActual,allTarget) : '—'
  const targetDays=eligibleRows.filter(r=>r.target!==null).length
  const actualDays=eligibleRows.filter(r=>r.actual!==null).length
  // Summary comparisons use the same selected MTD cutoff; missing days are not zero sales.
  const mtdComparable=targetDays>0 && actualDays>0
  const mtdGap=mtdComparable?totalActual-totalTarget:null
  const mtdAchievement=mtdComparable?pct(totalActual,totalTarget):'—'
  const displayedGap=isAll?areaGap:mtdGap

  function exportExcel(){
    if(role!=='AM'||working||periodError)return
    const chosen=outletId?outlets.filter(o=>o.id===outletId):outlets
    const actualMap=new Map(actuals.map(a=>[`${a.outlet_id}|${a.sales_date}`,Number(a.actual_amount)]))
    const targetMap=new Map(targets.map(t=>[`${t.outlet_id}|${t.sales_date}`,Number(t.target_amount)]))
    const detail:(string|number|null)[][]=[['Outlet','Tanggal','Target Sales (Rp)','Actual Sales (Rp)','Selisih (Rp)','Achievement']]
    const overview:(string|number|null)[][]=[['Outlet','Bulan','Hari Terisi Target','Hari Terisi Actual','Total Target (Rp)','Total Actual (Rp)','Selisih Data Terinput (Rp)','Achievement Data Terinput']]
    for(const outlet of chosen){
      let totalT=0,totalA=0,coveredT=0,coveredA=0
      for(let d=1;d<=days;d++){
        const date=dateKey(year,month,d),key=`${outlet.id}|${date}`
        const t=targetMap.get(key),a=actualMap.get(key)
        if(t!==undefined){totalT+=t;coveredT++}
        if(a!==undefined){totalA+=a;coveredA++}
        detail.push([outlet.outlet_name,date,t??null,a??null,t!==undefined&&a!==undefined?a-t:null,t!==undefined&&a!==undefined&&t>0?a/t:null])
      }
      overview.push([outlet.outlet_name,`${month}/${year}`,coveredT,coveredA,coveredT?totalT:null,coveredA?totalA:null,coveredT&&coveredA?totalA-totalT:null,coveredT&&coveredA&&totalT>0?totalA/totalT:null])
    }
    downloadXlsx(`KABOBS_OPS_Sales_Report_${year}_${String(month).padStart(2,'0')}.xlsx`,[
      {name:'Rekap Outlet',rows:overview,currencyColumns:[4,5,6],percentColumns:[7]},
      {name:'Sales Harian',rows:detail,currencyColumns:[2,3,4],percentColumns:[5]},
    ])
  }

  function downloadImportTemplate(){
    if(role!=='AM')return
    const chosen=outletId?outlets.filter(o=>o.id===outletId):outlets
    const header=['Outlet','Tanggal','Target Today','Actual Today']
    const rows:(string|number|null)[][]=[header]
    for(const outlet of chosen)for(let day=1;day<=days;day++){
      rows.push([outlet.outlet_name,dateKey(year,month,day),null,null])
    }
    downloadXlsx(`KABOBS_Template_Import_Sales_${year}_${String(month).padStart(2,'0')}.xlsx`,[{name:'Sales Harian',rows}])
  }

  async function pickImportFile(file:File|undefined){
    setImportError('');setImportSuccess('');setImportPreview(null);setOverwriteExisting(false)
    if(!file)return
    setImportReading(true);setImportFileName(file.name)
    try{
      const preview=await readSalesExcel(file,importMode,outlets,outletId,year,month)
      setImportPreview(preview)
    }catch(err){setImportError(err instanceof Error?err.message:String(err))}
    finally{setImportReading(false)}
  }

  const importCounts=useMemo(()=>{
    if(!importPreview)return {target:0,actual:0,existing:0}
    const tm=new Set(targets.map(v=>`${v.outlet_id}|${v.sales_date}`))
    const am=new Set(actuals.map(v=>`${v.outlet_id}|${v.sales_date}`))
    let target=0,actual=0,existing=0
    for(const r of importPreview.rows){
      const key=`${r.outletId}|${r.date}`
      if(r.target!==null){target++;if(tm.has(key))existing++}
      if(importMode==='historical'&&r.actual!==null){actual++;if(am.has(key))existing++}
    }
    return {target,actual,existing}
  },[importPreview,targets,actuals,importMode])

  async function applyImport(){
    if(role!=='AM'||!importPreview||importSaving||working||!!periodError)return
    if(importPreview.warnings.length){
      setImportError('Ada baris yang tidak valid/diabaikan. Perbaiki file Excel dahulu agar data historis tidak terlewat.');return
    }
    if(importCounts.existing>0&&!overwriteExisting){
      // Safe default: skip existing database records, including Leader actuals.
    }
    const message=overwriteExisting
      ?`Timpa data yang sudah ada pada ${importCounts.existing} sel dan impor ${importPreview.rows.length} baris?`
      :`Impor ${importPreview.rows.length} baris? Data yang sudah ada TIDAK akan ditimpa.`
    if(!window.confirm(message))return
    setImportSaving(true);setImportError('');setImportSuccess('')
    try{
      // Re-read database just before saving to avoid relying on stale preview data.
      const [t,a]=await Promise.all([
        supabase.from('sales_daily_targets').select('outlet_id,sales_date').gte('sales_date',start).lte('sales_date',end),
        supabase.from('sales_daily_actuals').select('outlet_id,sales_date').gte('sales_date',start).lte('sales_date',end),
      ])
      if(t.error||a.error)throw new Error('Gagal memeriksa data existing: '+(t.error?.message||a.error?.message))
      const existingT=new Set((t.data||[]).map(v=>`${v.outlet_id}|${v.sales_date}`))
      const existingA=new Set((a.data||[]).map(v=>`${v.outlet_id}|${v.sales_date}`))
      const pendingT=importPreview.rows.filter(r=>r.target!==null&&(overwriteExisting||!existingT.has(`${r.outletId}|${r.date}`)))
        .map(r=>({outlet_id:r.outletId,sales_date:r.date,target_amount:r.target as number}))
      const pendingA=importMode==='historical' ? importPreview.rows.filter(r=>r.actual!==null&&(overwriteExisting||!existingA.has(`${r.outletId}|${r.date}`)))
        .map(r=>({outlet_id:r.outletId,sales_date:r.date,actual_amount:r.actual as number})) : []
      let nT=0,nA=0
      for(let i=0;i<pendingT.length;i+=100){
        const {error}=await supabase.from('sales_daily_targets').upsert(pendingT.slice(i,i+100),{onConflict:'outlet_id,sales_date'})
        if(error)throw new Error(`Target: ${error.message}. ${nT} baris target sudah tersimpan.`)
        nT+=Math.min(100,pendingT.length-i)
      }
      for(let i=0;i<pendingA.length;i+=100){
        const {error}=await supabase.from('sales_daily_actuals').upsert(pendingA.slice(i,i+100),{onConflict:'outlet_id,sales_date'})
        if(error)throw new Error(`Actual: ${error.message}. ${nT} target dan ${nA} actual sudah tersimpan.`)
        nA+=Math.min(100,pendingA.length-i)
      }
      setImportSuccess(`Import berhasil: ${nT} target dan ${nA} actual tersimpan. ${importCounts.target+importCounts.actual-nT-nA} data existing/kosong tidak diubah.`)
      setImportPreview(null);setOverwriteExisting(false)
      setVersion(v=>v+1)
    }catch(err){setImportError(err instanceof Error?err.message:String(err))}
    finally{setImportSaving(false)}
  }

  async function save(date:string,kind:'target'|'actual'){
    if(!outletId)return
    const draftsForKind=kind==='target'?targetDrafts:drafts
    const text=draftsForKind[date]
    const num=text === undefined ? NaN : parseInputRupiah(text)
    if(text===undefined||text.trim()===''||!Number.isFinite(num)||num<0){setMessageType('error');setFeedback('Isi nominal angka valid (0 diperbolehkan).');return}
    setBusyKey(date+kind);setFeedback('')
    const table=kind==='target'?'sales_daily_targets':'sales_daily_actuals'
    const values=kind==='target'?{outlet_id:outletId,sales_date:date,target_amount:num}:{outlet_id:outletId,sales_date:date,actual_amount:num}
    const { error } = await supabase
  .from(table)
  .upsert(
    values as {
      outlet_id: string
      sales_date: string
      target_amount?: number
      actual_amount?: number
    },
    { onConflict: 'outlet_id,sales_date' }
  )
    if(error){setMessageType('error');setFeedback('Gagal menyimpan: '+error.message)}
    else {setMessageType('success');setFeedback(`${kind==='target'?'Target':'Actual'} ${date} tersimpan.`);if(kind==='actual')setDrafts(prev=>{const out={...prev};delete out[date];return out});else setTargetDrafts(prev=>{const out={...prev};delete out[date];return out});setVersion(v=>v+1)}
    setBusyKey('')
  }

  return <>
    <section className="panel">
      <div className="sales-actions" style={{justifyContent:'space-between'}}>
        <div><h3>Daily Sales Report</h3><p className="sales-help">{isAll?'Ringkasan seluruh outlet. Pilih satu outlet pada filter di atas untuk input dan detail tanggal.':`${activeOutletName||'Outlet'} · ${new Intl.DateTimeFormat('id-ID',{month:'long',year:'numeric'}).format(new Date(year,month-1,1))}`}</p></div>
        <div className="sales-import-top-actions">
          {role==='AM'&&<button type="button" className="sales-button secondary sales-import-toggle" aria-expanded={showImportForm} aria-controls="sales-import-form" disabled={importSaving} onClick={()=>setShowImportForm(v=>!v)}>{showImportForm?'↑ Tutup Form Upload':'↓ Buka Form Upload'}</button>}
          {role==='AM'&&<button type="button" className="sales-button secondary" disabled={working||!!periodError} onClick={exportExcel}>⬇ Download Excel</button>}
          <button className="sales-button secondary" disabled={working} onClick={()=>setVersion(v=>v+1)}>{working?'Memuat...':'↻ Refresh data'}</button>
        </div>
      </div>
      {role==='AM'&&showImportForm&&<div className="sales-import-panel" id="sales-import-form">
        <div className="sales-import-header"><div><strong>Upload Excel Sales — Khusus AM</strong><p className="sales-help">Pilih outlet & periode di filter atas. Excel boleh berisi satu atau beberapa outlet. Data akan diperiksa sebelum disimpan.</p></div><button type="button" className="sales-button secondary" onClick={downloadImportTemplate} disabled={working||importSaving}>⬇ Download Template Import</button></div>
        <div className="sales-import-controls"><label>Jenis import<select value={importMode} disabled={importSaving||importReading} onChange={e=>setImportMode(e.target.value as SalesImportMode)}><option value="target">Target Only (rutin)</option><option value="historical">Historis: Target + Actual (Jan 2025–Okt 2026)</option></select></label><label className="sales-import-file">Pilih File Excel (.xlsx)<input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={working||importSaving||importReading} onChange={e=>{void pickImportFile(e.target.files?.[0]);e.target.value=''}} /></label></div>
        <p className="sales-help">{importMode==='target'?'Mode Target Only tidak akan mengubah Actual Today yang diisi Leader.':'Mode Historis hanya menerima tanggal Januari 2025–Oktober 2026. Pilih bulan/tahun historis pada filter di atas.'} Data kosong tidak diubah; nol (0) adalah nilai valid.</p>
        {importReading&&<div className="sales-alert">Membaca dan memvalidasi Excel...</div>}
        {importError&&<div className="sales-alert error" role="alert">{importError}</div>}
        {importSuccess&&<div className="sales-alert success" role="status">{importSuccess}</div>}
        {importPreview&&<div className="sales-import-preview">
          <strong>Preview: {importFileName}</strong>
          <p className="sales-help">Sheet: {importPreview.sheet} · {importPreview.rows.length} baris valid · {importCounts.target} target · {importCounts.actual} actual · {importCounts.existing} data sudah ada</p>
          <div className="sales-import-tablewrap"><table className="sales-import-table"><thead><tr><th>Outlet</th><th>Tanggal</th><th>Target Today</th><th>Actual Today</th></tr></thead><tbody>{importPreview.rows.slice(0,12).map(r=><tr key={`${r.outletId}|${r.date}`}><td>{r.outlet}</td><td>{r.date}</td><td>{r.target===null?'—':fmt(r.target)}</td><td>{importMode==='target'?'Tidak diubah':r.actual===null?'—':fmt(r.actual)}</td></tr>)}</tbody></table></div>
          {importPreview.rows.length>12&&<p className="sales-help">Menampilkan 12 dari {importPreview.rows.length} baris.</p>}
          {importPreview.warnings.length>0&&<div className="sales-alert error"><strong>{importPreview.warnings.length} peringatan — perbaiki Excel sebelum import:</strong>{importPreview.warnings.slice(0,12).map((w,i)=><div key={i}>{w}</div>)}{importPreview.warnings.length>12&&<div>... dan {importPreview.warnings.length-12} peringatan lainnya.</div>}</div>}
          {importCounts.existing>0&&<label className="sales-import-overwrite"><input type="checkbox" checked={overwriteExisting} onChange={e=>setOverwriteExisting(e.target.checked)} /> Izinkan menimpa {importCounts.existing} data yang sudah ada (jika tidak dicentang, data existing dilewati).</label>}
          <div className="sales-import-buttons"><button className="sales-button" type="button" disabled={importSaving||working||importPreview.warnings.length>0} onClick={()=>void applyImport()}>{importSaving?'Menyimpan...':'Terapkan & Simpan Excel'}</button><button className="sales-button secondary" type="button" disabled={importSaving} onClick={()=>setImportPreview(null)}>Batal</button></div>
        </div>}
      </div>}
      {periodError && <div className="sales-alert error">{periodError}. Pastikan SQL sales sudah dijalankan dan policy RLS tersedia.</div>}
      {feedback && <div role="status" className={'sales-alert '+messageType}>{feedback}</div>}
      <div className="sales-summary">
        <div className="sales-metric"><small>{role==='AM'?'SALES MTD':'Actual MTD'}</small><strong>{isAll?fmt(allActual):fmt(totalActual)}</strong><span>{role==='AM'?'Sales Actual MTD':'Pencapaian Sales MTD'}</span></div>
        <div className="sales-metric"><small>TARGET SALES</small><strong>{fmt(isAll?allTarget:totalTarget)}</strong><span>{`Target Sales ${selectedMonthLabel}`}</span></div>
        <div className="sales-metric"><small>{role==='AM'?'SELISIH SALES VS TARGET':'Selisih Actual MTD vs Target MTD'}</small><strong style={{color:displayedGap!==null&&displayedGap<0?'#c73333':'#142039'}}>{displayedGap===null?'—':fmt(displayedGap)}</strong><span>{role==='AM'?'Selisih Sales Actual vs Target':'Selisih Actual Sales vs Target'}</span></div>
        <div className="sales-metric"><small>ACHIEVEMENT SALES VS TARGET</small><strong>{isAll?areaAchievement:mtdAchievement}</strong><span>Achievement Actual vs Target</span></div>
      </div>
      {isAll ? <>
        <p className="sales-help">Data Area Manager berikut merangkum jumlah actual/target yang sudah diinput untuk bulan terpilih. Ini bukan achievement final sebelum semua tanggal lengkap.</p>
        <div className="sales-table-scroll"><table className="sales-table"><thead><tr><th>Outlet</th><th>Actual terinput</th><th>Target terinput</th><th>Hari Actual</th></tr></thead><tbody>{outlets.map(o=><tr key={o.id}><td>{o.outlet_name}</td><td>{fmt(actuals.filter(x=>x.outlet_id===o.id).reduce((a,x)=>a+Number(x.actual_amount),0))}</td><td>{fmt(targets.filter(x=>x.outlet_id===o.id).reduce((a,x)=>a+Number(x.target_amount),0))}</td><td>{actuals.filter(x=>x.outlet_id===o.id).length}/{days}</td></tr>)}</tbody></table></div>
      </> : <>
        <div className="sales-table-scroll"><table className="sales-table sales-table--compact"><thead><tr><th>Tanggal</th><th>Target Today</th><th>Actual Today</th><th>Target To-Date</th><th>Actual To-Date</th><th>Selisih vs Target</th><th>Achievement Today</th><th>Aksi</th></tr></thead><tbody>
          {tableRows.map(r=>{
            const tValue=targetDrafts[r.date]??(r.target===null?'':String(r.target))
            const aValue=drafts[r.date]??(r.actual===null?'':String(r.actual))
            const dailyGap=r.target!==null&&r.actual!==null?r.actual-r.target:null
            return <tr key={r.date} className={r.date===today?'day-today':''}>
              <td><strong>{new Intl.DateTimeFormat('id-ID',{day:'2-digit',month:'short'}).format(new Date(year,month-1,r.day))}</strong></td>
              <td>{role==='AM'?<input aria-label={'Target '+r.date} type="text" inputMode="numeric" value={formatInputRupiah(tValue)} onChange={e=>setTargetDrafts(p=>({...p,[r.date]:e.target.value.replace(/\D/g,'')}))} />:r.target===null?<span className="missing">Belum ada</span>:fmt(r.target)}</td>
              <td><input aria-label={'Actual '+r.date} type="text" inputMode="numeric" value={formatInputRupiah(aValue)} onChange={e=>setDrafts(p=>({...p,[r.date]:e.target.value.replace(/\D/g,'')}))} /></td>
              <td>{r.cumulativeTarget!==null?fmt(r.cumulativeTarget):<span className="missing">Belum lengkap</span>}</td>
              <td>{r.cumulativeActual!==null?fmt(r.cumulativeActual):<span className="missing">Belum lengkap</span>}</td>
              <td className={dailyGap!==null?(dailyGap<0?'negative':'positive'):''}>{dailyGap===null?'—':fmt(dailyGap)}</td>
              <td>{r.target!==null&&r.actual!==null?pct(r.actual,r.target):'—'}</td>
              <td className="sales-action-cell"><div className="sales-actions sales-actions--row">{role==='AM'&&<button className="sales-button secondary" disabled={!!busyKey||tValue===''} onClick={()=>save(r.date,'target')}>Target</button>}<button className="sales-button" disabled={!!busyKey||aValue===''} onClick={()=>save(r.date,'actual')}>{busyKey===r.date+'actual'?'...':'Simpan'}</button></div></td>
            </tr>
          })}
          </tbody></table></div>
      </>}
    </section>
  </>
}
