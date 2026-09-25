/* A dedicated worker owns all inference. No chat content is sent to a server. */
(() => {
  class PetLocalModel {
    constructor(onState=()=>{}) {
      this.onState=onState;this.worker=null;this.pending=null;this.serial=0;this.state='idle';
    }
    status(state,text,progress=null) { this.state=state;this.onState({state,text,progress}); }
    terminate() {
      this.worker?.terminate();this.worker=null;
      if(this.pending){clearTimeout(this.pending.timer);this.pending.reject(new DOMException('已停止','AbortError'));this.pending=null;}
    }
    cancel(text='已停止并释放运行内存；重新加载时会优先使用缓存。') {
      this.terminate();this.status('idle',text);
    }
    fail(text) { this.terminate();this.status('error',text); }
    startWorker() {
      this.worker=new Worker(new URL('local-model-worker.js?v=local-ai-2',document.baseURI),{type:'module'});
      const worker=this.worker;
      worker.onerror=e=>{
        e.preventDefault();if(this.worker!==worker)return;
        this.fail('模型运行组件无法启动。请刷新重试，或换用支持 WebGPU 的浏览器。');
      };
      worker.onmessage=e=>{
        if(this.worker!==worker)return;
        const msg=e.data,p=this.pending;if(!p||msg.id!==p.id)return;
        this.armTimeout(p);
        if(msg.type==='progress'){
          this.status('loading',msg.text,Number.isFinite(msg.progress)?msg.progress:null);return;
        }
        if(msg.type==='token'){p.onToken?.(msg.text);return;}
        clearTimeout(p.timer);this.pending=null;
        if(msg.type==='error'){
          worker.terminate();this.worker=null;this.status(msg.unsupported?'unsupported':'error',msg.text);
          p.reject(new Error(msg.text));return;
        }
        if(msg.type==='ready'){this.status('ready','本地模型已就绪 · 对话由你的设备生成');p.resolve(msg);}
        else if(msg.type==='done'){this.status('ready','回复已完成 · 生成过程不调用聊天 API');p.resolve(msg.text);}
        else if(msg.type==='cleared'){
          worker.terminate();this.worker=null;this.status('idle','模型缓存已清除，下次需要重新下载。');p.resolve(msg);
        }
      };
    }
    armTimeout(p) {
      clearTimeout(p.timer);
      p.timer=setTimeout(()=>{
        if(this.pending!==p)return;
        this.fail('等待模型超时。请检查网络后重试；内存不足时请关闭其他应用。');
      },p.type==='generate'?120000:180000);
    }
    request(type,payload={},onToken) {
      return new Promise((resolve,reject)=>{
        const p={id:++this.serial,type,resolve,reject,onToken,timer:null};
        this.pending=p;this.armTimeout(p);
        try{this.worker.postMessage({id:p.id,type,...payload});}
        catch(e){clearTimeout(p.timer);this.pending=null;this.fail('本地模型无法启动，请重新加载。');reject(e);}
      });
    }
    async load() {
      if(this.pending||this.state==='ready')return;
      if(!window.isSecureContext||!navigator.gpu){
        this.status('unsupported','此浏览器不支持本地模型所需的 WebGPU。请用支持 WebGPU 的新版浏览器打开 HTTPS 网站；喂食和拖拽仍可使用。');return;
      }
      this.terminate();this.status('loading','正在检查设备并加载模型组件…',0);
      try{this.startWorker();await this.request('load');}
      catch(e){if(e.name!=='AbortError'&&this.state==='loading')this.fail('模型无法加载，请重试。');}
    }
    async generate(messages,onToken) {
      if(this.state!=='ready'||this.pending)throw new Error('请先加载本地模型。');
      this.status('generating','奶糖正在用你的设备思考…');
      return this.request('generate',{messages},onToken);
    }
    async clearCache() {
      this.terminate();this.status('clearing','正在清除本地模型缓存…');
      try{this.startWorker();await this.request('clear');}
      catch(e){if(e.name!=='AbortError'&&this.state==='clearing')this.fail('缓存未能清除，请重试或在浏览器设置里清除本站数据。');}
    }
  }
  window.PetLocalModel=PetLocalModel;
})();
