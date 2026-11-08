import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import './OperationalOverview.css'

type Outlet = { id: string; outlet_code: string; outlet_name: string }
type Props = { role: 'AM' | 'LEADER'; outletId: string; outlets: Outlet[]; month: number; year: number }
type Dso = { outlet_id: string; check_date: string; status: 'aman' | 'hitung_ulang'; issues: string; am_notes: string }
type Maintenance = { id: string; outlet_id: string; equipment: string; status: string; priority: string; created_at: string }
type Visit = { id: string; outlet_id: string; finding: string; status: string; due_date: string; visit_date: string }
type Piq = { outlet_id: string; audit_month: number; score_1: number; score_2: number; score_3: number; score_4: number; score_5: number; score_6: number; score_7: number }
const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`
const dateWIB = () => { const parts = new Intl.DateTimeFormat('en-GB',{ timeZone:'Asia/Jakarta',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());const get=(t:string)=>Number(parts.find(p=>p.type===t)?.value||0);return {year:get('year'),month:get('month'),day:get('day')} }
const nice = (s:string) => new Date(`${s}T12:00:00+07:00`).toLocaleDateString('id-ID',{day:'numeric',month:'short',year:'numeric',timeZone:'Asia/Jakarta'})
const piqScore=(p:Piq)=>[p.score_1,p.score_2,p.score_3,p.score_4,p.score_5,p.score_6,p.score_7].reduce((a,b)=>a+Number(b||0),0)
const errorText=(e:unknown)=>e instanceof Error?e.message:String(e)
// Pisahkan temuan per baris agar “Torbig -1” dan “Keju +2” tidak menyatu.
const formatDsoIssues=(raw:string|null|undefined)=>{
  if(!raw?.trim())return 'Perlu hitung ulang'
  return raw.split(/\r?\n|;|\s*\|\s*/).map(v=>v.trim()).filter(Boolean).join(', ')
}

export default function OperationalOverview({role,outletId,outlets,month,year}:Props){
  const [dso,setDso]=useState<Dso[]>([])
  const [maint,setMaint]=useState<Maintenance[]>([])
  const [visit,setVisit]=useState<Visit[]>([])
  const [piq,setPiq]=useState<Piq[]>([])
  const [loading,setLoading]=useState(true)
  const [error,setError]=useState('')
  const [revision,setRevision]=useState(0)
  const today=dateWIB()
  const todayKey=iso(today.year,today.month,today.day)
  const selected=useMemo(()=>outlets.filter(o=>role==='AM'?(!outletId||outletId===o.id):o.id===outletId),[outlets,role,outletId])
  const selectedIds=useMemo(()=>new Set(selected.map(o=>o.id)),[selected])
  const labelById=useMemo(()=>new Map(outlets.map(o=>[o.id,o.outlet_name])),[outlets])
  
  const reload=useCallback(()=>setRevision(v=>v+1),[])
  useEffect(()=>{
    let cancelled=false
    async function run(){
      setLoading(true);setError('')
      try {
        if(role==='LEADER'&&!outletId) throw new Error('Akun Leader belum terhubung ke outlet.')
        let d=supabase.from('ops_dso_daily').select('outlet_id,check_date,status,issues,am_notes').eq('check_date',todayKey)
        let m=supabase.from('maintenance_requests').select('id,outlet_id,equipment,status,priority,created_at').neq('status','done').order('created_at',{ascending:false}).limit(300)
        let v=supabase.from('am_visit_findings').select('id,outlet_id,finding,status,due_date,visit_date').neq('status','done').order('due_date',{ascending:true}).limit(300)
        let p=supabase.from('piq_audits').select('outlet_id,audit_month,score_1,score_2,score_3,score_4,score_5,score_6,score_7').eq('audit_year',year)
        if(outletId){ d=d.eq('outlet_id',outletId);m=m.eq('outlet_id',outletId);v=v.eq('outlet_id',outletId);p=p.eq('outlet_id',outletId) }
        const [dr,mr,vr,pr]=await Promise.all([d,m,v,p])
        const fail=[dr.error,mr.error,vr.error,pr.error].find(Boolean)
        if(fail)throw fail
        if(!cancelled){setDso(dr.data as Dso[]||[]);setMaint(mr.data as Maintenance[]||[]);setVisit(vr.data as Visit[]||[]);setPiq(pr.data as Piq[]||[])}
      }catch(e){if(!cancelled)setError('Gagal memuat ringkasan operasional: '+errorText(e))}
      finally{if(!cancelled)setLoading(false)}
    }
    void run()
    return()=>{cancelled=true}
  },[outletId,role,todayKey,year,revision])
  const review=dso.filter(x=>selectedIds.has(x.outlet_id)&&x.check_date===todayKey)
  const recheck=review.filter(x=>x.status==='hitung_ulang')
  const aman=review.filter(x=>x.status==='aman').length
  const unreviewed=Math.max(0,selected.length-review.length)
  const openMaint=maint.filter(x=>selectedIds.has(x.outlet_id)&&x.status!=='done'&&x.status!=='rejected')
  const openVisit=visit.filter(x=>selectedIds.has(x.outlet_id)&&x.status!=='done')
  const todayIso=todayKey
  const overdue=openVisit.filter(x=>x.due_date<todayIso)
  const currentPiq=piq.filter(x=>selectedIds.has(x.outlet_id)&&x.audit_month===month)
  const avgPiq=currentPiq.length?currentPiq.reduce((a,p)=>a+piqScore(p),0)/currentPiq.length:null
  const monthLabel=new Date(year,month-1,1).toLocaleDateString('id-ID',{month:'long',year:'numeric'})
  return <section className="ops-overview" aria-label="Ringkasan Operasional">
    <div className="ops-overview-head"><div><h3>Ringkasan Operasional</h3><p>{monthLabel} · {role==='AM'&&!outletId?'8 outlet Area Bandung 2':selected[0]?.outlet_name||'Outlet'}</p></div><button type="button" onClick={reload} disabled={loading}>{loading?'Memuat…':'↻ Refresh'}</button></div>
    {error&&<p className="ops-overview-error" role="alert">{error}</p>}
    <div className="ops-overview-stats ops-overview-stats-three">
      <article><span>Maintenance Aktif</span><strong>{openMaint.length}</strong><em>Tidak termasuk selesai/ditolak</em></article>
      <article><span>Temuan Visit</span><strong>{openVisit.length}</strong><em>Lewat due date: {overdue.length}</em></article>
      <article><span>PIQ Bulan Dipilih</span><strong>{avgPiq===null?'—':`${avgPiq.toLocaleString('id-ID',{maximumFractionDigits:1})} poin`}</strong><em>{currentPiq.length} audit · Maksimal 14 poin</em></article>
    </div>
    <div className="ops-overview-lists ops-overview-lists-three">
      <article><h4>DSO Hari Ini</h4>
        {recheck.length>0?<ul>{recheck.slice(0,6).map((x,i)=><li key={`${x.outlet_id}-${x.check_date}-${i}`}><b>{labelById.get(x.outlet_id)||'Outlet'}</b><span>{formatDsoIssues(x.issues)}</span>{x.am_notes&&<small>{x.am_notes}</small>}</li>)}</ul>
          :unreviewed>0?<p className="ops-muted">{aman>0?`${aman} outlet Aman · `:''}{unreviewed} outlet belum diperiksa hari ini.</p>
          :<p className="ops-muted ops-dso-safe">DSO hari ini aman</p>}
        {recheck.length>6&&<p className="ops-muted">+{recheck.length-6} temuan lainnya di Inventory &amp; DSO</p>}
      </article>
      <article><h4>Visit AM — Tindak Lanjut</h4>{!openVisit.length?<p className="ops-muted">Tidak ada temuan visit yang masih terbuka.</p>:<ul>{openVisit.slice(0,6).map(x=><li key={x.id}><b>{labelById.get(x.outlet_id)||'Outlet'}</b><span>{x.finding}</span><small className={x.due_date<todayIso?'ops-warning':''}>Due {nice(x.due_date)} · {x.status==='submitted'?'Menunggu verifikasi':x.status==='revision'?'Perlu revisi':'Belum dituntaskan'}</small></li>)}</ul>}{openVisit.length>6&&<p className="ops-muted">+{openVisit.length-6} temuan lainnya di Report Visit AM</p>}</article>
      <article><h4>Maintenance — Belum Selesai</h4>{!openMaint.length?<p className="ops-muted">Tidak ada pengajuan maintenance aktif.</p>:<ul>{openMaint.slice(0,6).map(x=><li key={x.id}><b>{labelById.get(x.outlet_id)||'Outlet'}</b><span>{x.equipment}</span><small>{x.priority} · {x.status==='pending_am'?'Menunggu verifikasi AM':x.status==='coordinated'?'Sudah dikoordinasikan':'Dalam proses'}</small></li>)}</ul>}{openMaint.length>6&&<p className="ops-muted">+{openMaint.length-6} pengajuan lainnya di Defect &amp; Maintenance</p>}</article>
    </div>
  </section>
}
