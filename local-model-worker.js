// Model artifacts only are fetched. Prompts and generated text stay in this worker.
import {CreateMLCEngine,deleteModelAllInfoInCache} from './vendor/webllm/webllm-0.2.85.js';

const MODEL_ID='Qwen2.5-0.5B-Instruct-q4f32_1-MLC';
let engine=null,busy=false;
function config(){
  return {cacheBackend:'cache',model_list:[{
    model_id:MODEL_ID,model:new URL('./models/qwen2.5-0.5b/',import.meta.url).href,
    model_lib:new URL('./vendor/webllm/qwen-f32.wasm',import.meta.url).href,
    overrides:{context_window_size:2048,prefill_chunk_size:128}
  }]};
}
function send(id,type,fields={}){self.postMessage({id,type,...fields});}
function explain(error){
  const s=String(error?.message||error);
  if(/GPU|adapter|shader|storage.buffer|limit/i.test(s))return '设备的 WebGPU 或显存不满足要求。请关闭其他应用后重试，或换一台设备；原有养成功能仍可使用。';
  if(/memory|alloc|out.of|device.lost/i.test(s))return '设备运行内存不足，模型已停止。请关闭其他应用后重试。';
  if(/quota|cache|storage/i.test(s))return '模型缓存写入失败，请释放浏览器存储空间后重试。';
  return '模型下载或运行失败。请检查网络和设备内存后重试；不会改用云端聊天。';
}
self.onmessage=async({data:msg})=>{
  const {id,type}=msg;if(busy)return;
  busy=true;
  try{
    if(type==='load'){
      if(!navigator.gpu)throw new Error('WebGPU unavailable');
      const adapter=await navigator.gpu.requestAdapter();
      if(!adapter){send(id,'error',{unsupported:true,text:'没有可用的 WebGPU 设备，请换用支持 WebGPU 的浏览器或设备。'});return;}
      const appConfig=config();
      engine=await CreateMLCEngine(MODEL_ID,{
        appConfig,logLevel:'WARN',initProgressCallback:report=>{
          const progress=Math.max(0,Math.min(.99,report.progress||0));
          send(id,'progress',{progress,text:`加载本地模型 ${Math.round(progress*100)}% · 首次下载较慢，请保持页面打开`});
        }
      },{context_window_size:2048,prefill_chunk_size:128});
      send(id,'ready',{model:MODEL_ID});
    }else if(type==='generate'){
      if(!engine)throw new Error('No model loaded');
      if(!Array.isArray(msg.messages)||msg.messages.length>10)throw new Error('Invalid messages');
      const chunks=await engine.chat.completions.create({
        messages:msg.messages,stream:true,max_tokens:160,temperature:.7,top_p:.85,repetition_penalty:1.1
      });
      let text='';
      for await(const chunk of chunks){
        const delta=chunk.choices?.[0]?.delta?.content||'';
        if(delta){text+=delta;send(id,'token',{text});}
      }
      if(!text.trim())throw new Error('Empty response');
      send(id,'done',{text});
    }else if(type==='clear'){
      if(engine)await engine.unload();engine=null;
      await deleteModelAllInfoInCache(MODEL_ID,config());
      send(id,'cleared');
    }
  }catch(e){send(id,'error',{text:explain(e)});}
  finally{busy=false;}
};
