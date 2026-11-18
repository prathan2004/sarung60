function saveMember(actor,data) {
  const old = data.id ? memberById(data.id) : null;
  const name = clean(data.name,120);
  const username = validUsername(data.username);
  check(!rows('Members').some(row => row.Username === username && (!old || row.MemberID !== old.MemberID)) &&
    !rows('Admins').some(row => row.Username === username),'ชื่อผู้ใช้ซ้ำ',409);
  check(typeof data.active === 'boolean','สถานะสมาชิกไม่ถูกต้อง');
  const id = old ? old.MemberID : uid();
  const hash = old ? old.PasswordHash : seal(data.password);
  const changes = [put('Members',[id,name,username,hash,'member',data.active,
    old ? old.CreatedAt : now(),now()],old ? old._index : undefined),
    audit(actor,old ? 'MEMBER_UPDATED' : 'MEMBER_CREATED',id,'',JSON.stringify({name,username,active:data.active}))];
  if (!data.active) changes.push(...revoke(id));
  commit(changes);
  return {id};
}
function resetMember(actor,data) {
  const row = memberById(data.id);
  commit([put('Members',[row.MemberID,row.Name,row.Username,seal(data.password),'member',row.Active,
    row.CreatedAt,now()],row._index),...revoke(row.MemberID),audit(actor,'PASSWORD_RESET',row.MemberID)]);
  return {};
}
function report() { return summaries(rows('Members')); }
function adminDashboard() {
  const members = report();
  const sum = key => Math.round(members.reduce((n,row) => n+Math.round(row[key]*100),0))/100;
  const goal = sum('goal');
  const reached = members.filter(row => row.remaining === 0).length;
  const credited = members.reduce((n,row) => n+Math.round(Math.min(row.goal,row.approved)*100),0)/100;
  return {count:members.length,goal,approved:sum('approved'),pending:sum('pending'),
    reached,unreached:members.length-reached,progress:goal ? credited/goal*100 : 0};
}
function updateSettings(actor,data) {
  const name = clean(data.projectName,100);
  const current = rows('Settings').find(row => row.Key === 'PROJECT_NAME');
  const config = settings();
  commit([put('Settings',['PROJECT_NAME',name],current ? current._index : undefined),
    audit(actor,'SETTINGS_UPDATED','','',JSON.stringify({previous:current && current.Value,name}))]);
  return {...config,PROJECT_NAME:name};
}
function resetSystem(actor,data) {
  check(data.confirmation === 'RESET','พิมพ์ RESET เพื่อยืนยันการรีเซ็ต');
  const properties = props();
  let previousId = properties.getProperty('RESET_SLIPS_ID');
  if (!previousId) {
    previousId = properties.getProperty('SLIPS_ID');
    check(previousId,'ยังไม่ได้ตั้งค่าโฟลเดอร์สลิป',503);
    properties.setProperty('RESET_SLIPS_ID',previousId);
  }
  try {
    resetSlipStorage(previousId);
    resetTables(actor);
    properties.deleteProperty('RESET_SLIPS_ID');
  } catch (error) {
    console.error('System reset incomplete: '+error.name);
    check(false,'รีเซ็ตยังไม่เสร็จ กรุณากดยืนยันอีกครั้งเพื่อดำเนินการต่อ',503);
  }
  return {};
}
