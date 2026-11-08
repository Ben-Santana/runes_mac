import {BrowserWindow} from 'electron';

export type Credentials = {username:string;password:string};
export function metaLogin(url:string, credentials:Credentials|null): {result:Promise<string>; cancel:()=>void} {
  if(new URL(url).origin !== 'https://auth.meta.com')throw new Error('Invalid Meta login address');
  const login = new BrowserWindow({width:640,height:760,show:!credentials,title:'Sign in with Meta',webPreferences:{partition:'runes-meta-login',sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
  let done=false, attempted=false, filledUser=false, polling=false;
  let timer:ReturnType<typeof setTimeout>;
  let poll:ReturnType<typeof setInterval>;
  let rejectResult:(error:Error)=>void;
  const result = new Promise<string>((resolve,reject)=>{
    rejectResult=reject;
    const finish=(callback?:string)=>{
      if(done)return;done=true;clearTimeout(timer);clearInterval(poll);
      if(callback)resolve(callback);else reject(new Error('Meta sign-in cancelled'));
      if(!login.isDestroyed())login.destroy();
    };
    const navigate=(event:Electron.Event,target:string)=>{
      const parsed=new URL(target);
      if(['fb-viewapp:','oculus:'].includes(parsed.protocol)){
        event.preventDefault();
        if(parsed.hostname==='frl_login')finish(target);
        return;
      }
      if(parsed.protocol!=='https:')event.preventDefault();
    };
    login.webContents.on('will-navigate',navigate);
    login.webContents.on('will-redirect',navigate);
    login.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    login.on('closed',()=>finish());
    const reveal=()=>{clearInterval(poll);if(!done&&!login.isDestroyed()){login.show();login.focus();}};
    timer=setTimeout(reveal,12000);
    if(credentials)poll=setInterval(async()=>{
      if(polling||done||login.isDestroyed()||new URL(login.webContents.getURL()||url).origin!=='https://auth.meta.com')return;
      polling=true;
      try{
        const outcome=await login.webContents.executeJavaScript(`(()=>{
          if(location.origin!=='https://auth.meta.com')return 'wait';
          const visible=e=>e.getClientRects().length&&!e.disabled;
          const buttons=[...document.querySelectorAll('button,[role=button],a')].filter(visible);
          const password=document.querySelector('input[type=password]');
          const user=[...document.querySelectorAll('input')].find(e=>visible(e)&&(e.autocomplete==='username'||['email','tel'].includes(e.type)||/email|phone/i.test(e.name+' '+e.placeholder)));
          const set=(e,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,value);e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));};
          const submit=()=>{const b=buttons.find(e=>/^(continue|next|log in|sign in)$/i.test(e.textContent.trim()));if(b)b.click();else return false;return true;};
          if(password&&visible(password)){
            if(${attempted})return 'reveal';
            if(user)set(user,${JSON.stringify(credentials.username)});
            set(password,${JSON.stringify(credentials.password)});return submit()?'attempted':'reveal';
          }
          if(${attempted})return 'wait';
          const option=buttons.find(e=>/^(input password|enter password|use password|use a password|log in with password|sign in with password)$/i.test(e.textContent.trim()));
          if(option){option.click();return 'wait';}
          if(user&&!${filledUser}){set(user,${JSON.stringify(credentials.username)});submit();return 'user';}
          return 'wait';
        })()`);
        if(outcome==='attempted')attempted=true;
        if(outcome==='user')filledUser=true;
        if(outcome==='reveal'){clearInterval(poll);reveal();}
      }catch{clearInterval(poll);reveal();}finally{polling=false;}
    },750);
    void login.loadURL(url).catch(()=>{finish();});
  });
  return {result,cancel:()=>{if(!done){rejectResult(new Error('Meta sign-in cancelled'));login.destroy();}}};
}
