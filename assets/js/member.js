import {el,heading,metrics,metric,panel,details,badge,progressPanel,link,actions,field,form,submit,
 notice,message,call,money,paymentTable,password,newPasswordField,loginUrl} from './ui.js';

const MAX = 5*1024*1024;
const CHUNK = 2*1024*1024;
const TYPES = ['image/jpeg','image/png','image/webp'];
function readData(blob) {
  return new Promise((resolve,reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(new Error('อ่านไฟล์ไม่สำเร็จ'));
    reader.readAsDataURL(blob);
  });
}
export async function dashboard() {
  const row = await call('dashboard');
  const status = row.remaining === 0 ? 'บรรลุเป้าหมายแล้ว' : row.approved ? 'กำลังออม' : 'ยังไม่เริ่มชำระ';
  return [heading('ภาพรวมการออม','สวัสดี '+row.name,link('แจ้งชำระเงิน','/payment.html','primary')),
    metrics(metric('เป้าหมายทั้งหมด',money(row.goal),true),metric('ยอดที่อนุมัติแล้ว',money(row.approved)),
      metric('ยอดรอตรวจสอบ',money(row.pending)),metric('ยอดคงเหลือ',money(row.remaining))),
    el('div',{class:'grid split'},
      progressPanel('ความคืบหน้า',row.progress,['ยอดที่นับเข้าเป้าหมาย','คงเหลือ'],
        [Math.min(row.approved,row.goal),row.remaining]),
      panel('รายละเอียดเป้าหมาย',details([['สถานะการออม',actions(badge(status),
        row.pending > 0 && badge('Pending'))],['เป้าหมายพื้นฐาน',money(row.base)],['ผู้ติดตามทั้งหมด',row.followers+' คน'],
        ['ผู้ติดตามอายุเกิน 10 ปี',row.eligible+' คน'],['ยอดเพิ่มจากผู้ติดตาม',money(row.extra)],
        ...(row.surplus ? [['ยอดเกินเป้าหมาย',money(row.surplus)]] : [])]))),
    panel('ข้อมูลสมาชิก',details([['ชื่อ',row.name],['รหัสสมาชิก',row.id],['ชื่อผู้ใช้',row.username]]))];
}
export function payment(session) {
  const status = notice();
  const result = el('div');
  const preview = el('img',{class:'preview',alt:'ตัวอย่างสลิป',hidden:true});
  const file = el('input',{type:'file',name:'slip',accept:'.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp',required:true});
  const amount = el('input',{type:'number',name:'amount',min:'0.01',max:'1000000000',step:'0.01',inputmode:'decimal',required:true});
  let previewUrl;
  function validate(file) {
    if (!file?.size || file.size > MAX) throw new Error('รูปสลิปต้องมีขนาดไม่เกิน 5 MB');
    if (!TYPES.includes(file.type) || !/\.(jpe?g|png|webp)$/i.test(file.name)) throw new Error('รองรับไฟล์ JPG, JPEG, PNG และ WEBP');
  }
  file.addEventListener('change',() => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    preview.hidden = true;
    file.setCustomValidity('');
    message(status);
    if (!file.files.length) return;
    try {
      validate(file.files[0]);
      previewUrl = URL.createObjectURL(file.files[0]);
      preview.src = previewUrl;
      preview.hidden = false;
    } catch (error) {
      file.setCustomValidity(error.message);
      message(status,error.message,true);
    }
  });
  preview.addEventListener('error',() => {
    if (preview.hidden) return;
    preview.hidden = true;
    file.setCustomValidity('ไม่สามารถเปิดรูปนี้ได้');
    message(status,'ไม่สามารถเปิดรูปนี้ได้',true);
  });
  const submitForm = form(status,async (values,node) => {
    const slip = values.slip;
    validate(slip);
    const paid = Number(values.amount);
    const digest = await crypto.subtle.digest('SHA-256',await slip.arrayBuffer());
    const fingerprint = Array.from(new Uint8Array(digest),value => value.toString(16).padStart(2,'0')).join('');
    const key = 'saving:upload:'+session.id+':'+paid+':'+fingerprint;
    let attempt = JSON.parse(sessionStorage.getItem(key) || 'null');
    if (!attempt || Date.now()-attempt.time > 86400000) attempt = {id:crypto.randomUUID(),time:Date.now()};
    sessionStorage.setItem(key,JSON.stringify(attempt));
    const total = Math.ceil(slip.size/CHUNK);
    for (let part=0;part<total;part++) {
      message(status,'กำลังอัปโหลดสลิป '+(part+1)+' / '+total);
      const bytes = await readData(slip.slice(part*CHUNK,(part+1)*CHUNK));
      await call('upload',{id:attempt.id,part,bytes});
    }
    const payment = await call('submit',{id:attempt.id,size:slip.size,mime:slip.type,amount:paid});
    sessionStorage.removeItem(key);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    preview.hidden = true;
    node.reset();
    message(status,'บันทึกรายการแล้ว');
    result.replaceChildren(panel('รายการที่บันทึก',details([['รหัสรายการ',payment.id],
      ['จำนวนเงิน',money(payment.amount)],['สถานะ',badge(payment.status)]]),
      link('ดูประวัติการชำระเงิน','/history.html')));
  },field('จำนวนเงิน (บาท)',amount),field('รูปสลิปธนาคาร',file,'JPG, JPEG, PNG หรือ WEBP ขนาดไม่เกิน 5 MB'),
  preview,actions(submit('ส่งรายการ')));
  return [heading('แจ้งชำระเงิน','ยอดจะถูกนับเข้าเป้าหมายเมื่อผู้ดูแลอนุมัติ'),status,panel(null,submitForm),result];
}
export async function history() {
  return [heading('ประวัติการชำระเงิน',null,link('แจ้งชำระเงิน','/payment.html','primary')),
    panel(null,paymentTable(await call('history')))];
}
export function passwordPanel(minimum) {
  const status = notice();
  return panel('เปลี่ยนรหัสผ่าน',status,form(status,async values => {
    await call('password',values);
    location.replace(loginUrl+'?changed=1');
  },field('รหัสผ่านปัจจุบัน',password('currentPassword',false)),
  newPasswordField('รหัสผ่านใหม่',minimum),actions(submit('บันทึกรหัสผ่านใหม่'))));
}
export function profile(session) {
  return [heading('บัญชีของฉัน'),panel('ข้อมูลบัญชี',details([['ชื่อ',session.name],
    ['รหัสสมาชิก',session.id],['ชื่อผู้ใช้',session.username]])),passwordPanel(4)];
}
