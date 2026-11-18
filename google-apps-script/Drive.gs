function slipRoot() { return DriveApp.getFolderById(props().getProperty('SLIPS_ID')); }
function folder(parent,name) {
  const found = parent.getFoldersByName(name);
  return found.hasNext() ? found.next() : parent.createFolder(name);
}
function slipFolder() {
  const [year,month] = localDate().split('-');
  return folder(folder(slipRoot(),year),month);
}
function fileType(bytes) {
  const at = i => bytes[i] & 255;
  const has = (offset,signature) => signature.every((value,i) => at(offset+i) === value);
  if (bytes.length > 4 && has(0,[255,216,255]) && has(bytes.length-2,[255,217])) return ['image/jpeg','jpg'];
  if (bytes.length >= 45 && has(0,[137,80,78,71,13,10,26,10]) && has(12,[73,72,68,82]) &&
    has(bytes.length-8,[73,69,78,68])) return ['image/png','png'];
  if (bytes.length >= 20 && has(0,[82,73,70,70]) && has(8,[87,69,66,80,86,80,56]) &&
    [32,76,88].includes(at(15)) &&
    (at(4) + at(5)*256 + at(6)*65536 + at(7)*16777216) === bytes.length-8) return ['image/webp','webp'];
  check(false,'รองรับเฉพาะไฟล์ JPEG, PNG และ WEBP ที่ถูกต้อง');
}
function trash(fileId) {
  try { DriveApp.getFileById(fileId).setTrashed(true); return true; }
  catch (error) { console.error('Drive cleanup failed'); return false; }
}
function purgeExpired() {
  locked(() => {
    if (props().getProperty('RESET_SLIPS_ID')) return;
    const cutoff = Date.now() - 86400000;
    const expired = rows('Uploads').filter(row => Date.parse(row.CreatedAt) <= cutoff && trash(row.FileID));
    const sessions = rows('Sessions').filter(row => row.ExpiresAt <= Date.now());
    commit([...expired.map(row => erase('Uploads',row._index)), ...sessions.map(row => erase('Sessions',row._index))]);
    compact(['Uploads','Sessions','Followers']);
  });
}
function resetSlipStorage(previousId) {
  const properties = props();
  const old = DriveApp.getFolderById(previousId);
  if (properties.getProperty('SLIPS_ID') === previousId) {
    const parents = old.getParents();
    check(parents.hasNext(),'ไม่พบโฟลเดอร์หลักของระบบ',503);
    const replacement = folder(parents.next(),'PaymentSlips-reset-'+previousId);
    properties.setProperty('SLIPS_ID',replacement.getId());
  }
  slipRoot().setName('PaymentSlips');
  if (!old.isTrashed()) old.setTrashed(true);
}
