import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function test() {
  const { error } = await supabase.from('call_logs').insert([{
    tenant_id: '123e4567-e89b-12d3-a456-426614174000',
    call_type: 'inbound',
    call_status: 'completed',
    duration_seconds: 0,
    user_id: null
  }]);
  console.log("Insert Error:", error);
}
test();
