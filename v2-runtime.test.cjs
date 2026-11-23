const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),crypto=require('node:crypto');
function app(preview=true,db){const root={innerHTML:'',focus(){},remove(){},querySelectorAll:()=>[]},editor={innerHTML:'',showModal(){this.open=true},close(){this.open=false}},events={},dialogs=[];const body={append:dialog=>dialogs.push(dialog)};const context=vm.createContext({KathekoCore:require('./v2-core'),crypto,console,navigator:{},Date,setTimeout,clearTimeout,setInterval:()=>0,Blob,URL,window:{KATHEKO_PREVIEW:preview,supabase:{createClient:()=>db}},SUPABASE_URL:'test',SUPABASE_KEY:'test',document:{body,activeElement:body,querySelector:selector=>selector==='#editor'?editor:root,addEventListener:(k,f)=>events[k]=f,createElement:()=>({innerHTML:'',addEventListener(){},setAttribute(){},querySelector:()=>({focus(){}}),querySelectorAll:()=>[],showModal(){this.open=true},close(){this.open=false},remove(){dialogs.splice(dialogs.indexOf(this),1)}})},confirm:()=>true});vm.runInContext(fs.readFileSync(__dirname+'/v2.js','utf8'),context);return{root,events,dialogs,editor};}
test('preview renders four routes and three periods',async()=>{const a=app();assert.match(a.root.innerHTML,/Make today count/);for(const view of ['analytics','social','profile','habits']){await a.events.click({target:{closest:()=>({dataset:{do:'nav',view}})}});assert.ok(a.root.innerHTML.includes('class="shell"'));assert.ok(!a.root.innerHTML.includes('undefined'));}for(const mode of ['day','week','month']){await a.events.click({target:{closest:()=>({dataset:{do:'mode',mode}})}});assert.match(a.root.innerHTML,/Read 20 minutes/);}});
test('shared history moves back and returns to current week independently of habit mode',async()=>{const a=app();const click=async action=>a.events.click({target:{closest:()=>({dataset:{do:action}})}});await a.events.click({target:{closest:()=>({dataset:{do:'nav',view:'social'}})}});const dates=()=>[...a.root.innerHTML.matchAll(/data-date="(\d{4}-\d{2}-\d{2})"/g)].map(x=>x[1]);const current=dates();assert.equal(current.length,7);await click('shared-previous');assert.equal(require('./v2-core').day(current[0])-require('./v2-core').day(dates()[0]),7);await click('shared-today');assert.deepEqual(dates(),current);assert.match(a.root.innerHTML,/Mark seen/);await click('seen');assert.doesNotMatch(a.root.innerHTML,/Mark seen/);});
test('failed reads never save blank state',async()=>{let writes=0;const db={auth:{getSession:async()=>({data:{session:{user:{id:'real'}}}})},from:()=>({select(){return this},eq(){return this},maybeSingle:async()=>({error:{message:'offline'}})}),rpc:()=>{writes++;}};const a=app(false,db);await new Promise(r=>setTimeout(r,10));assert.equal(writes,0);assert.match(a.root.innerHTML,/No changes have been saved/);});

test('Analytics switches every period surface and excludes Day',async()=>{const a=app();await a.events.click({target:{closest:()=>({dataset:{do:'mode',mode:'day'}})}});await a.events.click({target:{closest:()=>({dataset:{do:'nav',view:'analytics'}})}});assert.match(a.root.innerHTML,/Weekly targets/);assert.doesNotMatch(a.root.innerHTML,/data-mode="day"/);await a.events.click({target:{closest:()=>({dataset:{do:'mode',mode:'month'}})}});assert.match(a.root.innerHTML,/Monthly target progress/);assert.match(a.root.innerHTML,/Monthly targets met/);assert.match(a.root.innerHTML,/Monthly targets/);assert.doesNotMatch(a.root.innerHTML,/Weekly target progress|Last 7 days/);await a.events.click({target:{closest:()=>({dataset:{do:'nav',view:'habits'}})}});assert.match(a.root.innerHTML,/data-mode="day"/);});

const click = (app, action, data = {}) =>
  app.events.click({target:{closest:()=>({dataset:{do:action,...data}})}});

test('Profile replay supports practice, back, close, and resets the sample on reopening', async () => {
  const a = app();
  await click(a, 'nav', {view:'profile'});
  assert.match(a.root.innerHTML, /Replay tutorial/);
  const profile = a.root.innerHTML;
  await click(a, 'tutorial-open');
  const [dialog] = a.dialogs;
  assert.match(dialog.innerHTML, /Start with one habit/);
  await click(a, 'tutorial-next');
  await click(a, 'tutorial-sample');
  assert.match(dialog.innerHTML, /aria-pressed="true"/);
  await click(a, 'tutorial-back');
  assert.match(dialog.innerHTML, /Start with one habit/);
  await click(a, 'tutorial-done');
  assert.equal(a.dialogs.length, 0);
  assert.equal(a.root.innerHTML, profile);
  await click(a, 'tutorial-open');
  await click(a, 'tutorial-next');
  assert.match(a.dialogs[0].innerHTML, /aria-pressed="false"/);
});

test('automatic tutorial is limited to eligible accounts and saves its dismissal once', async () => {
  const social = {friends:[], incoming:[], outgoing:[], shares:[], edits:[], results:[]};
  let stored = null;
  let writes = 0;
  function signIn(created_at, withSession = true) {
    const user = {id:'learner', created_at};
    let listener;
    const db = {
      auth:{
        getSession:async()=>({data:{session:withSession ? {user} : null}}),
        onAuthStateChange:callback=>{listener=callback;}
      },
      from:()=>({select(){return this},eq(){return this},maybeSingle:async()=>({data:stored})}),
      async rpc(name,args) {
        if(name==='katheko_v2_social') return {data:social};
        assert.equal(name,'katheko_v2_save');
        assert.equal(args.expected_revision,null);
        stored={data:args.payload,updated_at:'saved'};
        writes++;
        return {data:'saved'};
      }
    };
    return {app:app(false,db), signIn:()=>listener('SIGNED_IN',{user})};
  }
  const settled = ()=>new Promise(resolve=>setTimeout(resolve,10));
  const existing = signIn('2026-11-22T23:59:59Z').app;
  await settled();
  assert.equal(existing.dialogs.length,0);
  const fresh = signIn('2026-11-23T00:00:00Z',false);
  await settled();
  fresh.signIn();
  await settled();
  assert.equal(fresh.app.dialogs.length,1);
  await click(fresh.app,'tutorial-next');
  await click(fresh.app,'tutorial-sample');
  assert.equal(writes,0);
  await click(fresh.app,'tutorial-done');
  assert.equal(writes,1);
  assert.equal(stored.data.webTutorialVersion,1);
  assert.equal(stored.data.habits.length,0);
  const returning = signIn('2026-11-23T00:00:00Z').app;
  await settled();
  assert.equal(returning.dialogs.length,0);
  await click(returning,'tutorial-open');
  await click(returning,'tutorial-done');
  assert.equal(writes,1);
});

test('the final tutorial action opens the real habit form', async () => {
  const a = app();
  await click(a,'nav',{view:'profile'});
  await click(a,'tutorial-open');
  for (let step=0;step<4;step++) await click(a,'tutorial-next');
  assert.match(a.dialogs[0].innerHTML,/Find your settings and help/);
  await click(a,'tutorial-add');
  assert.equal(a.dialogs.length,0);
  assert.equal(a.editor.open,true);
  assert.match(a.editor.innerHTML,/data-form="habit"/);
  assert.match(a.root.innerHTML,/Make today count/);
});

test('Profile owns the consolidated help document', async () => {
  const a=app();
  await click(a,'nav',{view:'social'});
  assert.doesNotMatch(a.root.innerHTML,/Points and accountability/);
  await click(a,'nav',{view:'analytics'});
  assert.doesNotMatch(a.root.innerHTML,/About these numbers/);
  await click(a,'nav',{view:'profile'});
  assert.match(a.root.innerHTML,/How Katheko works/);
  assert.doesNotMatch(a.root.innerHTML,/A clear points system/);
  await click(a,'help-open');
  assert.equal(a.editor.open,true);
  assert.match(a.editor.innerHTML,/Friends and privacy/);
  assert.match(a.editor.innerHTML,/Archived habits/);
  assert.match(a.editor.innerHTML,/\+10/);
});

test('archived habits can be restored or permanently deleted', async () => {
  const a=app();
  await click(a,'archive',{id:'habit-0'});
  await click(a,'archive-view');
  assert.match(a.root.innerHTML,/Restore/);
  assert.match(a.root.innerHTML,/Delete forever/);
  await click(a,'delete-habit',{id:'habit-0'});
  assert.doesNotMatch(a.root.innerHTML,/Read 20 minutes/);
});
