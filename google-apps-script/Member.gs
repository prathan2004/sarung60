function publicMember(r) {
  return {id:r.MemberID,name:r.Name,username:r.Username,active:r.Active};
}
function memberById(id) {
  const member = rows('Members').find(row => row.MemberID === id);
  check(member, 'ไม่พบสมาชิก',404);
  return member;
}
function settings() {
  return Object.assign({},DEFAULTS,Object.fromEntries(rows('Settings').map(row => [row.Key,row.Value])));
}
function summary(member, followers, payments, config, today) {
  const eligible = followers.filter(row => ageOn(row.BirthDate,today) >= config.FOLLOWER_MIN_AGE).length;
  const extra = eligible * config.FOLLOWER_GOAL;
  const goal = config.BASE_GOAL + extra;
  const total = status => payments.reduce((sum,row) => sum + (row.Status === status ? Math.round(row.Amount*100) : 0),0);
  const approvedCents = total('Approved');
  const approved = approvedCents / 100;
  return {...publicMember(member),base:config.BASE_GOAL,followers:followers.length,eligible,extra,goal,approved,
    pending:total('Pending')/100,remaining:Math.max(0,goal*100-approvedCents)/100,
    surplus:Math.max(0,approvedCents-goal*100)/100,progress:Math.min(100,approved/goal*100)};
}
function groupByMember(values) {
  const groups = new Map();
  for (const row of values) {
    if (!groups.has(row.MemberID)) groups.set(row.MemberID,[]);
    groups.get(row.MemberID).push(row);
  }
  return groups;
}
function summaries(members) {
  const config = settings();
  const today = localDate();
  const followers = groupByMember(rows('Followers'));
  const payments = groupByMember(rows('Payments'));
  return members.map(member => summary(member,followers.get(member.MemberID)||[],payments.get(member.MemberID)||[],config,today));
}
