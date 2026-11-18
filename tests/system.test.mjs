import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import vm from 'node:vm';
import {createHmac,randomUUID} from 'node:crypto';
import proxy,{hashPassword} from '../netlify/functions/api.mjs';

const source = readdirSync('google-apps-script').filter(name => name.endsWith('.gs'))
  .map(name => readFileSync('google-apps-script/'+name,'utf8')).join('\n');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF6sAAAAASUVORK5CYII=','base64');
const secret = 'a'.repeat(64);
const pepper = 'b'.repeat(64);
const password = 'a test password 01';
const altPassword = 'a test password 02';
const testedHash = await hashPassword(password,pepper);
const altHash = await hashPassword(altPassword,pepper);
const MAX = 5*1024*1024;
const PART = 2*1024*1024;

function simulate() {
  const scripts = new Map(Object.entries({
    SHEET_ID:'spreadsheet',PROXY_SECRET:secret,SESSION_SECRET:'c'.repeat(64),
    BOOTSTRAP_USERNAME:'admin',BOOTSTRAP_HASH:testedHash
  }));
  const cache = new Map();
  const triggers = [];
  const sheets = new Map();
  const folders = new Map();
  const files = new Map();
  const iterator = items => {
    let offset = 0;
    return {hasNext:() => offset < items.length,next:() => items[offset++]};
  };
  const blob = (values,mime,name) => ({
    name,getBytes:() => Array.from(values),getContentType:() => mime
  });
  function makeFolder(name) {
    const id = randomUUID();
    const children = [];
    const contents = [];
    const result = {
      name,getId:() => id,setSharing(access) { this.access = access; },
      createFolder(child) {
        const created = makeFolder(child);
        children.push(created);
        return created;
      },
      getFoldersByName:child => iterator(children.filter(folder => folder.name === child)),
      createFile(data) {
        const fileId = randomUUID();
        const file = {id:fileId,name:data.name,trashed:false,getId:() => fileId,getBlob:() => data,
          setTrashed(value) { this.trashed = value; }};
        contents.push(file);
        files.set(fileId,file);
        return file;
      },
      getFilesByName:child => iterator(contents.filter(file => !file.trashed && file.name === child))
    };
    folders.set(id,result);
    return result;
  }
  const book = {
    getId:() => 'spreadsheet',setSpreadsheetTimeZone() {},
    getSheetByName:name => sheets.get(name),
    insertSheet(name) {
      const entries = [];
      const id = sheets.size+1;
      const sheet = {id,entries,getSheetId:() => id,getLastRow:() => entries.findLastIndex(row =>
        row?.some(value => value !== ''))+1,appendRow:row => entries.push(Array.from(row)),setFrozenRows() {},
      getRange:(row,col,height,width) => ({getValues:() => Array.from({length:height},(_,r) =>
        Array.from({length:width},(_,c) => entries[row-1+r]?.[col-1+c] ?? ''))})};
      sheets.set(name,sheet);
      return sheet;
    }
  };
  let batchFailure;
  let instant = Date.parse('2026-11-18T16:59:59.000Z');
  class Calendar extends Date {
    constructor(...args) { super(...(args.length ? args : [instant])); }
    static now() { return instant; }
  }
  const context = vm.createContext({
    console,Date:Calendar,
    PropertiesService:{getScriptProperties:() => ({getProperty:key => scripts.get(key),
      setProperty:(key,value) => scripts.set(key,value),deleteProperty:key => scripts.delete(key)})},
    CacheService:{getScriptCache:() => ({get:key => cache.get(key),
      put:(key,value) => cache.set(key,value),remove:key => cache.delete(key)})},
    LockService:{getScriptLock:() => ({tryLock:() => true,releaseLock() {}})},
    ScriptApp:{getProjectTriggers:() => triggers,newTrigger:name => ({timeBased:() => ({
      everyDays:() => ({create:() => triggers.push({getHandlerFunction:() => name})})
    })})},
    SpreadsheetApp:{openById:() => book,flush() {}},
    Sheets:{Spreadsheets:{batchUpdate({requests}) {
      if (batchFailure) {
        const fail = batchFailure;
        batchFailure = undefined;
        throw fail;
      }
      for (const request of requests) {
        const update = request.updateCells || request.appendCells || request.deleteDimension;
        const id = update.sheetId || update.start?.sheetId || update.range?.sheetId;
        const sheet = [...sheets.values()].find(item => item.id === id);
        if (request.deleteDimension) {
          sheet.entries.splice(update.range.startIndex,update.range.endIndex-update.range.startIndex);
          continue;
        }
        const values = update.rows[0].values.map(cell => Object.values(cell.userEnteredValue)[0]);
        sheet.entries[update.start?.rowIndex ?? sheet.getLastRow()] = Array.from(values);
      }
    }}},
    DriveApp:{Access:{PRIVATE:'PRIVATE'},Permission:{NONE:'NONE'},createFolder:makeFolder,
      getFolderById:id => folders.get(id),getFileById:id => {
        const file = files.get(id);
        if (!file || file.trashed) throw new Error('File missing');
        return file;
      }},
    Utilities:{getUuid:randomUUID,formatDate:(date,zone) => {
      assert.equal(zone,'Asia/Bangkok');
      return new Date(date.getTime()+7*3600000).toISOString().slice(0,10);
    },computeHmacSha256Signature:(data,key) => createHmac('sha256',key).update(data).digest(),
    base64EncodeWebSafe:bytes => Buffer.from(bytes).toString('base64url'),
    base64Encode:bytes => Buffer.from(bytes).toString('base64'),
    base64Decode:bytes => Array.from(Buffer.from(bytes,'base64')),newBlob:blob},
    ContentService:{MimeType:{JSON:'JSON'},createTextOutput:value => ({setMimeType:() => value})}
  });
  vm.runInContext(source,context);
  const evaluate = value => vm.runInContext(value,context);
  evaluate('setup()');
  const request = (action,data={},token='',supplied=secret) => JSON.parse(context.doPost({
    postData:{contents:JSON.stringify({action,data,token,secret:supplied})}
  }));
  function client(token='') {
    return (action,data) => {
      const result = request(action,data,token);
      assert.equal(result.ok,true,result.error);
      return result.data;
    };
  }
  function signIn(username,portal='member',hash=testedHash) {
    return client()('login',{username,password:hash,portal,clientKey:'127-test'}).token;
  }
  const adminToken = signIn('admin','admin');
  const admin = client(adminToken);
  function createMember(username,name=username) {
    return admin('memberSave',{username,name,password:testedHash,active:true}).id;
  }
  function stage(client,bytes,id=randomUUID()) {
    for (let i=0;i<Math.ceil(bytes.length/PART);i++) {
      client('upload',{id,part:i,bytes:bytes.subarray(i*PART,(i+1)*PART).toString('base64')});
    }
    return id;
  }
  return {request,createMember,signIn,client,admin,adminToken,stage,files,folders,sheets,scripts,
    advance:milliseconds => { instant += milliseconds; },evaluate,
    failNextBatch:() => { batchFailure = new Error('Simulated Sheets write failure'); }};
}

test('dynamic Bangkok age rules and follower changes preserve payments',() => {
  const env = simulate();
  const id = env.createMember('alice');
  const member = env.client(env.signIn('alice'));
  assert.equal(member('dashboard').goal,2000);
  const follower = (name,birth,previous) => env.admin('followerSave',{name,birth,memberId:id,id:previous});
  assert.equal(follower('Ten','2015-11-19').summary.goal,2000);
  env.advance(1000);
  assert.equal(member('dashboard').goal,4000);
  const fifteen = follower('Fifteen','2011-11-19');
  assert.equal(fifteen.summary.goal,6000);
  const another = follower('Second','2011-11-17');
  assert.equal(another.summary.goal,8000);
  const f = fifteen.followers.find(row => row.name === 'Fifteen');
  const payId = env.stage(member,png);
  member('submit',{id:payId,size:png.length,mime:'image/png',amount:500});
  env.admin('review',{id:payId,status:'Approved',bankVerified:true});
  assert.equal(follower('Fifteen','2020-11-18',f.id).summary.goal,6000);
  const ten = another.followers.find(row => row.name === 'Ten');
  const changed = env.admin('followerDelete',{id:ten.id,memberId:id}).summary;
  assert.equal(changed.goal,4000);
  assert.equal(changed.approved,500);
  assert.equal(changed.remaining,3500);
  assert.equal(env.admin('report')[0].goal,4000);
  assert.equal(member('history')[0].id,payId);
  assert.equal(env.request('followerSave',{name:'Invalid',birth:'2019-02-29',memberId:id},env.adminToken).status,400);
  assert.equal(env.evaluate("ageOn('2012-02-29','2023-02-28')"),10);
  assert.equal(env.evaluate("ageOn('2012-02-29','2023-03-01')"),11);
  const separate = env.createMember('two-fifteen');
  env.admin('followerSave',{memberId:separate,name:'One',birth:'2011-01-01'});
  assert.equal(env.admin('followerSave',{memberId:separate,name:'Two',birth:'2011-02-01'}).summary.goal,6000);
});

test('pending, review, rejection, cumulative approved amount and surplus',() => {
  const env = simulate();
  const id = env.createMember('alice');
  const token = env.signIn('alice');
  const member = env.client(token);
  const paymentId = env.stage(member,png);
  const data = {id:paymentId,size:png.length,mime:'image/png',amount:500,memberId:'forged',status:'Approved'};
  const pending = member('submit',data);
  assert.equal(pending.status,'Pending');
  assert.equal(pending.memberId,id);
  assert.equal(member('submit',data).id,paymentId);
  assert.equal(member('history').length,1);
  assert.equal(env.request('submit',{...data,amount:501},token).status,409);
  assert.equal(member('dashboard').approved,0);
  assert.equal(member('dashboard').pending,500);
  assert.equal(env.request('review',{id:paymentId,status:'Approved',bankVerified:true},token).status,403);
  assert.equal(env.request('review',{id:paymentId,status:'Approved'},env.adminToken).status,400);
  const reviewed = env.admin('review',{id:paymentId,status:'Approved',bankVerified:true,amount:999});
  assert.equal(reviewed.amount,500);
  assert.ok(reviewed.adminId);
  assert.ok(reviewed.reviewedAt);
  assert.equal(env.request('review',{id:paymentId,status:'Approved',bankVerified:true},env.adminToken).status,409);
  assert.equal(member('dashboard').approved,500);
  assert.equal(member('dashboard').remaining,1500);
  const rejectId = env.stage(member,png);
  member('submit',{...data,id:rejectId,amount:100});
  assert.equal(env.request('review',{id:rejectId,status:'Rejected',reason:' '},env.adminToken).status,400);
  env.admin('review',{id:rejectId,status:'Rejected',reason:'ไม่พบรายการในธนาคาร'});
  assert.equal(member('history')[0].reason,'ไม่พบรายการในธนาคาร');
  assert.equal(member('dashboard').approved,500);
  assert.equal(member('dashboard').pending,0);
  const top = env.stage(member,png);
  member('submit',{...data,id:top,amount:1600.25});
  env.admin('review',{id:top,status:'Approved',bankVerified:true});
  assert.equal(member('dashboard').remaining,0);
  assert.equal(member('dashboard').progress,100);
  assert.equal(member('dashboard').surplus,100.25);
  assert.equal(env.admin('adminDashboard').reached,1);
  assert.ok(env.admin('logs').items.some(row => row.Action === 'PAYMENT_APPROVED'));
  for (const id of [paymentId,rejectId,top]) assert.equal(member('slip',{id,part:0}).bytes,png.toString('base64'));
});

test('cross-member access and forged roles are rejected, Admin can read private slip',() => {
  const env = simulate();
  const id = env.createMember('alice');
  env.createMember('other');
  const owner = env.signIn('alice');
  const outsider = env.signIn('other');
  const member = env.client(owner);
  const payment = env.stage(member,png);
  member('submit',{id:payment,size:png.length,mime:'image/png',amount:20});
  assert.equal(env.request('slip',{id:payment,part:0,memberId:id,role:'admin'},outsider).status,404);
  assert.equal(env.request('paymentDetail',{id:payment},outsider).status,403);
  assert.equal(env.request('memberHistory',{memberId:id},outsider).status,403);
  assert.equal(env.request('adminDashboard',{},owner.replace('.member.','.admin.')).status,401);
  assert.equal(env.request('adminDashboard',{},owner).status,403);
  assert.equal(env.request('history',{memberId:id},outsider).data.length,0);
  assert.equal(env.request('history',{},owner,'bad-secret').status,403);
  assert.equal(env.admin('slip',{id:payment,part:0}).bytes,png.toString('base64'));
  assert.equal([...env.folders.values()].find(folder => folder.name === 'SavingSystem').access,'PRIVATE');
  assert.equal(Object.hasOwn(member('history')[0],'SlipFileID'),false);
});

test('session logout, expiry, password changes, reset, deactivation, duplicate usernames and rate limit',() => {
  const env = simulate();
  const id = env.createMember('alice');
  assert.equal(env.request('memberSave',{username:'alice',name:'Duplicate',password:testedHash,active:true},
    env.adminToken).status,409);
  const token = env.signIn('alice');
  const second = env.signIn('alice');
  env.client(token)('logout');
  assert.equal(env.request('history',{},token).status,401);
  assert.equal(env.request('password',{currentPassword:altHash,password:altHash},second).status,403);
  env.client(second)('password',{currentPassword:testedHash,password:altHash});
  assert.equal(env.request('history',{},second).status,401);
  assert.equal(env.request('login',{username:'alice',password:testedHash,portal:'member',clientKey:'same'}).status,401);
  const updated = env.signIn('alice','member',altHash);
  env.admin('memberReset',{id,password:testedHash});
  assert.equal(env.request('history',{},updated).status,401);
  const active = env.signIn('alice');
  env.admin('memberSave',{id,username:'renamed',name:'Alice',active:false,role:'admin'});
  assert.equal(env.request('history',{},active).status,401);
  env.admin('memberSave',{id,username:'renamed',name:'Alice',active:true});
  const expiring = env.signIn('renamed');
  env.advance(28800000);
  assert.equal(env.request('history',{},expiring).status,401);
  for (let i=0;i<8;i++) assert.equal(env.request('login',{username:'unknown',password:testedHash,clientKey:'same'}).status,401);
  assert.equal(env.request('login',{username:'unknown',password:testedHash,clientKey:'other'}).status,429);
});

test('upload validation, 5 MiB chunk transfer, idempotent retries and Sheets write failure',() => {
  const env = simulate();
  env.createMember('alice');
  const token = env.signIn('alice');
  const member = env.client(token);
  const wrong = env.stage(member,Buffer.from('not an image'));
  assert.equal(env.request('submit',{id:wrong,size:12,mime:'image/png',amount:10},token).status,400);
  const mismatch = env.stage(member,png);
  assert.equal(env.request('submit',{id:mismatch,size:png.length,mime:'image/jpeg',amount:10},token).status,400);
  assert.equal(env.request('submit',{id:mismatch,size:MAX+1,mime:'image/png',amount:10},token).status,400);
  assert.equal(env.request('submit',{id:mismatch,size:png.length,mime:'image/png',amount:10.001},token).status,400);
  assert.equal(env.request('upload',{id:mismatch,part:0,bytes:Buffer.alloc(PART+1).toString('base64')},token).status,400);
  assert.equal(env.request('upload',{id:mismatch,part:0,bytes:Buffer.from('different').toString('base64')},token).status,409);
  const jpeg = Buffer.alloc(MAX);
  jpeg.set([255,216,255],0);
  jpeg.set([255,217],MAX-2);
  const large = env.stage(member,jpeg);
  env.stage(member,jpeg,large);
  const data = {id:large,size:MAX,mime:'image/jpeg',amount:25};
  env.failNextBatch();
  assert.equal(env.request('submit',data,token).status,500);
  assert.equal(member('history').length,0);
  const receipt = member('submit',data);
  assert.equal(receipt.status,'Pending');
  const parts = [0,1,2].map(part => Buffer.from(member('slip',{id:large,part}).bytes,'base64'));
  assert.equal(Buffer.compare(Buffer.concat(parts),jpeg),0);
  assert.equal([...env.files.values()].filter(file => !file.trashed && file.name === large+'.jpg').length,1);
  assert.equal(env.request('slip',{id:large,part:3},token).status,400);
  env.advance(86400001);
  env.evaluate('purgeExpired()');
  assert.equal([...env.files.values()].filter(file => !file.trashed).length,1);
});

test('Netlify proxy forwards signed-session cookie securely, rejects cross-origin and follows only Google redirect',async t => {
  const env = simulate();
  env.createMember('alice');
  const endpoint = 'https://script.google.com/macros/s/test/exec';
  const location = 'https://script.googleusercontent.com/test';
  const restored = Object.fromEntries(['GAS_URL','PROXY_SECRET','PASSWORD_PEPPER'].map(key => [key,process.env[key]]));
  Object.assign(process.env,{GAS_URL:endpoint,PROXY_SECRET:secret,PASSWORD_PEPPER:pepper});
  t.after(() => Object.entries(restored).forEach(([key,value]) => {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }));
  let result;
  let badRedirect = false;
  t.mock.method(globalThis,'fetch',async (url,options) => {
    if (String(url) === endpoint) {
      assert.equal(options.redirect,'manual');
      const envelope = JSON.parse(options.body);
      assert.notEqual(envelope.data.password,password);
      result = env.request(envelope.action,envelope.data,envelope.token,envelope.secret);
      return new Response(null,{status:302,headers:{location:badRedirect?'https://example.com':location}});
    }
    assert.equal(String(url),location);
    assert.equal(options.method,undefined);
    return Response.json(result);
  });
  const invoke = (action,data={},cookie='',origin='https://saving.test') => proxy(new Request('https://saving.test/api',{
    method:'POST',headers:{origin,cookie,'content-type':'application/json'},body:JSON.stringify({action,data})
  }),{ip:'192.0.2.1'});
  const login = await invoke('login',{username:'ALICE',password});
  assert.equal(login.status,200);
  assert.deepEqual(await login.json(),{role:'member'});
  const headers = login.headers.get('set-cookie');
  assert.match(headers,/HttpOnly; Secure; SameSite=Strict; Max-Age=28800/);
  const cookie = headers.split(';')[0];
  assert.equal((await invoke('session')).status,401);
  assert.equal((await invoke('session',{},cookie,'https://another.test')).status,403);
  assert.equal((await invoke('adminDashboard',{},cookie)).status,403);
  assert.equal((await invoke('dashboard',{},cookie)).status,200);
  const logout = await invoke('logout',{},cookie);
  assert.match(logout.headers.get('set-cookie'),/Max-Age=0/);
  assert.equal((await invoke('dashboard',{},cookie)).status,401);
  badRedirect = true;
  assert.equal((await invoke('session',{},cookie)).status,502);
});
