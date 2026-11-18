const ZONE = 'Asia/Bangkok';
const MAX_FILE = 5 * 1024 * 1024;
const CHUNK = 2 * 1024 * 1024;
const SCHEMA = {
  Settings: 'Key Value',
  Members: 'MemberID Name Username PasswordHash Role Active CreatedAt UpdatedAt',
  Followers: 'FollowerID MemberID FollowerName BirthDate CreatedAt UpdatedAt',
  Payments: 'PaymentID MemberID CreatedAt Amount SlipFileID Status AdminID ReviewedAt RejectReason',
  Admins: 'AdminID Username PasswordHash Role Active CreatedAt',
  AuditLogs: 'LogID Timestamp ActorID Action MemberID PaymentID Detail',
  Sessions: 'SessionID AccountID ExpiresAt',
  Uploads: 'UploadID MemberID Part FileID CreatedAt'
};
const DEFAULTS = {BASE_GOAL:2000,FOLLOWER_GOAL:2000,FOLLOWER_MIN_AGE:11,TIMEZONE:ZONE,PROJECT_NAME:'ระบบติดตามการออม'};
function props() { return PropertiesService.getScriptProperties(); }
function setup() {
  return locked(() => {
    const p = props();
    const id = p.getProperty('SHEET_ID');
    const secret = p.getProperty('PROXY_SECRET');
    const session = p.getProperty('SESSION_SECRET');
    const hash = p.getProperty('BOOTSTRAP_HASH');
    const username = p.getProperty('BOOTSTRAP_USERNAME');
    check(id && /^[a-f0-9]{64}$/.test(secret || '') &&
      /^[a-f0-9]{64}$/.test(session || '') && secret !== session, 'ตรวจสอบ Script Properties');
    const book = SpreadsheetApp.openById(id);
    book.setSpreadsheetTimeZone(ZONE);
    for (const [name, fields] of Object.entries(SCHEMA)) {
      const sheet = book.getSheetByName(name) || book.insertSheet(name);
      const headers = fields.split(' ');
      if (!sheet.getLastRow()) {
        sheet.appendRow(headers);
        sheet.setFrozenRows(1);
      }
      check(sheet.getRange(1,1,1,headers.length).getValues()[0].join(' ') === fields, 'หัวตารางไม่ตรง: ' + name);
    }
    SpreadsheetApp.flush();
    const existing = rows('Settings');
    commit(Object.entries(DEFAULTS).filter(([key]) => !existing.some(row => row.Key === key))
      .map(([key,value]) => put('Settings',[key,value])));
    if (!p.getProperty('SLIPS_ID')) {
      const root = DriveApp.createFolder('SavingSystem');
      root.setSharing(DriveApp.Access.PRIVATE,DriveApp.Permission.NONE);
      p.setProperty('SLIPS_ID',root.createFolder('PaymentSlips').getId());
    }
    if (!rows('Admins').length) {
      validUsername(username);
      check(/^[a-f0-9]{128}$/.test(hash || ''), 'ต้องกำหนด BOOTSTRAP_HASH');
      check(!rows('Members').some(row => row.Username === username), 'ชื่อผู้ใช้ซ้ำ');
      const admin = uid();
      commit([put('Admins',[admin,username,seal(hash),'admin',true,now()]),
        audit({id:admin},'ADMIN_CREATED','','',username)]);
    }
    p.deleteProperty('BOOTSTRAP_HASH');
    p.deleteProperty('BOOTSTRAP_USERNAME');
    if (!ScriptApp.getProjectTriggers().some(trigger => trigger.getHandlerFunction() === 'purgeExpired')) {
      ScriptApp.newTrigger('purgeExpired').timeBased().everyDays(1).create();
    }
  });
}
