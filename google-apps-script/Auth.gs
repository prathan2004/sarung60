function validUsername(value) {
  check(typeof value === 'string' && /^[a-z0-9_.-]{3,40}$/.test(value), 'ชื่อผู้ใช้ใช้ a-z, 0-9, จุด, ขีด หรือขีดล่าง 3–40 ตัว');
  return value;
}
function seal(hash, salt = uid()) {
  check(typeof hash === 'string' && /^[a-f0-9]{128}$/.test(hash), 'รหัสผ่านไม่ถูกต้อง');
  return salt + '.' + sign(hash, salt);
}
function matches(hash, stored) {
  return !!stored && same(seal(hash,stored.split('.')[0]),stored);
}
function accountRows(role) { return rows(role === 'admin' ? 'Admins' : 'Members'); }
function accountId(row) { return row.AdminID || row.MemberID; }
function loginLimit(key, limit) {
  const cache = CacheService.getScriptCache();
  const count = Number(cache.get(key) || 0);
  check(count < limit, 'ลองเข้าสู่ระบบใหม่ในอีก 10 นาที', 429);
  cache.put(key,String(count+1),600);
}
function login(data) {
  const username = validUsername(data.username);
  const role = data.portal === 'admin' ? 'admin' : 'member';
  const key = 'login:' + username;
  loginLimit(key,8);
  loginLimit('ip:' + data.clientKey,40);
  const row = accountRows(role).find(item => item.Username === username);
  check(row && row.Role === role && row.Active === true && matches(data.password,row.PasswordHash),
    'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง', 401);
  CacheService.getScriptCache().remove(key);
  const id = accountId(row);
  const sid = uid();
  const expires = Date.now() + 8*60*60*1000;
  const value = [sid,id,role,expires].join('.');
  commit([put('Sessions',[sid,id,expires]),audit({id},'LOGIN',row.MemberID || '')]);
  return {token:value+'.'+sign(value,props().getProperty('SESSION_SECRET')),role};
}
function authenticate(token) {
  check(typeof token === 'string' && token.length < 256, 'กรุณาเข้าสู่ระบบ',401);
  const parts = token.split('.');
  const [sid,id,role,expires,signature] = parts;
  const value = parts.slice(0,4).join('.');
  check(parts.length === 5 && ['admin','member'].includes(role) && Number(expires) > Date.now() &&
    same(signature,sign(value,props().getProperty('SESSION_SECRET'))), 'เซสชันหมดอายุ',401);
  const row = accountRows(role).find(item => accountId(item) === id);
  const session = rows('Sessions').find(item => item.SessionID === sid && item.AccountID === id &&
    item.ExpiresAt === Number(expires));
  check(session && row && row.Active === true && row.Role === role, 'กรุณาเข้าสู่ระบบ',401);
  return {id,role,row,session};
}
function revoke(id) {
  return rows('Sessions').filter(item => item.AccountID === id).map(item => erase('Sessions',item._index));
}
function changePassword(actor,data) {
  const r = actor.row;
  const minimum = actor.role === 'admin' ? 12 : 4;
  check(Number.isInteger(data.passwordLength) && data.passwordLength >= minimum,
    'รหัสผ่านใหม่ต้องมีอย่างน้อย ' + minimum + ' ตัวอักษร');
  check(matches(data.currentPassword,r.PasswordHash), 'รหัสผ่านปัจจุบันไม่ถูกต้อง',403);
  const hash = seal(data.password);
  const update = actor.role === 'admin'
    ? put('Admins',[actor.id,r.Username,hash,'admin',true,r.CreatedAt],r._index)
    : put('Members',[actor.id,r.Name,r.Username,hash,'member',true,r.CreatedAt,now()],r._index);
  commit([update,...revoke(actor.id),audit(actor,'PASSWORD_CHANGED',r.MemberID || '')]);
  return {};
}
