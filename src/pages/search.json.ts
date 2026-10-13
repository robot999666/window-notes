import { notes } from '../data/site';
export function GET() {
  return new Response(JSON.stringify(notes), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
