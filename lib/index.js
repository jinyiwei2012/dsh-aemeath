import {readFileSync, mkdirSync, writeFileSync, renameSync, statSync} from 'node:fs';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {PetState,safeBalance} from './state.js';
import {DesktopManager,validateManifest} from './desktop.js';
import {EntryPreferences} from './entry-preferences.js';
import {buildCard,buildReinforce,listCharacters,listThemes,resolveSelection} from './rp.js';
export const name='aemeath';
export const inject=['webServer','connection','sessions','deepseekAccount'];
export const PREFIX='/aemeath-full';
export function createHandler(manager,connection,token,icon,entryPreferences,home) {
  return async(req,res)=>{
    const send=(status,value)=>{res.statusCode=status;res.setHeader('content-type','application/json; charset=utf-8');res.setHeader('cache-control','no-store');res.end(JSON.stringify(value));};
    const rejection=connection.requestRejection(req);
    if(rejection!==undefined){send(rejection,{error:'请先登录本机 Harness'});return;}
    const path=new URL(req.url,'http://localhost').pathname;
    if(req.method==='GET'&&path===PREFIX+'/icon.png'){res.setHeader('content-type','image/png');res.setHeader('cache-control','private,max-age=3600');res.end(icon);return;}
    if(req.method==='GET'&&path===PREFIX+'/status'){
      const status=await manager.status();
      const entry=entryPreferences?await entryPreferences.status(status.installed,status.running):{entryHidden:false};
      send(200,{...status,...entry,token});return;
    }
    // The pet reads its own role-play options on start. This only reports what
    // ships with the plugin, so it stays behind the login check above.
    if(req.method==='GET'&&path===PREFIX+'/rp'){
      const roots=rpRoots(),settings=readRp(home);
      send(200,{settings,characters:listCharacters(roots.skills),themes:listThemes(roots.themes)});return;
    }
    if(req.method!=='POST'||path!==PREFIX+'/action'){send(404,{error:'未知入口'});return;}
    const origin=req.headers.origin;
    let sameOrigin=!origin;try{if(origin)sameOrigin=new URL(origin).host===req.headers.host;}catch{}
    if(req.headers['x-aemeath-token']!==token||!sameOrigin){send(403,{error:'请求来源无效'});return;}
    let raw='';
    try {
      for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>2048){send(413,{error:'请求过大'});return;}}
      const {action,source,rp}=JSON.parse(raw);
      if(action==='install'){
        if(!['auto','github','mirror'].includes(source)){send(400,{error:'请选择下载来源'});return;}
        if(manager.busy){send(409,{error:'安装正在进行'});return;}
        void manager.install(source).catch(()=>{});send(202,{ok:true});
      }else if(action==='set_rp'){
        send(200,{ok:true,settings:writeRp(home,rp)});
      }else if(action==='start'||action==='settings'){await manager.start(action==='settings');send(200,{ok:true});}
      else if(action==='stop'){await manager.stop();send(200,{ok:true});}
      else if(action==='hide'){await manager.command('hide');send(200,{ok:true});}
      else if(action==='hide_entry'||action==='show_entry'){
        if(!entryPreferences)throw new Error('入口设置尚未就绪');
        if(action==='hide_entry'&&!(await manager.status()).installed)throw new Error('请先完成完整版安装');
        await entryPreferences.setHidden(action==='hide_entry');send(200,{ok:true});
      }
      else send(400,{error:'不支持此操作'});
    } catch(error){send(400,{error:error.message||'操作失败'});}
  };
}
// Role-play injection belongs to the pet: it ships its own skills and themes, so
// a machine without a separate RP plugin still gets the persona card. The choice
// lives in aemeath-market/rp.json next to the desktop link, and every section
// text is a function, so switching characters takes effect on the next request
// without restarting the pet or remounting the plugin.
export const RP_DEFAULT={enabled:false,selected:'',themeEnabled:false,themeId:''};
export function rpRoots(base=new URL('../',import.meta.url)){
  return {skills:fileURLToPath(new URL('rp/skills/',base)),themes:fileURLToPath(new URL('rp/themes/',base))};
}
export function readRp(home){
  try{return {...RP_DEFAULT,...JSON.parse(readFileSync(join(home,'aemeath-market','rp.json'),'utf8'))};}
  catch{return {...RP_DEFAULT};}
}
// Only the four known fields are accepted; anything else keeps its previous value.
export function writeRp(home,patch){
  const current=readRp(home),next={...current};
  if(patch&&typeof patch==='object'){
    if(typeof patch.enabled==='boolean')next.enabled=patch.enabled;
    if(typeof patch.selected==='string')next.selected=patch.selected.slice(0,64);
    if(typeof patch.themeEnabled==='boolean')next.themeEnabled=patch.themeEnabled;
    if(typeof patch.themeId==='string')next.themeId=patch.themeId.slice(0,64);
  }
  const dir=join(home,'aemeath-market');
  mkdirSync(dir,{recursive:true});
  writeFileSync(join(dir,'rp.json')+'.tmp',JSON.stringify(next),{mode:0o600});
  renameSync(join(dir,'rp.json')+'.tmp',join(dir,'rp.json'));
  return next;
}
export function mountRp(ctx,home){
  const {skills,themes}=rpRoots();
  const characters=listCharacters(skills),availableThemes=listThemes(themes);
  ctx.inject(['systemPrompt'],(scope)=>{
    scope.effect(()=>scope.systemPrompt.section({
      name:'aemeath:rp-persona',
      order:scope.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX'),
      text:()=>{
        const selection=resolveSelection(readRp(home),characters);
        return selection?buildCard(selection,skills):'';
      },
    }),'aemeath: role-play persona');
    scope.effect(()=>scope.systemPrompt.section({
      name:'aemeath:rp-reinforce',
      order:scope.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_SUFFIX'),
      text:()=>{
        const selection=resolveSelection(readRp(home),characters);
        return selection?buildReinforce(selection):'';
      },
    }),'aemeath: role-play reinforce');
  });
}
export function apply(ctx){
  const home=process.env.DSH_HOME||join(homedir(),'.dsh');
  const manifest=validateManifest(JSON.parse(readFileSync(new URL('../runtime-manifest.json',import.meta.url),'utf8')));
  const manager=new DesktopManager(home,manifest);
  const entryPreferences=new EntryPreferences(join(home,'aemeath-market'));
  const dir=join(home,'aemeath-market'),file=join(dir,'desktop.json'),request=join(dir,'refresh');
  const state=new PetState(),instance=randomUUID(),token=randomUUID();
  let disposed=false,busy=false,lastBalance=0,lastRequest=0,epoch=0,updated=0;
  let balance={status:'loading',wallets:[],bonus:[]};
  function flush(connected=true){
    if(disposed&&connected)return;
    try{
      mkdirSync(dir,{recursive:true});
      writeFileSync(file+'.tmp',JSON.stringify({schema:1,backend:'deepseek-harness',instance,connected,updated_at:Date.now()/1000,...state.snapshot(),balance:{...balance,updated_at:updated}}),{mode:0o600});
      renameSync(file+'.tmp',file);
    }catch{}
  }
  async function refresh(){
    if(disposed||busy)return;busy=true;lastBalance=Date.now();const started=epoch;
    try{
      const result=await ctx.deepseekAccount.getBalance({version:'0.2.1-rc.5',locale:'zh-CN',timezoneOffsetSeconds:-new Date().getTimezoneOffset()*60});
      if(!disposed&&started===epoch){balance=safeBalance(result);updated=Date.now()/1000;}
    }catch{if(!disposed&&started===epoch){balance={status:'unavailable',wallets:[],bonus:[]};updated=Date.now()/1000;}}
    finally{busy=false;flush();}
  }
  ctx.on('session/event',(session,event)=>{try{state.accept(session,event);flush();}catch{}});
  ctx.on('deepseek-account/signed-out',()=>{epoch++;balance={status:'signed-out',wallets:[],bonus:[]};updated=Date.now()/1000;flush();});
  mountRp(ctx,home);
  ctx.effect(()=>{
    const unregister=ctx.webServer.register({kind:'prefix',path:PREFIX,handler:createHandler(manager,ctx.connection,token,readFileSync(new URL('../icon.png',import.meta.url)),entryPreferences,home)});
    flush();void refresh();void manager.autoStart().catch(()=>{});
    const timer=setInterval(()=>{
      let requested=0;try{requested=statSync(request).mtimeMs;}catch{}
      if(Date.now()-lastBalance>120000||(requested>lastRequest&&Date.now()-lastBalance>5000)){lastRequest=requested;void refresh();}
      flush();
    },500);timer.unref();
    return()=>{disposed=true;clearInterval(timer);unregister?.();flush(false);void manager.dispose();};
  },'aemeath: full desktop connection and launcher');
}
