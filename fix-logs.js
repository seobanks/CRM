import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function fix() {
  const { data: d1, error: e1 } = await supabase.from('call_logs').update({ user_id: null }).like('notes', '%Agent: null%').select('id');
  const { data: d2, error: e2 } = await supabase.from('call_logs').update({ user_id: null }).like('notes', '%Agent: undefined%').select('id');
  const { data: d3, error: e3 } = await supabase.from('call_logs').update({ user_id: null }).ilike('notes', '%Agent: %').select('id');
  
  // also check if "Agent:" is exactly at the end
  const { data: d4, error: e4 } = await supabase.from('call_logs').update({ user_id: null }).ilike('notes', '%Agent:').select('id');
  
  console.log("Fixed:", { d1: d1?.length, d2: d2?.length, d3: d3?.length, d4: d4?.length });
  if (e1 || e2 || e3 || e4) console.error("Errors:", {e1, e2, e3, e4});
}
fix();
