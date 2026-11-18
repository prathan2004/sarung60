function output(body) {
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
}
function doPost(event) {
  try {
    const body = JSON.parse(event.postData.contents);
    const secret = props().getProperty('PROXY_SECRET');
    check(secret && same(body.secret,secret),'ไม่มีสิทธิ์เข้าถึง',403);
    return output({ok:true,data:locked(() => route(body))});
  } catch (error) {
    if (!error.code) console.error(error.name + ': ' + error.message);
    return output({ok:false,status:error.code || 500,
      error:error.code ? error.message : 'เกิดข้อผิดพลาดในระบบ'});
  }
}
function route(body) {
  const data = body.data || {};
  const resetting = !!props().getProperty('RESET_SLIPS_ID');
  const resetMessage = 'ระบบกำลังรีเซ็ต กรุณาลองอีกครั้งภายหลัง';
  if (body.action === 'login') {
    check(!resetting || data.portal === 'admin',resetMessage,503);
    return login(data);
  }
  const actor = authenticate(body.token);
  check(!resetting || (actor.role === 'admin' && ['session','settings','systemReset','logout'].includes(body.action)),
    resetMessage,503);
  switch (body.action) {
    case 'session': return {role:actor.role,name:actor.row.Name || actor.row.Username,
      id:actor.id,username:actor.row.Username,projectName:settings().PROJECT_NAME};
    case 'logout':
      commit([erase('Sessions',actor.session._index),audit(actor,'LOGOUT',actor.row.MemberID || '')]);
      return {};
    case 'password': return changePassword(actor,data);
    case 'slip': return readSlip(actor,data);
  }
  if (actor.role === 'member') {
    switch (body.action) {
      case 'dashboard': return summaries([actor.row])[0];
      case 'history': return rows('Payments').filter(row => row.MemberID === actor.id).reverse().map(publicPayment);
      case 'upload': return uploadPart(actor,data);
      case 'submit': return submitPayment(actor,data);
    }
  } else {
    switch (body.action) {
      case 'adminDashboard': return adminDashboard();
      case 'members':
      case 'report': return report();
      case 'memberSave': return saveMember(actor,data);
      case 'memberReset': return resetMember(actor,data);
      case 'memberHistory':
        memberById(data.memberId);
        return rows('Payments').filter(row => row.MemberID === data.memberId).reverse().map(publicPayment);
      case 'followers': {
        const member = memberById(data.memberId);
        return followerDashboard(member,rows('Followers').filter(row => row.MemberID === member.MemberID));
      }
      case 'followerSave': return changeFollower(actor,data,false);
      case 'followerDelete': return changeFollower(actor,data,true);
      case 'pending':
      case 'reviewed': {
        const statuses = body.action === 'pending' ? ['Pending'] : ['Approved','Rejected'];
        const members = new Map(rows('Members').map(row => [row.MemberID,row.Name]));
        return rows('Payments').filter(row => statuses.includes(row.Status)).reverse()
          .map(row => ({...publicPayment(row),memberName:members.get(row.MemberID)}));
      }
      case 'paymentDetail': {
        const row = paymentById(data.id);
        return {...publicPayment(row),memberName:memberById(row.MemberID).Name};
      }
      case 'review': return reviewPayment(actor,data);
      case 'paymentReopen': return reopenPayment(actor,data);
      case 'logs': {
        const offset = Number.isSafeInteger(data.offset) ? Math.max(0,data.offset) : 0;
        const logs = rows('AuditLogs');
        const items = logs.slice(Math.max(0,logs.length-offset-100),Math.max(0,logs.length-offset)).reverse()
          .map(({_index,...row}) => row);
        return {items,more:logs.length > offset+100};
      }
      case 'settings': return {...settings(),resetInProgress:resetting};
      case 'settingsSave': return updateSettings(actor,data);
      case 'systemReset': return resetSystem(actor,data);
    }
  }
  check(false,'ไม่มีสิทธิ์ทำรายการ',403);
}
