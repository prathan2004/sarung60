function ageOn(birth, today) {
  return Number(today.slice(0,4)) - Number(birth.slice(0,4)) -
    (today.slice(5) < birth.slice(5) ? 1 : 0);
}
function validBirth(value,today) {
  check(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value), 'วันเกิดไม่ถูกต้อง');
  const date = new Date(value+'T00:00:00Z');
  check(!isNaN(date.getTime()) && date.toISOString().slice(0,10) === value &&
    value >= '1900-01-01' && value <= today, 'วันเกิดไม่ถูกต้อง');
  return value;
}
function followerList(followers, config, today) {
  return followers.map(row => {
    const age = ageOn(row.BirthDate,today);
    const eligible = age >= config.FOLLOWER_MIN_AGE;
    return {id:row.FollowerID,name:row.FollowerName,birth:row.BirthDate,age,eligible,
      extra:eligible ? config.FOLLOWER_GOAL : 0};
  });
}
function followerDashboard(member, followers, today = localDate()) {
  const config = settings();
  const payments = rows('Payments').filter(row => row.MemberID === member.MemberID);
  return {summary:summary(member,followers,payments,config,today),
    followers:followerList(followers,config,today)};
}
function changeFollower(actor,data,remove) {
  const member = memberById(data.memberId);
  const followers = rows('Followers').filter(row => row.MemberID === member.MemberID);
  const old = data.id && followers.find(row => row.FollowerID === data.id);
  check(!(data.id || remove) || old, 'ไม่พบผู้ติดตาม',404);
  const id = old ? old.FollowerID : uid();
  const today = localDate();
  const birth = remove ? '' : validBirth(data.birth,today);
  const name = remove ? '' : clean(data.name,120);
  const mutation = remove ? erase('Followers',old._index) :
    put('Followers',[id,member.MemberID,name,birth,old ? old.CreatedAt : now(),now()],old ? old._index : undefined);
  commit([mutation,audit(actor,remove ? 'FOLLOWER_DELETED' : old ? 'FOLLOWER_UPDATED' : 'FOLLOWER_CREATED',
    member.MemberID,'',JSON.stringify({id,previousBirth:old ? old.BirthDate : null,birth:birth || null}))]);
  const updated = {FollowerID:id,FollowerName:name,BirthDate:birth};
  const next = remove ? followers.filter(row => row !== old) :
    old ? followers.map(row => row === old ? updated : row) : [...followers,updated];
  return followerDashboard(member,next,today);
}
