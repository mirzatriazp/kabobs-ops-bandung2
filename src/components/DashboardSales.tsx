import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import './DashboardSalesFinal.css'
import { supabase } from '../lib/supabase'

type Outlet = { id: string; outlet_name: string; outlet_code: string }
type Props = { role: 'AM' | 'LEADER'; outletId: string; outlets: Outlet[]; month: number; year: number; teamOnDuty?: ReactNode }
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

export default function DashboardSales({role,outletId,outlets,month,year,teamOnDuty}:Props) {
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
    // Periode mendatang tetap menampilkan kartu; bila belum ada data, nilainya 0 / —.
    const isFuture=today<first
    const cutoff=isFuture||today>end?new Date(year,month,0).getDate():Number(today.slice(-2))
    return {
      current:snapshot(year,month,cutoff,outletCount,actuals,targets),
      previous:snapshot(previousMonthYear,previousMonth,cutoff,outletCount,actuals,targets),
      lastYear:snapshot(year-1,month,cutoff,outletCount,actuals,targets),
      cutoff,
      isFuture,
    }
  },[actuals,targets,year,month,outletCount,previousMonthYear,previousMonth])

  if(loading)return <section className="panel"><h3>Sales Performance</h3><p className="muted">Memuat data Sales...</p></section>
  if(error)return <section className="panel"><h3>Sales Performance</h3><p className="sales-alert error">{error}</p><button className="sales-button" onClick={()=>setRefresh(x=>x+1)}>Coba lagi</button></section>

  const {current,previous,lastYear}=data
  // Periode berjalan/lampau mempertahankan rumus lama.
  // Periode mendatang menampilkan target yang sudah diinput walau actual belum ada.
  const comparable=data.isFuture?current.targetDays>0:(current.actualDays>0&&current.targetDays>0)
  const achievement=comparable&&current.target>0?(current.actual/current.target*100):null
  const gap=comparable?current.actual-current.target:null
  const monthlyTarget=targets
    .filter(x=>x.sales_date>=key(year,month,1)&&x.sales_date<=key(year,month,new Date(year,month,0).getDate()))
    .reduce((sum,x)=>sum+Number(x.target_amount||0),0)
  const monthlyTargetCount=targets.filter(x=>x.sales_date>=key(year,month,1)&&x.sales_date<=key(year,month,new Date(year,month,0).getDate())).length
  const expectedMonthlyDays=new Date(year,month,0).getDate()*outletCount
  const compareData=[
    {title:'MTD Bulan Dipilih',value:current.actual},
    {title:`Last Month · ${previous.label}`,value:previous.actual},
    {title:`Last Year · ${lastYear.label}`,value:lastYear.actual},
  ]
  const differenceData=[
    {title:'Selisih MTD vs Target',value:monthlyTargetCount?current.actual-monthlyTarget:null,description:monthlyTargetCount<expectedMonthlyDays?'Target bulanan belum lengkap':''},
    {title:'Selisih vs Last Month',value:current.actualDays&&previous.actualDays?current.actual-previous.actual:null,description:''},
    {title:'Selisih vs Last Year',value:current.actualDays&&lastYear.actualDays?current.actual-lastYear.actual:null,description:''},
  ]
  const diffText=(v:number|null)=>v===null?'—':`${v>0?'+':v<0?'−':''}${fmt(Math.abs(v))}`
  const tile=(label:string,value:string,note:string,negative=false)=> <div className="stat-card dashboard-kpi-card" key={label}><div className="stat-title">{label}</div><div className="stat-empty" style={{color:negative?'#c73333':'#142039'}}>{value}</div><div className="dashboard-kpi-note">{note}</div></div>
  return <>
    <div className="stats">
      {tile('Sales MTD',fmt(current.actual),'Pencapaian sales')}
      {tile('Target Sales',fmt(current.target),`Target Sales ${monthLabel(year,month)}`)}
      {tile('Selisih Actual vs Target',gap===null?'—':fmt(gap),'Selisih pencapaian Sales vs Target',gap!==null&&gap<0)}
      {tile('Achievement MTD',achievement===null?'—':achievement.toFixed(2)+'%','Persentase Pencapaian Sales')}
    </div>
    <div className="dashboard-grid dashboard-sales-team-grid">
      <section className="panel dashboard-sales-compare-panel">
        <h3>Perbandingan Sales</h3>
        <p className="muted">Perbandingan MTD vs Last Month vs Last Year</p>
        <div className="sales-compare">
          {compareData.map(x=><div key={x.title}><span>{x.title}</span><strong>{fmt(x.value)}</strong></div>)}
        </div>
        <div className="sales-diff-compare">
          {differenceData.map(x=><div key={x.title} className="sales-diff-box"><span>{x.title}</span><strong className={x.value===null?'is-empty':x.value<0?'is-negative':x.value>0?'is-positive':'is-neutral'}>{diffText(x.value)}</strong>{x.description&&<small>{x.description}</small>}</div>)}
        </div>
      </section>
      {teamOnDuty ? <div className="dashboard-tod-slot">{teamOnDuty}</div> : null}
    </div>
  </>
}
