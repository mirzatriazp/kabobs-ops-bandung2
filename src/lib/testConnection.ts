import { supabase } from './supabase'

export async function testConnection() {
  const { data, error } = await supabase
    .from('outlets')
    .select('outlet_code, outlet_name')

  if (error) {
    console.error('Supabase error:', error.message)
    return false
  }

  console.log('Outlet data:', data)
  return true
}