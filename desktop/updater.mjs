import semver from 'semver';

export const UPDATE_PROVIDER = Object.freeze({provider:'github', owner:'rubegamer12', repo:'unstable-watch', private:false});
export function canUpdate({isPackaged, platform, portable, installed}) {
  return Boolean(isPackaged && platform === 'win32' && !portable && installed);
}
export function isNewStableVersion(current, info) {
  return Boolean(info && !info.draft && !info.prerelease && semver.valid(info.version) && !semver.prerelease(info.version) && semver.valid(current) && semver.gt(info.version,current));
}

export function createUpdater({updater, enabled, version, publish=()=>{}, beforeInstall=async()=>{}, now=Date.now}) {
  let state={status:enabled?'idle':'disabled',version,availableVersion:null,percent:0};
  let checking=null, downloading=false, lastCheck=null, installing=false;
  const timers=[];
  const send = patch => { state={...state,...patch}; publish({...state}); return {...state}; };
  const fail = () => send({status:'error',message:'Update check or download failed. Check your connection and try again.'});
  if (enabled) {
    updater.setFeedURL(UPDATE_PROVIDER);
    updater.logger=null; // Never forward network response/error bodies to the renderer or logs.
    updater.autoDownload=false;
    updater.autoInstallOnAppQuit=false;
    updater.allowPrerelease=false;
    updater.allowDowngrade=false;
    updater.disableWebInstaller=true;
    updater.on('error',fail);
    updater.on('download-progress', p => {
      if (downloading) send({status:'downloading',percent:Math.max(0,Math.min(100,Number(p.percent)||0))});
    });
    updater.on('update-downloaded', info => {
      if (isNewStableVersion(version,info) && info.version===state.availableVersion) send({status:'ready',percent:100,message:null});
      else fail();
      downloading=false;
    });
  }
  async function check() {
    if (!enabled || installing || downloading || state.status==='ready') return {...state};
    if (checking) return checking;
    if (lastCheck !== null && now()-lastCheck < 60_000) return {...state};
    lastCheck=now(); send({status:'checking',message:null});
    checking=(async()=>{
      try {
        const result=await updater.checkForUpdates();
        if (!isNewStableVersion(version,result?.updateInfo)) return send({status:'current',availableVersion:null,percent:0});
        send({status:'available',availableVersion:result.updateInfo.version,percent:0});
        downloading=true;
        send({status:'downloading'});
        await updater.downloadUpdate();
      } catch { downloading=false; fail(); }
      finally { checking=null; }
      return {...state};
    })();
    return checking;
  }
  async function restart() {
    if (!enabled || state.status!=='ready' || installing) return false;
    installing=true;
    try {
      await beforeInstall();
      send({status:'installing'});
      updater.quitAndInstall(false,true);
      return true;
    } catch { installing=false; fail(); return false; }
  }
  return {
    getState:()=>({...state}), check, restart,
    start(){ if(!enabled)return; timers.push(setTimeout(()=>void check(),15_000),setInterval(()=>void check(),6*60*60*1000)); timers.forEach(t=>t.unref?.()); },
    stop(){timers.forEach(clearTimeout);}
  };
}
