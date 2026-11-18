import {el,heading,metrics,metric,panel,details,badge,progressPanel,link,actions,field,form,submit,button,
 notice,message,call,money,percent,paymentTable,newPasswordField,checkbox,table,modal,openSlip,dateTime,param} from './ui.js';
import {passwordPanel} from './member.js';

const input = (name,type='text',attrs={}) => el('input',{name,type,...attrs});
const editName = value => field('ชื่อ',input('name','text',{value,maxlength:120,required:true}));
const memberStats = row => [['เป้าหมาย',money(row.goal)],['อนุมัติแล้ว',money(row.approved)],
  ['รอตรวจสอบ',money(row.pending)],['คงเหลือ',money(row.remaining)]];
const memberLink = (path,id) => '/admin/'+path+'.html?member='+encodeURIComponent(id);

export async function dashboard() {
  const row = await call('adminDashboard');
  return [heading('ภาพรวมโครงการ','รวมสมาชิกทุกบัญชี',link('ตรวจสอบการชำระเงิน','/admin/payments.html','primary')),
    metrics(metric('สมาชิกทั้งหมด',row.count+' คน',true),metric('เป้าหมายรวม',money(row.goal)),
      metric('ยอดอนุมัติทั้งหมด',money(row.approved)),metric('ยอดรอตรวจสอบ',money(row.pending))),
    el('div',{class:'grid split'},progressPanel('ความสำเร็จรวม',row.progress,
      ['ยอดที่นับเข้าเป้าหมาย','คงเหลือ'],[row.goal*row.progress/100,row.goal*(1-row.progress/100)]),
    panel('สถานะสมาชิก',details([['บรรลุเป้าหมาย',row.reached+' คน'],['ยังไม่บรรลุเป้าหมาย',row.unreached+' คน']]),
      link('ดูรายงานการออม','/admin/reports.html')))];
}
export async function members() {
  const list = el('div');
  const status = notice();
  let records = await call('members');
  async function refresh() { records = await call('members'); draw(); }
  function editor(row) {
    const view = modal(row ? 'แก้ไขสมาชิก' : 'เพิ่มสมาชิก');
    view.body.append(form(view.status,async values => {
      await call('memberSave',{...values,id:row?.id,active:values.active === 'on'});
      view.dialog.close();
      message(status,'บันทึกข้อมูลสมาชิกแล้ว');
      try { await refresh(); } catch (error) { message(status,error.message,true); }
    },editName(row?.name),field('ชื่อผู้ใช้',input('username','text',{value:row?.username,required:true,
      minlength:3,maxlength:40,pattern:'[a-zA-Z0-9_.\\-]{3,40}',autocomplete:'off'})),
    !row && newPasswordField('รหัสผ่านเริ่มต้น',4),
    checkbox('เปิดใช้งานบัญชี','active',row?.active ?? true),actions(submit('บันทึก'))));
  }
  function reset(row) {
    const view = modal('รีเซ็ตรหัสผ่าน · '+row.name);
    view.body.append(form(view.status,async values => {
      await call('memberReset',{...values,id:row.id});
      view.dialog.close();
      message(status,'รีเซ็ตรหัสผ่านและสิ้นสุดเซสชันเดิมแล้ว');
    },newPasswordField('รหัสผ่านใหม่',4),actions(submit('รีเซ็ตรหัสผ่าน'))));
  }
  async function history(row) {
    const view = modal('ประวัติการชำระเงิน · '+row.name);
    message(view.status,'กำลังโหลด…');
    try {
      view.body.append(paymentTable(await call('memberHistory',{memberId:row.id})));
      message(view.status);
    } catch (error) { message(view.status,error.message,true); }
  }
  function draw() {
    list.replaceChildren(table(['สมาชิก','สถานะบัญชี','เป้าหมาย','อนุมัติแล้ว','คงเหลือ','จัดการ'],
      records.map(row => [el('div',{},el('strong',{},row.name),el('div',{class:'muted'},row.username)),
      badge(row.active?'เปิดใช้งาน':'ปิดใช้งาน'),money(row.goal),money(row.approved),money(row.remaining),
      actions(button('แก้ไข',() => editor(row)),link('ผู้ติดตาม',memberLink('followers',row.id)),
        button('ประวัติ',() => history(row)),button('รีเซ็ตรหัสผ่าน',() => reset(row))) ])));
  }
  draw();
  return [heading('จัดการสมาชิก',null,button('เพิ่มสมาชิก',() => editor(),'primary')),status,panel(null,list)];
}
export async function followers() {
  const members = await call('members');
  const status = notice();
  const current = param('member');
  const select = el('select',{onchange:() => location.assign(memberLink('followers',select.value))},
    el('option',{value:'',disabled:true,selected:!current},'เลือกสมาชิก'),
    members.map(row => el('option',{value:row.id,selected:row.id === current},row.name+' · '+row.username)));
  const output = el('div');
  const wrapper = [heading('จัดการผู้ติดตาม'),status,panel(null,field('สมาชิก',select)),output];
  if (!current) return wrapper;
  let content = await call('followers',{memberId:current});
  function edit(row) {
    const view = modal(row ? 'แก้ไขผู้ติดตาม' : 'เพิ่มผู้ติดตาม');
    view.body.append(form(view.status,async values => {
      content = await call('followerSave',{...values,memberId:current,id:row?.id});
      view.dialog.close();
      draw('บันทึกแล้วและคำนวณเป้าหมายใหม่แล้ว');
    },editName(row?.name),field('วันเกิด',input('birth','date',{value:row?.birth,required:true})),
    actions(submit('บันทึกผู้ติดตาม'))));
  }
  function remove(row) {
    const view = modal('ลบผู้ติดตาม');
    view.body.append(form(view.status,async () => {
      content = await call('followerDelete',{memberId:current,id:row.id});
      view.dialog.close();
      draw('ลบผู้ติดตามและคำนวณเป้าหมายใหม่แล้ว');
    },el('p',{},'ยืนยันการลบ '+row.name+' จากรายชื่อผู้ติดตาม'),actions(submit('ยืนยันการลบ'))));
  }
  function draw(text) {
    message(status,text);
    output.replaceChildren(panel('เป้าหมายของ '+content.summary.name,details(memberStats(content.summary))),
      panel(null,el('div',{class:'panel-header'},el('h2',{},'ผู้ติดตาม'),button('เพิ่มผู้ติดตาม',() => edit(),'primary')),
        table(['ชื่อ','วันเกิด (ค.ศ.)','อายุ','เข้าเงื่อนไข','ยอดที่เพิ่ม','จัดการ'],
        content.followers.map(row => [row.name,row.birth,row.age+' ปี',row.eligible?'เข้าเงื่อนไข':'ยังไม่เข้าเงื่อนไข',
          money(row.extra),actions(button('แก้ไข',() => edit(row)),button('ลบ',() => remove(row),'danger'))]))));
  }
  draw();
  return wrapper;
}
export async function payments() {
  const records = await call('pending');
  return [heading('ตรวจสอบการชำระเงิน',records.length+' รายการรอตรวจสอบ'),panel(null,
    table(['สมาชิก','รหัสรายการ','วันที่แจ้ง','จำนวนเงิน','สถานะ','จัดการ'],
    records.map(row => [row.memberName,row.id,dateTime(row.createdAt),money(row.amount),badge(row.status),
      link('ตรวจสอบ','/admin/payment-detail.html?id='+encodeURIComponent(row.id))])))];
}
export async function paymentDetail() {
  const id = param('id');
  let row = await call('paymentDetail',{id});
  const status = notice();
  const body = el('div');
  function review(approved) {
    const view = modal(approved?'ยืนยันการอนุมัติ':'ปฏิเสธรายการ');
    view.body.append(form(view.status,async values => {
      const result = await call('review',{id,status:approved?'Approved':'Rejected',
        bankVerified:values.bankVerified === 'on',reason:values.reason});
      row = {...row,...result};
      view.dialog.close();
      draw();
      message(status,approved?'อนุมัติรายการแล้ว':'ปฏิเสธรายการแล้ว');
    },el('p',{},row.memberName+' · '+money(row.amount)),
    approved ? el('label',{class:'check'},input('bankVerified','checkbox',{required:true}),
      'ยืนยันว่าตรวจสอบยอดเงินเข้าบัญชีธนาคารจริงแล้ว') :
      field('เหตุผลที่ปฏิเสธ',el('textarea',{name:'reason',maxlength:500,required:true})),
    actions(submit(approved?'อนุมัติรายการ':'ยืนยันการปฏิเสธ'))));
  }
  function draw() {
    body.replaceChildren(panel('ข้อมูลรายการ',details([['รหัสรายการ',row.id],['สมาชิก',row.memberName],
      ['รหัสสมาชิก',row.memberId],['จำนวนเงิน',money(row.amount)],['สถานะ',badge(row.status)],
      ['วันที่แจ้ง',dateTime(row.createdAt)],['วันที่ตรวจสอบ',dateTime(row.reviewedAt)],
      ['ผู้ตรวจสอบ',row.adminId || '—'],['หมายเหตุ',row.reason || '—']]),actions(
      button('ดูสลิป',() => openSlip(id)),
      row.status === 'Pending' && button('อนุมัติ',() => review(true),'primary'),
      row.status === 'Pending' && button('ปฏิเสธ',() => review(false),'danger'))));
  }
  draw();
  return [heading('รายละเอียดการชำระเงิน',null,link('กลับไปที่รายการ','/admin/payments.html')),status,body];
}
const reportColumns = ['สมาชิก','ผู้ติดตามที่เข้าเงื่อนไข','เป้าหมาย (บาท)','อนุมัติแล้ว (บาท)',
  'รอตรวจสอบ (บาท)','คงเหลือ (บาท)','ความสำเร็จ (%)'];
export function csvCell(input) {
  let text = String(input);
  if (/^[\s\u0000-\u001f\uFEFF]*[=+@-]/u.test(text) || /^[\t\r\n\u0000-\u001f]/u.test(text)) text = "'"+text;
  return '"'+text.replaceAll('"','""')+'"';
}
export async function reports() {
  const records = await call('report');
  const list = el('div');
  const query = input('search','search',{placeholder:'พิมพ์ชื่อสมาชิก'});
  const options = [['name','ชื่อสมาชิก'],['goal','เป้าหมาย'],['approved','ยอดอนุมัติ'],
    ['remaining','ยอดคงเหลือ'],['progress','เปอร์เซ็นต์']];
  const sort = el('select',{},options.map(([value,label]) => el('option',{value},label)));
  const direction = el('select',{},el('option',{value:'asc'},'น้อยไปมาก'),el('option',{value:'desc'},'มากไปน้อย'));
  function filtered() {
    const key = sort.value;
    const search = query.value.trim().toLocaleLowerCase('th');
    const order = direction.value === 'asc' ? 1 : -1;
    return records.filter(row => row.name.toLocaleLowerCase('th').includes(search)).sort((a,b) =>
      order*(key === 'name' ? a.name.localeCompare(b.name,'th') : a[key]-b[key]));
  }
  function draw() {
    list.replaceChildren(table(reportColumns,filtered().map(row => [row.name,row.eligible,
      money(row.goal),money(row.approved),money(row.pending),money(row.remaining),percent(row.progress)])));
  }
  function exportCsv() {
    const rows = filtered().map(row => [row.name,row.eligible,row.goal,row.approved,row.pending,
      row.remaining,Number(row.progress.toFixed(2))]);
    const csv = [reportColumns,...rows].map(row => row.map(csvCell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob(['\ufeff',csv],{type:'text/csv;charset=utf-8'}));
    const anchor = el('a',{href:url,download:'saving-report.csv'});
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url),1000);
  }
  query.addEventListener('input',draw);
  sort.addEventListener('change',draw);
  direction.addEventListener('change',draw);
  draw();
  return [heading('รายงานการออม','คำนวณเป้าหมายจากข้อมูลผู้ติดตามปัจจุบัน',button('ส่งออก CSV',exportCsv,'primary')),
    panel(null,el('div',{class:'toolbar'},field('ค้นหาสมาชิก',query),field('เรียงตาม',sort),field('ลำดับ',direction)),list)];
}
export async function logs() {
  let offset = 0;
  let data = await call('logs',{offset});
  const status = notice();
  const list = el('div');
  const controls = el('div',{class:'actions'});
  async function move(next,trigger) {
    trigger.disabled = true;
    try {
      data = await call('logs',{offset:next});
      offset = next;
      message(status);
      draw();
    } catch (error) { message(status,error.message,true); }
    finally { trigger.disabled = false; }
  }
  function draw() {
    list.replaceChildren(table(['เวลา','ผู้ดำเนินการ','การดำเนินงาน','สมาชิก','รายการชำระเงิน','รายละเอียด'],
      data.items.map(row => [dateTime(row.Timestamp),row.ActorID,row.Action,row.MemberID || '—',row.PaymentID || '—',
        row.Detail || '—'])));
    controls.replaceChildren(button('หน้าก่อน',event => move(offset-100,event.currentTarget)),
      button('หน้าถัดไป',event => move(offset+100,event.currentTarget)));
    controls.children[0].disabled = offset === 0;
    controls.children[1].disabled = !data.more;
  }
  draw();
  return [heading('ประวัติการดำเนินงาน'),status,panel(null,list,controls)];
}
export async function settings() {
  const data = await call('settings');
  const status = notice();
  return [heading('ตั้งค่าระบบ'),panel('ข้อมูลโครงการ',status,form(status,async values => {
    const updated = await call('settingsSave',values);
    document.querySelector('.brand-name').textContent = updated.PROJECT_NAME;
    message(status,'บันทึกการตั้งค่าแล้ว');
  },field('ชื่อโครงการ',input('projectName','text',{value:data.PROJECT_NAME,maxlength:100,required:true})),
  actions(submit('บันทึกการตั้งค่า')))),panel('กติกาการออม',details([
    ['เป้าหมายพื้นฐาน',money(data.BASE_GOAL)],['ยอดเพิ่มต่อผู้ติดตาม',money(data.FOLLOWER_GOAL)],
    ['เกณฑ์อายุขั้นต่ำ',data.FOLLOWER_MIN_AGE+' ปี'],['เขตเวลา',data.TIMEZONE]])),passwordPanel(12)];
}
