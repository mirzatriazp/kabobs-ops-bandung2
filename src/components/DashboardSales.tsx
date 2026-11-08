import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

type Outlet = { id: string; outlet_name: string; outlet_code: string }
type Props = { role: 'AM' | 'LEADER'; outletId: string; outlets: Outlet[]; month: number; year: number }
type ValueRow = { outlet_id: string; sales_date: string; target_amount?: number; actual_amount?: number }

type Snapshot = {
  label: string
  actual: number
  target: number
  targetDays: number
  actualDays: number
  matchedDays: number
  totalDays: number
  matchedActual: number
  matchedTarget: number
}
const fmt = (value: number) => 'Rp ' + Math.round(value).toLocaleString('id-ID')
const key = (year: number, month: number, day: number) => `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`
const monthLabel = (year: number, month: number) => new Intl.DateTimeFormat('id-ID', {month:'long',year:'numeric'}).format(new Date(year, month-1, 1))
const jakartaToday = () => new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Jakarta', year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())

function snapshot(year:number, month:number, cutoffDay:number, outletCount:number, actuals:ValueRow[], targets:ValueRow[]):Snapshot {
  const days=Math.min(cutoffDay, new Date(year,month,0).getDate())
  const targetByDate=new Map(targets.filter(x=>x.sales_date>=key(year,month,1)&&x.sales_date<=key(year,month,days)).map(x=>[`${x.outlet_id}|${x.sales_date}`,Number(x.target_amount)]))
  const actualByDate=new Map(actuals.filter(x=>x.sales_date>=key(year,month,1)&&x.sales_date<=key(year,month,days)).map(x=>[`${x.outlet_id}|${x.sales_date}`,Number(x.actual_amount)]))
  let actual=0,target=0,matchedActual=0,matchedTarget=0,matchedDays=0
  for(const [k,v] of actualByDate) {
    actual+=v
    if(targetByDate.has(k)) {matchedActual+=v; matchedTarget+=targetByDate.get(k)!; matchedDays++}
  }
  for(const value of targetByDate.values()) target+=value
  return {label:monthLabel(year,month),actual,target,actualDays:actualByDate.size,targetDays:targetByDate.size,matchedDays,matchedActual,matchedTarget,totalDays:days*outletCount}
}

export default function DashboardSales({role,outletId,outlets,month,year}:Props) {
  const [actuals,setActuals]=useState<ValueRow[]>([])
  const [targets,setTargets]=useState<ValueRow[]>([])
  const [loading,setLoading]=useState(true)
  const [error,setError]=useState('')
  const [refresh,setRefresh]=useState(0)
  const isAll=role==='AM'&&!outletId
  const outletCount=isAll?outlets.length:1
  const lastMonthDate=new Date(year,month-2,1)
  const previousMonth=lastMonthDate.getMonth()+1
  const previousMonthYear=lastMonthDate.getFullYear()

  const load=useCallback(async()=>{
    setLoading(true);setError('')
    // Three monthly ranges; only selected outlet is fetched for leaders.
    const ranges=[
      [key(year,month,1),key(year,month,new Date(year,month,0).getDate())],
      [key(previousMonthYear,previousMonth,1),key(previousMonthYear,previousMonth,new Date(previousMonthYear,previousMonth,0).getDate())],
      [key(year-1,month,1),key(year-1,month,new Date(year-1,month,0).getDate())],
    ]
    const get=async(table:string,column:string):Promise<ValueRow[]>=>{
      const chunks=await Promise.all(ranges.map(async([start,end])=>{
        let query=supabase.from(table).select(`outlet_id,sales_date,${column}`).gte('sales_date',start).lte('sales_date',end)
        if(outletId)query=query.eq('outlet_id',outletId)
        const {data,error}=await query
        if(error) throw error
        return (data??[]) as unknown as ValueRow[]
      }))
      return chunks.flat()
    }
    try {
      const [a,t]=await Promise.all([get('sales_daily_actuals','actual_amount'),get('sales_daily_targets','target_amount')])
      setActuals(a);setTargets(t)
    } catch(e) {
      setError(e instanceof Error?e.message:'Gagal memuat laporan sales')
    } finally {setLoading(false)}
  },[year,month,previousMonth,previousMonthYear,outletId])
  useEffect(()=>{void load()},[load,refresh])
  useEffect(()=>{
    const onFocus=()=>setRefresh(x=>x+1)
    window.addEventListener('focus',onFocus)
    return ()=>window.removeEventListener('focus',onFocus)
  },[])

  const data=useMemo(()=>{
    const today=jakartaToday()
    const first=key(year,month,1)
    const end=key(year,month,new Date(year,month,0).getDate())
    const cutoff=today<first?0:today>end?new Date(year,month,0).getDate():Number(today.slice(-2))
    if(cutoff===0)return null
    return {
      current:snapshot(year,month,cutoff,outletCount,actuals,targets),
      previous:snapshot(previousMonthYear,previousMonth,cutoff,outletCount,actuals,targets),
      lastYear:snapshot(year-1,month,cutoff,outletCount,actuals,targets),
      cutoff,
    }
  },[actuals,targets,year,month,outletCount,previousMonthYear,previousMonth])

  if(loading)return <section className="panel"><h3>Sales Performance</h3><p className="muted">Memuat data Sales...</p></section>
  if(error)return <section className="panel"><h3>Sales Performance</h3><p className="sales-alert error">{error}</p><button className="sales-button" onClick={()=>setRefresh(x=>x+1)}>Coba lagi</button></section>
  if(!data)return <section className="panel"><h3>Sales Performance</h3><p className="muted">Periode yang dipilih belum berjalan. Belum ada MTD.</p></section>

  const {current,previous,lastYear,cutoff}=data
  const complete=current.totalDays>0&&current.actualDays===current.totalDays&&current.targetDays===current.totalDays
  const achievement=current.matchedTarget>0?(current.matchedActual/current.matchedTarget*100):null
  const gap=current.matchedDays>0?current.matchedActual-current.matchedTarget:null
  const tile=(label:string,value:string,description:string)=> <div className="stat-card" key={label}><div className="stat-title">{label}</div><div className="stat-empty">{value}</div><div className="stat-foot">{description}</div></div>
  return <>
    <div className="stats">
      {tile('Sales MTD (Terinput)',fmt(current.actual),`${current.actualDays}/${current.totalDays} hari-outlet terisi · ${current.label}`)}
      {tile('Target To-Date (Terinput)',fmt(current.target),`${current.targetDays}/${current.totalDays} hari-outlet target terisi`)}
      {tile('Selisih To-Date',gap===null?'—':fmt(gap),`Perbandingan ${current.matchedDays} tanggal-outlet dengan target & actual lengkap`)}
      {tile('Achievement',achievement===null?'—':achievement.toFixed(2)+'%',complete?'Periode sudah lengkap':'SEMENTARA · hanya tanggal yang memiliki target & actual')}
    </div>
    <div className="dashboard-grid">
      <section className="panel">
        <h3>Perbandingan Sales</h3>
        <p className="muted">Dibandingkan sampai tanggal {cutoff} pada masing-masing bulan (jika tanggal tersedia).</p>
        <div className="sales-compare"><div><span>Bulan dipilih</span><strong>{fmt(current.actual)}</strong><small>{current.actualDays} hari-outlet terisi</small></div><div><span>Bulan lalu · {previous.label}</span><strong>{fmt(previous.actual)}</strong><small>{previous.actualDays} hari-outlet terisi</small></div><div><span>Tahun lalu · {lastYear.label}</span><strong>{fmt(lastYear.actual)}</strong><small>{lastYear.actualDays} hari-outlet terisi</small></div></div>
        <p className="muted">Angka perbandingan adalah jumlah data yang sudah masuk, bukan pertumbuhan final bila historinya belum lengkap.</p>
      </section>
      <section className="panel">
        <h3>Status Kelengkapan Sales</h3>
        <p className="muted">Periode {current.label}, sampai tanggal {cutoff}. {isAll?'Akumulasi 8 outlet.':'Outlet terpilih.'}</p>
        <p><strong>Actual:</strong> {current.actualDays} / {current.totalDays} hari-outlet</p>
        <p><strong>Target:</strong> {current.targetDays} / {current.totalDays} hari-outlet</p>
        <p><strong>Data cocok:</strong> {current.matchedDays} / {current.totalDays} hari-outlet</p>
        <div className="notice">{complete?'Data target dan actual periode cutoff lengkap.':'Angka Sales dan achievement masih bersifat sementara karena belum semua tanggal terisi.'}</div>
      </section>
    </div>
  </>
}
