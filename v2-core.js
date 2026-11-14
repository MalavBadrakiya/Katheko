/* Calendar arithmetic uses UTC day numbers: daylight saving cannot shorten a day. */
(function (root) {
  const day = value => Math.floor(Date.parse(value.slice(0, 10) + 'T00:00:00Z') / 86400000);
  const iso = n => new Date(n * 86400000).toISOString().slice(0, 10);
  const today = (timezone) => { const d = new Date(); if(timezone){const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(d).map(x=>[x.type,x.value]));return `${p.year}-${p.month}-${p.day}`;} return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
  const add = (date,n) => iso(day(date)+n);
  const monday = date => add(date,-((new Date(date+'T12:00:00Z').getUTCDay()+6)%7));
  const dates = (a,b) => Array.from({length:Math.max(0,day(b)-day(a)+1)},(_,i)=>add(a,i));
  const target = (h,date) => (h.targetHistory || [{from:h.startDate,target:h.weeklyTarget}]).filter(x=>x.from<=date).sort((a,b)=>b.from.localeCompare(a.from))[0]?.target || h.targetHistory?.[0]?.target || h.weeklyTarget;
  const count = (h,a,b) => dates(a,b).filter(d=>d>=h.startDate && d<=(h.archivedAt||'9999-12-31') && h.logs?.[d]===true).length;
  const week = (h,date,now=today()) => { const a=monday(date),b=add(a,6),start=a>h.startDate?a:h.startDate,end=b<(h.archivedAt||b)?b:(h.archivedAt||b); const eligible=Math.max(0,day(end)-day(start)+1); const goal=Math.min(target(h,a),eligible); const done=count(h,start,b<now?b:now); return {start:a,end:b,goal,done,met:goal>0&&done>=goal,percent:goal?Math.min(100,Math.round(done/goal*100)):0}; };
  const month = (h,date,now=today()) => {
    const start=date.slice(0,7)+'-01', next=new Date(start+'T12:00:00Z');
    next.setUTCMonth(next.getUTCMonth()+1);
    const end=add(next.toISOString().slice(0,10),-1);
    const eligible=dates(start,end).filter(d=>d>=h.startDate&&d<=(h.archivedAt||end));
    const goal=Math.ceil(eligible.reduce((sum,d)=>sum+target(h,monday(d)),0)/7);
    const done=count(h,start,end<now?end:now);
    return {start,end,goal,done,met:goal>0&&done>=goal,percent:goal?Math.min(100,Math.round(done/goal*100)):0};
  };
  const points = (h,now=today()) => { let total=count(h,h.startDate,now)*10; for(let d=monday(h.startDate);d<=now;d=add(d,7)) if(week(h,d,now).met) total+=30; return total; };
  const streak = (h,now=today()) => {let d=monday(now),n=0;if(!week(h,d,now).met)d=add(d,-7);for(;d>=monday(h.startDate);d=add(d,-7)){if(!week(h,d,now).met)break;n++;}return n;};
  const normalise = (raw,user,now=today()) => {
    const s=JSON.parse(JSON.stringify(raw||{})); if(raw && raw.version!==2 && !s.legacyV1) s.legacyV1=JSON.parse(JSON.stringify(raw)); s.users=[{id:user.id,name:user.user_metadata?.display_name||s.users?.find(x=>x.id===user.id)?.name||'You',email:user.email||''}];s.activeUserId=user.id;
    // The authenticated row owns its records, including IDs from the old demo migration.
    // Keep the original ownership in legacyV1; never silently discard a saved habit.
    s.habits=(s.habits||[]).map(h=>({...h,userId:user.id,startDate:h.startDate||[h.createdAt?.slice(0,10),...Object.keys(h.logs||{})].filter(Boolean).sort()[0]||now,logs:h.logs||{},weeklyTarget:Math.max(1,Math.min(7,Number(h.weeklyTarget)||1))}));
    s.timezone ||= 'Europe/London'; s.version=2; return s;
  };
  const api={day,iso,today,add,monday,dates,target,count,week,month,points,streak,normalise};
  if(typeof module!=='undefined')module.exports=api;else root.KathekoCore=api;
})(globalThis);
