function check(condition, message, code = 400) {
  if (!condition) throw Object.assign(new Error(message), {code});
}
function uid() { return Utilities.getUuid(); }
function now() { return new Date().toISOString(); }
function localDate(date = new Date()) { return Utilities.formatDate(date, ZONE, 'yyyy-MM-dd'); }
function clean(value, max, required = true) {
  const result = typeof value === 'string' ? value.trim() : '';
  check(result.length <= max && (!required || result.length), 'ข้อมูลไม่ถูกต้อง');
  return result;
}
function locked(action) {
  const lock = LockService.getScriptLock();
  check(lock.tryLock(15000), 'ระบบกำลังทำรายการ กรุณาลองอีกครั้ง', 503);
  try { return action(); } finally { lock.releaseLock(); }
}
function sign(value, secret) {
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(value, secret)).replace(/=+$/, '');
}
function same(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' || left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}
