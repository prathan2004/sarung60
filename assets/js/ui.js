export const page = document.body.dataset.page;
export const admin = page.startsWith('admin/');
export const loginUrl = admin ? '/admin/login.html' : '/login.html';
export const param = key => new URLSearchParams(location.search).get(key);
export const money = value => new Intl.NumberFormat('th-TH',{maximumFractionDigits:2}).format(value)+' ฿';
export const percent = value => new Intl.NumberFormat('th-TH',{maximumFractionDigits:1}).format(value)+'%';
const dateFormatter = new Intl.DateTimeFormat('th-TH',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Bangkok'});
export const dateTime = value => value ? dateFormatter.format(new Date(value)) : '—';
export function el(tag,attrs={},...children) {
  const node = document.createElement(tag);
  for (const [key,value] of Object.entries(attrs)) {
    if (value === undefined || value === false || value === null) continue;
    if (key.startsWith('on')) node.addEventListener(key.slice(2),value);
    else node.setAttribute(key,value === true ? '' : value);
  }
  node.append(...children.flat().filter(value => value !== undefined && value !== null && value !== false));
  return node;
}
export const link = (label,href,style='') => el('a',{class:'btn '+style,href},label);
export const button = (label,handler,style='') => el('button',{type:'button',class:'btn '+style,onclick:handler},label);
export const submit = label => el('button',{type:'submit',class:'btn primary'},label);
export const actions = (...nodes) => el('div',{class:'actions'},...nodes);
export const field = (label,node,help) => el('label',{},label,node,help && el('small',{},help));
export const checkbox = (label,name,checked=false) => el('label',{class:'check'},el('input',{type:'checkbox',name,checked}),label);
export const password = (name='password',fresh=true) => el('input',{name,type:'password',required:true,
  minlength:fresh ? 12 : undefined,maxlength:256,autocomplete:fresh ? 'new-password' : 'current-password'});
export const panel = (title,...body) => el('section',{class:'panel'},title && el('h2',{},title),...body);
export const heading = (title,sub,...buttons) => el('header',{class:'heading'},
  el('div',{},el('h1',{},title),sub && el('p',{},sub)),buttons.length ? actions(...buttons) : null);
export const metric = (label,value,highlight=false) => el('article',{class:'metric'+(highlight?' highlight':'')},
  el('p',{},label),el('strong',{},value));
export const metrics = (...items) => el('div',{class:'grid metrics'},...items);
export const details = items => el('dl',{class:'details'},items.map(([label,value]) =>
  el('div',{},el('dt',{},label),el('dd',{},value))));
const statuses = {Approved:'อนุมัติแล้ว',Pending:'รอตรวจสอบ',Rejected:'ปฏิเสธ'};
export const badge = status => el('span',{class:'tag '+(statuses[status] ? status : '')},statuses[status] || status);
export const table = (headers,rows) => el('div',{class:'table-wrap',tabindex:'0','aria-label':'ตารางข้อมูล'},
  el('table',{},el('thead',{},el('tr',{},headers.map(text => el('th',{scope:'col'},text)))),
    el('tbody',{},rows.length ? rows.map(row => el('tr',{},row.map(value => el('td',{},value))))
      : el('tr',{},el('td',{colspan:headers.length,class:'muted'},'ไม่มีข้อมูล')))));
export const notice = () => el('p',{class:'status',role:'status','aria-live':'polite'});
export function message(node,text='',failed=false) {
  node.textContent = text;
  node.classList.toggle('error',failed);
}
export async function call(action,data={}) {
  const response = await fetch('/api',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({action,data}),cache:'no-store'});
  const result = await response.json().catch(() => ({}));
  if (response.status === 401 && action !== 'login' && action !== 'session') location.replace(loginUrl);
  if (!response.ok) throw Object.assign(new Error(result.error || 'ระบบเชื่อมต่อไม่ได้ กรุณาลองอีกครั้ง'),{status:response.status});
  return result;
}
export function form(status,handler,...fields) {
  return el('form',{onsubmit:async event => {
    event.preventDefault();
    const node = event.currentTarget;
    if (node.ariaBusy === 'true') return;
    const values = Object.fromEntries(new FormData(node));
    node.ariaBusy = 'true';
    const controls = [...node.elements].filter(input => !input.disabled);
    controls.forEach(control => control.disabled = true);
    message(status);
    try { await handler(values,node); }
    catch (error) { message(status,error.message,true); }
    finally {
      controls.forEach(control => control.disabled = false);
      node.ariaBusy = 'false';
    }
  }},...fields);
}
export function modal(title) {
  const status = notice();
  const body = el('div');
  const dialog = el('dialog',{'aria-label':title},el('div',{class:'panel-header'},el('h2',{},title),
    button('ปิด',() => dialog.close())),status,body);
  const cleanup = [];
  dialog.addEventListener('close',() => {
    cleanup.forEach(fn => fn());
    dialog.remove();
  },{once:true});
  document.body.append(dialog);
  dialog.showModal();
  return {body,status,dialog,cleanup};
}
export async function openSlip(id) {
  const view = modal('สลิปการชำระเงิน');
  message(view.status,'กำลังโหลดสลิป…');
  try {
    const first = await call('slip',{id,part:0});
    const pieces = [first.bytes];
    for (let i=1;i<first.parts;i++) {
      if (!view.dialog.open) return;
      pieces.push((await call('slip',{id,part:i})).bytes);
    }
    if (!view.dialog.open) return;
    const image = new Blob(pieces.map(piece => Uint8Array.from(atob(piece),char => char.charCodeAt(0))),{type:first.mime});
    const url = URL.createObjectURL(image);
    view.cleanup.push(() => URL.revokeObjectURL(url));
    view.body.append(el('img',{class:'preview',alt:'รูปสลิปของรายการ '+id,src:url,
      onerror:() => message(view.status,'ไม่สามารถแสดงรูปสลิปได้',true)}));
    message(view.status);
  } catch (error) { message(view.status,error.message,true); }
}
export function paymentTable(records,withMember=false) {
  const headers = ['รหัสรายการ','วันที่แจ้ง','จำนวนเงิน','สถานะ','วันที่ตรวจสอบ','หมายเหตุ','สลิป'];
  if (withMember) headers.unshift('สมาชิก');
  return table(headers,records.map(row => {
    const columns = [row.id,dateTime(row.createdAt),money(row.amount),badge(row.status),dateTime(row.reviewedAt),
      row.reason || '—',button('ดูสลิป',() => openSlip(row.id))];
    if (withMember) columns.unshift(row.memberName || row.memberId);
    return columns;
  }));
}
export function progressPanel(title,value,labels,values) {
  const text = percent(value);
  const canvas = el('canvas',{'aria-hidden':'true'});
  const chart = el('div',{class:'chart',hidden:true},canvas);
  let attempts = 0;
  function draw() {
    if (!canvas.isConnected && ++attempts < 4) return requestAnimationFrame(draw);
    if (!canvas.isConnected || !window.Chart || !values.some(Boolean)) return;
    chart.hidden = false;
    new window.Chart(canvas,{type:'doughnut',data:{labels,datasets:[{data:values,
      backgroundColor:['#0e806d','#dce7ef'],borderWidth:0}]},
      options:{maintainAspectRatio:false,cutout:'72%',plugins:{legend:{position:'bottom'}}}});
  }
  requestAnimationFrame(draw);
  return panel(null,el('div',{class:'panel-header'},el('h2',{},title),el('strong',{},text)),
    el('progress',{class:'progress',max:100,value,'aria-label':title}),chart);
}
