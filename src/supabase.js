import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error("Supabase 접속 정보가 누락되었습니다. .env 파일을 확인해 주세요.");
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
