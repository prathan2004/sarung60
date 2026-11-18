function database() { return SpreadsheetApp.openById(props().getProperty('SHEET_ID')); }
function rows(name) {
  const sheet = database().getSheetByName(name);
  const fields = SCHEMA[name].split(' ');
  if (sheet.getLastRow() < 2) return [];
  return sheet.getRange(2,1,sheet.getLastRow()-1,fields.length).getValues().map((values,i) => {
    const row = {_index:i+1};
    fields.forEach((field,j) => row[field] = values[j] instanceof Date
      ? field === 'BirthDate' ? localDate(values[j]) : values[j].toISOString() : values[j]);
    return row;
  }).filter(row => row[fields[0]] !== '');
}
function put(name, values, index) { return {name,values,index}; }
function erase(name, index) { return put(name, SCHEMA[name].split(' ').map(() => ''), index); }
function compact(names) {
  const book = database();
  const requests = [];
  for (const name of names) {
    const sheet = book.getSheetByName(name);
    const last = sheet.getLastRow();
    if (last <= 1) continue;
    const ids = sheet.getRange(2,1,last-1,1).getValues();
    for (let i = ids.length - 1; i >= 0; i--) {
      if (ids[i][0] === '') requests.push({deleteDimension:{range:{
        sheetId:sheet.getSheetId(),dimension:'ROWS',startIndex:i+1,endIndex:i+2
      }}});
    }
  }
  if (requests.length) Sheets.Spreadsheets.batchUpdate({requests},book.getId());
}
function commit(changes) {
  if (!changes.length) return;
  const book = database();
  const requests = changes.map(({name,values,index}) => {
    const sheetId = book.getSheetByName(name).getSheetId();
    const data = {values:values.map(value => ({userEnteredValue:typeof value === 'number'
      ? {numberValue:value} : typeof value === 'boolean' ? {boolValue:value} : {stringValue:String(value)}}))};
    return index === undefined
      ? {appendCells:{sheetId,rows:[data],fields:'userEnteredValue'}}
      : {updateCells:{start:{sheetId,rowIndex:index,columnIndex:0},rows:[data],fields:'userEnteredValue'}};
  });
  Sheets.Spreadsheets.batchUpdate({requests},book.getId());
}
function audit(actor, action, member = '', payment = '', detail = '') {
  return put('AuditLogs',[uid(),now(),actor.id,action,member,payment,detail]);
}
