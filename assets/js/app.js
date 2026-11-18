import {el,page,admin,loginUrl,link,button,call,form,submit,notice,message,field,password,param,heading,panel} from './ui.js';
import * as member from './member.js';
import * as operator from './admin.js';

const root = document.querySelector('#app');
const paths = admin ? [
  ['/admin/dashboard.html','ภาพรวมโครงการ'],['/admin/members.html','สมาชิก'],['/admin/followers.html','ผู้ติดตาม'],
  ['/admin/payments.html','ตรวจสอบการชำระเงิน'],['/admin/reports.html','รายงานการออม'],
  ['/admin/logs.html','ประวัติการดำเนินงาน'],['/admin/settings.html','ตั้งค่าระบบ']
] : [['/dashboard.html','ภาพรวมการออม'],['/payment.html','แจ้งชำระเงิน'],
  ['/history.html','ประวัติการชำระเงิน'],['/profile.html','บัญชีของฉัน']];
const dashboard = admin ? '/admin/dashboard.html' : '/dashboard.html';
function brand(name,href) {
  return el('a',{class:'brand',href},el('span',{class:'brand-mark','aria-hidden':'true'},'฿'),
    el('span',{class:'brand-name'},name));
}
function publicView(title,description,content) {
  root.replaceChildren(el('main',{class:'auth-shell'},
    el('section',{class:'auth-visual'},brand('SARUNG','/'),el('h1',{},title),el('p',{},description)),
    el('div',{class:'auth-content'},content)));
}
function landing() {
  publicView('ระบบติดตามการออม','ดูเป้าหมายการออม แจ้งชำระเงิน และติดตามผลการตรวจสอบได้ในบัญชีเดียว',
    panel('เข้าใช้งานระบบ',el('div',{class:'grid'},link('เข้าสู่ระบบสมาชิก','/login.html','primary'),
      link('เข้าสู่ระบบผู้ดูแล','/admin/login.html'))));
}
async function loginPage() {
  try {
    const session = await call('session');
    if (session.role === (admin?'admin':'member')) return location.replace(dashboard);
  } catch (error) {
    if (error.status !== 401) console.info('Session lookup unavailable');
  }
  const status = notice();
  if (param('changed') === '1') message(status,'เปลี่ยนรหัสผ่านแล้ว กรุณาเข้าสู่ระบบใหม่');
  publicView(admin?'จัดการโครงการออม':'ติดตามเป้าหมายการออม',
    admin?'จัดการสมาชิก ตรวจสอบการชำระเงิน และดูรายงานการออม':
      'ดูยอดคงเหลือ ส่งสลิป และตรวจสอบประวัติการชำระเงินของคุณ',
    panel(admin?'เข้าสู่ระบบผู้ดูแล':'เข้าสู่ระบบสมาชิก',status,form(status,async values => {
      await call('login',{...values,portal:admin?'admin':'member'});
      location.replace(dashboard);
    },field('ชื่อผู้ใช้',el('input',{name:'username',autocomplete:'username',required:true,maxlength:40,
      autocapitalize:'none',spellcheck:'false'})),field('รหัสผ่าน',password('password',false)),submit('เข้าสู่ระบบ')),
    el('div',{class:'auth-switch'},link(admin?'ไปที่หน้าสมาชิก':'ไปที่หน้าผู้ดูแล',admin?'/login.html':'/admin/login.html'))));
}
function protectedView(session) {
  const status = notice();
  const content = el('div');
  const current = page === 'admin/payment-detail' ? '/admin/payments.html' : '/'+page+'.html';
  const logout = button('ออกจากระบบ',async () => {
    logout.disabled = true;
    try { await call('logout'); location.replace(loginUrl); }
    catch (error) { message(status,error.message,true); }
    finally { logout.disabled = false; }
  });
  root.replaceChildren(el('div',{class:'shell'},
    el('aside',{class:'side'},brand(session.projectName,dashboard),el('nav',{'aria-label':'เมนูหลัก'},paths.map(([href,label]) =>
      el('a',{href,'aria-current':href === current?'page':undefined},label)))),
    el('div',{},el('header',{class:'top'},el('div',{},el('span',{},admin?'ผู้ดูแลระบบ':'สมาชิก'),
      el('strong',{},session.name)),logout),el('main',{class:'main'},status,content))));
  return content;
}
async function boot() {
  if (page === 'index') return landing();
  if (page.endsWith('login')) return loginPage();
  const session = await call('session');
  if (session.role !== (admin?'admin':'member')) return location.replace(loginUrl);
  const content = protectedView(session);
  const name = page.split('/').at(-1);
  const render = admin ? operator[name === 'payment-detail'?'paymentDetail':name] : member[name];
  try { content.replaceChildren(...await render(session)); }
  catch (error) { content.replaceChildren(heading('เปิดหน้านี้ไม่สำเร็จ',error.message),link('ลองอีกครั้ง',location.pathname+location.search)); }
}
boot().catch(error => {
  if (error.status === 401) return location.replace(loginUrl);
  root.replaceChildren(el('main',{class:'main'},heading('เชื่อมต่อระบบไม่ได้',error.message),
    link('ลองอีกครั้ง',location.pathname),link('กลับหน้าเริ่มต้น','/')));
});
