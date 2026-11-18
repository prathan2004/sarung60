import {createHmac, scrypt} from 'node:crypto';
import {promisify} from 'node:util';

const derive = promisify(scrypt);
const limit = 2_900_000;
const cookieName = '__Secure-saving_session';
const accountActions = new Set(['login','password','memberReset','memberSave']);

export async function hashPassword(password, pepper) {
  return (await derive(password, 'saving-password-v1:' + pepper, 64,
    {N:131072,r:8,p:1,maxmem:160*1024*1024})).toString('hex');
}
function json(data,status=200,cookie) {
  const headers = {'content-type':'application/json; charset=utf-8','cache-control':'private, no-store',
    'x-content-type-options':'nosniff'};
  if (cookie) headers['set-cookie'] = cookie;
  return new Response(JSON.stringify(data),{status,headers});
}
const error = (message,status) => json({error:message},status);
function cookie(value,age) {
  return cookieName+'='+value+'; Path=/api; HttpOnly; Secure; SameSite=Strict; Max-Age='+age;
}
function inputError(message) { return Object.assign(new Error(message),{status:400}); }
async function protectedFields(action,input,pepper,ip) {
  const data = {...input};
  if (action === 'login') {
    data.username = typeof data.username === 'string' ? data.username.trim().toLowerCase() : '';
    if (!/^[a-z0-9_.-]{3,40}$/.test(data.username)) throw inputError('ชื่อผู้ใช้ไม่ถูกต้อง');
    data.clientKey = createHmac('sha256',pepper).update(ip || 'unknown').digest('hex');
  }
  if (action === 'memberSave') {
    data.username = typeof data.username === 'string' ? data.username.trim().toLowerCase() : '';
    if (data.id) delete data.password;
  }
  const fields = action === 'password' ? ['currentPassword','password'] :
    action === 'memberSave' && data.id ? [] : ['password'];
  for (const field of fields) {
    const minimum = field === 'currentPassword' || action === 'login' ? 1 : 12;
    const value = data[field];
    if (typeof value !== 'string' || [...value].length < minimum || Buffer.byteLength(value) > 256) {
      throw inputError(minimum === 1 ? 'รหัสผ่านไม่ถูกต้อง' : 'รหัสผ่านใหม่ต้องมีอย่างน้อย 12 ตัวอักษร และไม่เกิน 256 ไบต์');
    }
  }
  for (const field of fields) data[field] = await hashPassword(data[field],pepper);
  return data;
}
export default async function handler(request,context) {
  if (request.method !== 'POST') return error('รองรับเฉพาะ POST',405);
  if (request.headers.get('origin') !== new URL(request.url).origin ||
      request.headers.get('sec-fetch-site') === 'cross-site') return error('ไม่มีสิทธิ์เข้าถึง',403);
  if (!/^application\/json(?:;|$)/i.test(request.headers.get('content-type') || '')) return error('รูปแบบไม่ถูกต้อง',415);
  const endpoint = process.env.GAS_URL || '';
  const secret = process.env.PROXY_SECRET || '';
  const pepper = process.env.PASSWORD_PEPPER || '';
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(endpoint) ||
      !/^[a-f0-9]{64}$/.test(secret) || !/^[a-f0-9]{64}$/.test(pepper) || pepper === secret) {
    return error('ยังไม่ได้ตั้งค่าการเชื่อมต่อระบบ',503);
  }
  const session = (request.headers.get('cookie') || '').split(';').map(value => value.trim())
    .find(value => value.startsWith(cookieName+'='))?.slice(cookieName.length+1) || '';
  try {
    if (Number(request.headers.get('content-length')) > limit) return error('ข้อมูลใหญ่เกินกำหนด',413);
    const raw = await request.text();
    if (Buffer.byteLength(raw) > limit) return error('ข้อมูลใหญ่เกินกำหนด',413);
    let input;
    try { input = JSON.parse(raw); } catch { return error('รูปแบบไม่ถูกต้อง',400); }
    if (!input || typeof input.action !== 'string' || !input.data ||
        typeof input.data !== 'object' || Array.isArray(input.data)) return error('รูปแบบไม่ถูกต้อง',400);
    if (input.action !== 'login' && !session) return error('กรุณาเข้าสู่ระบบ',401);
    const data = accountActions.has(input.action)
      ? await protectedFields(input.action,input.data,pepper,context.ip) : input.data;
    const signal = AbortSignal.timeout(45000);
    let upstream = await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({action:input.action,data,token:session,secret}),redirect:'manual',signal});
    if ([302,303].includes(upstream.status)) {
      const redirected = new URL(upstream.headers.get('location') || '',endpoint);
      if (redirected.origin !== 'https://script.googleusercontent.com') return error('เชื่อมต่อ Google Apps Script ไม่สำเร็จ',502);
      upstream = await fetch(redirected,{redirect:'error',signal});
    }
    if (!upstream.ok) return error('เชื่อมต่อ Google Apps Script ไม่สำเร็จ',502);
    const result = await upstream.json();
    if (!result.ok) {
      const status = Number.isInteger(result.status) && result.status >= 400 && result.status <= 599 ? result.status : 502;
      return error(result.error || 'ทำรายการไม่สำเร็จ',status);
    }
    if (input.action === 'login') return json({role:result.data.role},200,cookie(result.data.token,28800));
    return json(result.data,200,['logout','password'].includes(input.action) ? cookie('',0) : undefined);
  } catch (failure) {
    return error(failure.status === 400 ? failure.message : 'ระบบเชื่อมต่อไม่ได้ กรุณาลองอีกครั้ง',
      failure.status === 400 ? 400 : 502);
  }
}
