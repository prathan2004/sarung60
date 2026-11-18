function publicPayment(r) {
  return {id:r.PaymentID,memberId:r.MemberID,createdAt:r.CreatedAt,amount:r.Amount,status:r.Status,
    adminId:r.AdminID,reviewedAt:r.ReviewedAt,reason:r.RejectReason};
}
function paymentById(id) {
  const row = rows('Payments').find(item => item.PaymentID === id);
  check(row,'ไม่พบรายการชำระเงิน',404);
  return row;
}
function visiblePayment(actor,id) {
  const row = paymentById(id);
  check(actor.role === 'admin' || row.MemberID === actor.id,'ไม่พบรายการชำระเงิน',404);
  return row;
}
function uploadId(id) {
  check(typeof id === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(id),
    'รหัสการส่งไม่ถูกต้อง');
}
function uploadPart(actor,data) {
  uploadId(data.id);
  const part = data.part;
  check(Number.isInteger(part) && part >= 0 && part < Math.ceil(MAX_FILE / CHUNK),'ลำดับไฟล์ไม่ถูกต้อง');
  const existing = rows('Payments').find(row => row.PaymentID === data.id);
  if (existing) {
    check(existing.MemberID === actor.id,'รหัสการส่งซ้ำ',409);
    return {};
  }
  check(typeof data.bytes === 'string' && data.bytes.length <= Math.ceil(CHUNK/3)*4 &&
    /^[A-Za-z0-9+/]+={0,2}$/.test(data.bytes) && data.bytes.length%4 === 0,'ข้อมูลไฟล์ไม่ถูกต้อง');
  const bytes = Utilities.base64Decode(data.bytes);
  check(bytes.length > 0 && bytes.length <= CHUNK,'ขนาดไฟล์ไม่ถูกต้อง');
  const uploads = rows('Uploads');
  const previous = uploads.find(row => row.UploadID === data.id && row.MemberID === actor.id && row.Part === part);
  if (previous) {
    check(same(data.bytes,Utilities.base64Encode(DriveApp.getFileById(previous.FileID).getBlob().getBytes())),
      'ข้อมูลการส่งซ้ำไม่ตรงกัน',409);
    return {};
  }
  check(uploads.filter(row => row.MemberID === actor.id).length < 24,'มีไฟล์ที่อัปโหลดค้างหลายรายการ',429);
  const staging = folder(slipRoot(),'Staging');
  const filename = [actor.id,data.id,part].join('.');
  const candidates = staging.getFilesByName(filename);
  const file = candidates.hasNext() ? candidates.next() :
    staging.createFile(Utilities.newBlob(bytes,'application/octet-stream',filename));
  check(same(data.bytes,Utilities.base64Encode(file.getBlob().getBytes())),
    'ข้อมูลการส่งซ้ำไม่ตรงกัน',409);
  commit([put('Uploads',[data.id,actor.id,part,file.getId(),now()])]);
  return {};
}
function submitPayment(actor,data) {
  uploadId(data.id);
  const amount = data.amount;
  const cents = Math.round(amount*100);
  check(typeof amount === 'number' && cents > 0 && cents <= 100000000000 && cents/100 === amount,
    'กรอกจำนวนเงินมากกว่า 0 และใช้ทศนิยมไม่เกิน 2 ตำแหน่ง');
  const existing = rows('Payments').find(row => row.PaymentID === data.id);
  if (existing) {
    check(existing.MemberID === actor.id && existing.Amount === amount,'ข้อมูลการส่งซ้ำไม่ตรงกัน',409);
    return publicPayment(existing);
  }
  const parts = rows('Uploads').filter(row => row.UploadID === data.id && row.MemberID === actor.id)
    .sort((a,b) => a.Part-b.Part);
  check(Number.isInteger(data.size) && data.size > 0 && data.size <= MAX_FILE &&
    parts.length === Math.ceil(data.size/CHUNK), 'ข้อมูลอัปโหลดไม่ครบหรือเกิน 5 MB');
  let bytes = [];
  parts.forEach((part,i) => {
    const chunk = DriveApp.getFileById(part.FileID).getBlob().getBytes();
    check(part.Part === i && chunk.length === Math.min(CHUNK,data.size-i*CHUNK), 'ข้อมูลอัปโหลดไม่ครบ');
    bytes = bytes.concat(chunk);
  });
  const [mime,ext] = fileType(bytes);
  check(mime === data.mime,'ประเภทไฟล์ไม่ตรงกับเนื้อหา');
  const destination = slipFolder();
  const filename = data.id+'.'+ext;
  const existingFiles = destination.getFilesByName(filename);
  let file;
  while (existingFiles.hasNext()) {
    const candidate = existingFiles.next();
    if (same(Utilities.base64Encode(candidate.getBlob().getBytes()),Utilities.base64Encode(bytes))) {
      file = candidate;
      break;
    }
  }
  if (!file) file = destination.createFile(Utilities.newBlob(bytes,mime,filename));
  const created = now();
  commit([put('Payments',[data.id,actor.id,created,amount,file.getId(),'Pending','','','']),
    audit(actor,'PAYMENT_SUBMITTED',actor.id,data.id,String(amount))]);
  const removed = parts.filter(part => trash(part.FileID));
  commit(removed.map(part => erase('Uploads',part._index)));
  return {id:data.id,memberId:actor.id,createdAt:created,amount,status:'Pending'};
}
function readSlip(actor,data) {
  const row = visiblePayment(actor,data.id);
  const blob = DriveApp.getFileById(row.SlipFileID).getBlob();
  const bytes = blob.getBytes();
  const mime = blob.getContentType();
  check(['image/jpeg','image/png','image/webp'].includes(mime) && bytes.length <= MAX_FILE,'ไฟล์ไม่ถูกต้อง');
  const part = data.part;
  check(Number.isInteger(part) && part >= 0 && part*CHUNK < bytes.length,'ลำดับไฟล์ไม่ถูกต้อง');
  return {mime,size:bytes.length,parts:Math.ceil(bytes.length/CHUNK),
    bytes:Utilities.base64Encode(bytes.slice(part*CHUNK,(part+1)*CHUNK))};
}
function reviewPayment(actor,data) {
  const row = paymentById(data.id);
  check(row.Status === 'Pending','รายการนี้ตรวจสอบแล้ว',409);
  check(['Approved','Rejected'].includes(data.status),'สถานะไม่ถูกต้อง');
  if (data.status === 'Approved') check(data.bankVerified === true,'กรุณายืนยันว่าตรวจเงินเข้าบัญชีแล้ว');
  const reason = data.status === 'Rejected' ? clean(data.reason,500) : '';
  const reviewedAt = now();
  commit([put('Payments',[row.PaymentID,row.MemberID,row.CreatedAt,row.Amount,row.SlipFileID,
    data.status,actor.id,reviewedAt,reason],row._index),
  audit(actor,'PAYMENT_'+data.status.toUpperCase(),row.MemberID,row.PaymentID,reason)]);
  return publicPayment({...row,Status:data.status,AdminID:actor.id,ReviewedAt:reviewedAt,RejectReason:reason});
}
function reopenPayment(actor,data) {
  const row = paymentById(data.id);
  check(['Approved','Rejected'].includes(row.Status) &&
    row.Status === data.status && row.ReviewedAt === data.reviewedAt,
    'ผลตรวจสอบเปลี่ยนแล้ว กรุณาเปิดรายการอีกครั้ง',409);
  const reason = clean(data.reason,500);
  const previous = {
    status:row.Status,adminId:row.AdminID,reviewedAt:row.ReviewedAt,rejectReason:row.RejectReason
  };
  commit([put('Payments',[row.PaymentID,row.MemberID,row.CreatedAt,row.Amount,row.SlipFileID,
    'Pending','','',''],row._index),
    audit(actor,'PAYMENT_REOPENED',row.MemberID,row.PaymentID,JSON.stringify({reason,previous}))]);
  return publicPayment({...row,Status:'Pending',AdminID:'',ReviewedAt:'',RejectReason:''});
}
