/* Original canvas pet, independent from the yard and its coin economy. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const modal = $('petModal'), canvas = $('petScene'), ctx = canvas.getContext('2d');
  const KEY = 'catyard-pet-v1', W = 640, H = 390, FLOOR = 322;
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const fresh = () => ({born:Date.now(),lastSeen:Date.now(),bond:62,energy:78,food:68,weight:100,scene:'room',x:320});
  let pet = fresh();
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (raw && typeof raw === 'object') {
      for (const k of ['bond','energy','food']) if (Number.isFinite(raw[k])) pet[k] = clamp(raw[k],0,100);
      if (Number.isFinite(raw.born)) pet.born = clamp(raw.born,0,Date.now());
      if (Number.isFinite(raw.weight)) pet.weight = clamp(raw.weight,100,5000);
      if (Number.isFinite(raw.x)) pet.x = clamp(raw.x,86,W-100);
      if (['room','garden','rain'].includes(raw.scene)) pet.scene = raw.scene;
      const hours = Number.isFinite(raw.lastSeen) ? clamp((Date.now()-raw.lastSeen)/3600000,0,8) : 0;
      pet.food = Math.max(15,pet.food-hours*3);
      pet.energy = Math.min(100,pet.energy+hours*3);
    }
  } catch { /* A blocked or damaged save must not prevent playing. */ }

  let opened=false, raf=0, last=0, clock=0, uiTime=0, savedTime=0, pointer=null;
  let x=pet.x, y=FLOOR, vy=0, target=null, mode='idle', until=0, squash=0, face=1;
  let particles=[], toy=null, returnFocus=null, muted=false, audioContext=null;
  const sceneNames={room:'晴天小屋',garden:'花园午后',rain:'雨天窗边'};
  const moods={idle:'安心',pet:'开心',held:'被抱起',fall:'落地中',land:'站稳啦',eat:'吃饭中',play:'追球中',sleep:'睡梦中',walk:'散步中'};

  function save() {
    pet.x=x; pet.lastSeen=Date.now();
    try { localStorage.setItem(KEY,JSON.stringify(pet)); }
    catch { $('petMessage').textContent='浏览器暂时不能保存进度，本次仍可继续玩。'; }
  }
  function message(text) { $('petMessage').textContent=text; }
  function chime() {
    if(muted)return;
    try {
      audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
      audioContext.resume().catch(()=>{});
      const o=audioContext.createOscillator(), g=audioContext.createGain();
      o.type='sine';o.frequency.setValueAtTime(640,audioContext.currentTime);
      o.frequency.exponentialRampToValueAtTime(890,audioContext.currentTime+.12);
      g.gain.setValueAtTime(.025,audioContext.currentTime);
      g.gain.exponentialRampToValueAtTime(.001,audioContext.currentTime+.18);
      o.connect(g);g.connect(audioContext.destination);o.start();o.stop(audioContext.currentTime+.19);
    } catch {}
  }
  function renderUI() {
    for(const [id,key] of [['Bond','bond'],['Energy','energy'],['Food','food']]) {
      const value=Math.round(pet[key]);
      $('pet'+id+'Text').textContent=value+'%'; $('pet'+id+'Bar').style.width=value+'%';
    }
    const days=Math.max(1,Math.floor((Date.now()-pet.born)/86400000)+1);
    $('petAge').textContent=days;$('petAgeStat').textContent=days+' 天';
    $('petWeight').textContent=Math.round(pet.weight)+'g';$('petMood').textContent=moods[mode]||'安心';
    $('petBattery').textContent=Math.round(pet.energy)+'%';
    $('petBattery').parentElement.setAttribute('aria-label','猫咪精力 '+Math.round(pet.energy)+'%');
    $('petHearts').textContent='♥'.repeat(Math.max(1,Math.ceil(pet.bond/34)));
    $('petDate').textContent=new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false});
    $('petSceneName').textContent=sceneNames[pet.scene];
    document.querySelectorAll('[data-pet-scene]').forEach(b=>{
      const active=b.dataset.petScene===pet.scene;
      b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));
    });
    const sleep=document.querySelector('[data-pet-action="sleep"]');
    sleep.querySelector('small').textContent=mode==='sleep'?'叫醒':'休息';
    sleep.setAttribute('aria-pressed',String(mode==='sleep'));
    canvas.dataset.action=mode;
  }
  function react(next,seconds,text) { mode=next;until=clock+seconds;if(text)message(text);renderUI(); }
  function hearts() {
    for(let i=0;i<5;i++)particles.push({x:x+(Math.random()-.5)*120,y:y-110-Math.random()*70,life:1.5+i*.1});
  }
  function action(type) {
    const refuse = text => { message(text); return {ok:false,text}; };
    if(pointer||y<FLOOR-1||mode==='fall')return refuse('喵，先轻轻把我放稳，再陪我互动吧。');
    if(mode==='eat')return refuse('啊呜，我正在吃饭，等我吃完这一口再来吧。');
    if(mode==='play')return refuse('我正在追毛线球，等我玩完这一轮再来吧！');
    if(type==='wake'&&mode!=='sleep')return refuse('喵，我已经醒着啦，正在等你陪我。');
    if(type==='sleep'&&mode==='sleep')return refuse('呼噜……我已经睡着啦，让我再休息一会儿。');
    if(type==='feed') {
      if(pet.food>92)return refuse('小肚子已经饱饱的啦，过一会儿再喂吧。');
      pet.food=clamp(pet.food+20,0,100);pet.weight+=2;pet.bond=clamp(pet.bond+1,0,100);
      react('eat',3,'啊呜啊呜……香香的猫粮！');
    } else if(type==='toy') {
      if(pet.energy<12)return refuse('有一点困了，先让我休息一下吧。');
      pet.energy-=8;pet.food=Math.max(0,pet.food-2);pet.bond=clamp(pet.bond+2,0,100);
      toy={x:x>W/2?120:W-120,y:FLOOR-6};target=toy.x;
      react('play',5,'毛线球滚到哪里，我就追到哪里！');
    } else if(type==='sleep') {
      react('sleep',Infinity,'呼噜呼噜……休息时会慢慢恢复精力。');
    } else if(type==='wake') {
      react('idle',0,'伸个懒腰，我醒来啦，睡得好舒服～');
    } else {
      // Holding a finger still does not repeatedly award affection.
      if(mode!=='pet')pet.bond=clamp(pet.bond+1,0,100);
      hearts();react('pet',1.6,'眯起眼睛蹭蹭你，最喜欢摸摸头了 ♥');chime();
    }
    if(type!=='toy'){target=null;toy=null;}
    const text=$('petMessage').textContent;
    renderUI();save();draw();
    return {ok:true,text};
  }

  // Local phrases, not an AI service. Only the existing action() mutates pet stats.
  const CHAT_KEY='catyard-pet-chat-v1', chatLog=$('petChatLog'), chatInput=$('petChatInput');
  let chat=[], composing=false, compositionEnded=-Infinity;
  try {
    const raw=JSON.parse(localStorage.getItem(CHAT_KEY)||'[]');
    if(Array.isArray(raw))chat=raw.filter(m=>m&&['user','cat'].includes(m.role)&&typeof m.text==='string')
      .slice(-30).map(m=>({role:m.role,text:Array.from(m.text).slice(0,200).join('')}));
  } catch {}
  function renderChat() {
    chatLog.replaceChildren();
    if(!chat.length){
      const welcome=document.createElement('p');welcome.className='pet-chat-empty';
      welcome.textContent='喵，我是奶糖！试着说“摸摸你”或问我“现在状态怎么样”。';chatLog.append(welcome);
    }
    for(const m of chat){
      const row=document.createElement('p'),name=document.createElement('b'),body=document.createElement('span');
      row.className='pet-chat-bubble '+m.role;name.textContent=m.role==='cat'?'奶糖':'你';body.textContent=m.text;
      row.append(name,body);chatLog.append(row);
    }
    chatLog.scrollTop=chatLog.scrollHeight;
  }
  function saveChat() {
    try{localStorage.setItem(CHAT_KEY,JSON.stringify(chat));$('petChatNotice').textContent='仅保留最近 30 条消息，可随时清空。';}
    catch{$('petChatNotice').textContent='浏览器无法保存聊天，本次仍可对话；旧记录可能无法清除。';}
  }
  function reply(text) {
    if(/状态|怎么样|在干嘛|在做什么|在干什么|饿不饿|饿了吗|饱了吗|饱了没|吃饱|困不困|困了吗|心情|精力|亲密|饱腹|体重|年龄|几岁|多大|睡着了吗/.test(text))
      return `喵，我现在${moods[mode]||'安心'}，饱腹 ${Math.round(pet.food)}%，精力 ${Math.round(pet.energy)}%，亲密度 ${Math.round(pet.bond)}%。${pet.food<30?'小肚子有点饿了。':pet.energy<12?'想休息一下。':'谢谢你陪着我！'}`;
    if(/不|没|别|勿|禁止|停止|取消|莫要/.test(text))
      return '好哒，这句话我不执行动作，继续保持现在的状态，喵。';
    const intents=[['pet',/摸摸|摸头|摸你|摸小猫|抚摸|挠挠|蹭蹭/],['feed',/喂食|喂你|喂猫|猫粮|吃饭|开饭|吃点|吃东西|投喂/],
      ['toy',/一起玩|陪玩|陪你玩|陪我玩|玩一会|玩一下|毛线球|逗猫|玩耍/],['sleep',/睡觉|睡吧|休息|晚安|睡一会/],['wake',/叫醒|起床|醒醒|醒来/]];
    const matches=intents.map(([type,pattern])=>({type,index:text.search(pattern)})).filter(m=>m.index>=0).sort((a,b)=>a.index-b.index);
    if(matches.length){
      const result=action(matches[0].type);
      return result.text+(matches.length>1?' 一次只做一件事哦，其他动作可以下一句再告诉我。':'');
    }
    if(/你好|您好|嗨|哈[喽啰]|早安|早上好|晚上好|hello|\bhi\b/i.test(text))return `喵～你好！我是奶糖，现在${moods[mode]||'安心'}。${pet.energy<12?'有点困啦，可以让我休息。':pet.food<30?'肚子有点饿，可以喂我吗？':'很高兴你来陪我。'}`;
    if(/谢谢|喜欢你|爱你|可爱|乖/.test(text))return '喵～收到你的喜欢啦！想互动可以说“摸摸你”。';
    if(/再见|拜拜/.test(text))return '拜拜，我在小屋等你回来，记得来陪奶糖哦～';
    return '喵，这句我还听不懂。我会回应简单说法：摸摸你、吃饭啦、一起玩、睡觉吧、叫醒、查看状态。';
  }
  function sendChat(value) {
    const text=String(value).trim();if(!text)return false;
    if(Array.from(text).length>200){$('petChatNotice').textContent='每条最多 200 字，请缩短后发送。';return false;}
    chat.push({role:'user',text},{role:'cat',text:reply(text)});chat=chat.slice(-30);
    renderChat();saveChat();return true;
  }
  chatInput.addEventListener('compositionstart',()=>{composing=true;});
  chatInput.addEventListener('compositionend',()=>{composing=false;compositionEnded=performance.now();});
  chatInput.addEventListener('keydown',e=>{
    if(e.key!=='Enter')return;
    if(e.isComposing||composing||e.keyCode===229)return;
    e.preventDefault();if(performance.now()-compositionEnded<80)return;
    $('petChatForm').requestSubmit();
  });
  $('petChatForm').addEventListener('submit',e=>{
    e.preventDefault();if(composing||performance.now()-compositionEnded<80)return;
    if(sendChat(chatInput.value))chatInput.value='';
  });
  $('petChatQuick').addEventListener('click',e=>{
    const b=e.target.closest('[data-chat]');if(b)sendChat(b.dataset.chat);
  });
  $('petChatClear').addEventListener('click',()=>{chat=[];renderChat();saveChat();});
  renderChat();

  function fitPetViewport() {
    if(!opened)return;
    const viewport=window.visualViewport;
    modal.style.setProperty('--pet-visible-height',(viewport?.height||window.innerHeight)+'px');
    modal.style.setProperty('--pet-visible-top',(viewport?.offsetTop||0)+'px');
    if(document.activeElement===chatInput)$('petChatForm').scrollIntoView({block:'nearest'});
  }
  window.visualViewport?.addEventListener('resize',fitPetViewport);
  window.visualViewport?.addEventListener('scroll',fitPetViewport);
  window.addEventListener('resize',fitPetViewport);
  chatInput.addEventListener('focus',fitPetViewport);

  const rect=(a,b,w,h,c)=>{ctx.fillStyle=c;ctx.fillRect(Math.round(a),Math.round(b),w,h);};
  function shape(points,color) {
    ctx.fillStyle=color;ctx.beginPath();points.forEach(([a,b],i)=>i?ctx.lineTo(a,b):ctx.moveTo(a,b));ctx.closePath();ctx.fill();
  }
  function heart(a,b,s=1,color='#efb7c6') {
    ctx.save();ctx.translate(Math.round(a),Math.round(b));ctx.scale(s,s);
    shape([[0,2],[2,2],[2,0],[5,0],[5,2],[7,2],[7,0],[10,0],[10,2],[12,2],[12,6],[10,6],[10,8],[8,8],[8,10],[6,10],[6,12],[4,12],[4,10],[2,10],[2,8],[0,8]],color);ctx.restore();
  }
  function flower(a,b,color) {
    rect(a,b,4,40,'#aac69d');rect(a-9,b+15,10,4,'#aac69d');rect(a+4,b+24,9,4,'#aac69d');
    rect(a-8,b-7,20,10,color);rect(a-3,b-12,10,20,color);rect(a-1,b-5,6,6,'#fff1b5');
  }
  function background() {
    rect(0,0,W,H,pet.scene==='rain'?'#f2f8fc':'#fffefb');
    if(pet.scene==='garden') {
      rect(0,272,W,118,'#eef5e8');rect(0,272,W,4,'#d9e6ce');
      rect(476,42,40,40,'#fff0bf');rect(466,51,60,22,'#fff0bf');
      [[24,225],[90,266],[542,242],[592,281]].forEach(([a,b],i)=>flower(a,b,i%2?'#efc0cb':'#f1d187'));
      for(let a=0;a<W;a+=48){rect(a,240,8,35,'#e0d9cc');rect(a,250,48,5,'#e0d9cc');}
    } else {
      rect(0,286,W,104,pet.scene==='rain'?'#e7eff6':'#faf2e7');
      rect(0,286,W,4,pet.scene==='rain'?'#d4e2ec':'#eadfce');
      rect(66,45,106,90,'#ead7ae');rect(71,50,96,80,'#fffdf5');
      rect(81,60,76,60,pet.scene==='rain'?'#dcecf6':'#deedf0');
      rect(116,60,5,60,'#fffdf5');rect(81,88,76,5,'#fffdf5');
      if(pet.scene==='rain')for(let i=0;i<13;i++){const ry=60+(clock*36+i*17)%58;rect(84+i*5,ry,2,7,'#98bdd1');}
      rect(222,51,44,44,'#efdcac');rect(227,56,34,34,'#fffef5');
      rect(242,64,4,13,'#b5b4a8');rect(242,74,10,4,'#b5b4a8');
      rect(538,278,34,46,'#bdb8ab');rect(543,282,24,36,'#fffdf2');
      flower(546,239,pet.scene==='rain'?'#bccfe0':'#f3d58b');flower(560,231,'#f1d791');
      if(pet.scene==='rain') {
        rect(390,45,98,28,'#d8e8f3');rect(400,35,34,40,'#d8e8f3');rect(437,29,35,44,'#d8e8f3');
        rect(421,53,4,4,'#96b4c7');rect(450,53,4,4,'#96b4c7');
        for(let i=0;i<5;i++)rect(400+i*19,85+(clock*26+i*9)%50,3,9,'#bdd6e7');
      } else {heart(434,123,1.8);heart(473,153,.9,'#f6d1d9');}
    }
    // Pixel rug and contact shadow stay on the floor when the cat is lifted.
    rect(x-105,FLOOR-8,210,28,'#f6e9cf');rect(x-86,FLOOR-16,172,44,'#f6e9cf');
    rect(x-60,FLOOR-5,120,13,'#dfdace');
  }
  function drawCat() {
    const held=mode==='held', sleeping=mode==='sleep', playing=mode==='play';
    const happy=mode==='pet'||mode==='land', eating=mode==='eat';
    let bob=sleeping?Math.sin(clock*2)*2:playing?Math.abs(Math.sin(clock*10))*9:Math.sin(clock*2.5)*2;
    if(eating)bob=Math.sin(clock*9)*3;
    ctx.save();ctx.translate(Math.round(x),Math.round(y-bob));
    ctx.scale(1+squash*.22,1-squash*.2);
    if(sleeping)ctx.scale(1.12,.68);
    if(held)ctx.rotate(Math.sin(clock*7)*.07);
    // Block-stepped silhouette, cream ears and a wagging tail; drawn from code.
    const tail=Math.round(Math.sin(clock*(happy?12:4))*5);
    rect(55,-43+tail,28,17,'#55534f');rect(76,-60+tail,12,23,'#55534f');
    rect(59,-39+tail,21,9,'#e6ded1');rect(80,-55+tail,4,14,'#e6ded1');
    shape([[-52,-62],[-52,-18],[-44,-18],[-44,-4],[-21,-4],[-21,0],[-4,0],[-4,-5],[14,-5],[14,0],[34,0],[34,-5],[53,-5],[53,-19],[61,-19],[61,-63]],'#55534f');
    shape([[-47,-65],[-47,-21],[-39,-21],[-39,-9],[-25,-9],[-25,-14],[-17,-14],[-17,-5],[-9,-5],[-9,-10],[19,-10],[19,-5],[29,-5],[29,-10],[48,-10],[48,-24],[56,-24],[56,-65]],'#fffef9');
    shape([[-76,-72],[-76,-109],[-68,-109],[-68,-127],[-60,-127],[-60,-147],[-52,-147],[-52,-158],[-42,-158],[-42,-151],[-20,-151],[-20,-143],[24,-143],[24,-151],[45,-151],[45,-158],[54,-158],[54,-147],[62,-147],[62,-127],[70,-127],[70,-110],[78,-110],[78,-72],[70,-72],[70,-61],[54,-61],[54,-54],[-52,-54],[-52,-61],[-68,-61],[-68,-72]],'#55534f');
    shape([[-70,-75],[-70,-106],[-62,-106],[-62,-124],[-54,-124],[-54,-144],[-48,-144],[-48,-150],[-44,-150],[-44,-145],[-22,-145],[-22,-137],[27,-137],[27,-145],[48,-145],[48,-150],[50,-150],[50,-142],[56,-142],[56,-123],[64,-123],[64,-105],[72,-105],[72,-75],[64,-75],[64,-67],[50,-67],[50,-60],[-49,-60],[-49,-67],[-62,-67],[-62,-75]],'#fffef9');
    rect(-54,-140,24,13,'#e8e3da');rect(-60,-125,22,12,'#eee9e0');rect(-49,-138,8,9,'#fffef9');
    rect(31,-139,24,15,'#fae9bd');rect(40,-124,23,9,'#faedcf');rect(40,-137,9,9,'#fffef9');
    const blink=clock%4.4<.15||happy||sleeping||eating;
    const eyeY=held?-102:-97;
    if(blink){rect(-33,eyeY+5,15,4,'#6f9fb0');rect(20,eyeY+5,15,4,'#6f9fb0');}
    else{rect(-31+face,eyeY,8,11,'#68accb');rect(22+face,eyeY,8,11,'#68accb');rect(-30+face,eyeY,3,3,'#d9f3fa');rect(23+face,eyeY,3,3,'#d9f3fa');}
    rect(-48,-84,18,12,happy?'#f3b8c5':'#fae2e4');rect(34,-84,18,12,happy?'#f3b8c5':'#fae2e4');
    rect(-3,-86,7,5,'#ecaaa8');
    if(eating||held)rect(-2,-74,6,7,'#b17e81');
    else{rect(-6,-77,6,3,'#b6a29b');rect(3,-77,6,3,'#b6a29b');}
    rect(-65,-90,10,3,'#dddcd6');rect(-62,-80,8,3,'#dddcd6');rect(57,-90,10,3,'#dddcd6');rect(57,-80,8,3,'#dddcd6');
    if(held){const leg=Math.round(Math.sin(clock*12)*5);rect(-34,-4+leg,14,16,'#55534f');rect(-30,-4+leg,6,12,'#fffef9');rect(26,-4-leg,14,16,'#55534f');rect(30,-4-leg,6,12,'#fffef9');}
    if(playing){rect(face>0?53:-68,-48,16,14,'#55534f');rect(face>0?54:-65,-45,12,8,'#fffef9');}
    ctx.restore();
    if(sleeping){ctx.fillStyle='#8ea5bc';ctx.font='bold 21px monospace';ctx.fillText('z Z',x+50,y-130-Math.sin(clock)*5);}
    if(eating){rect(x-32,FLOOR-8,64,14,'#b78991');rect(x-36,FLOOR-13,72,7,'#e3b2bb');rect(x-24,FLOOR-16,48,5,'#d7b079');}
  }
  function draw() {
    ctx.imageSmoothingEnabled=false;ctx.clearRect(0,0,W,H);background();drawCat();
    if(toy){rect(toy.x-12,FLOOR-19,24,22,'#b9a0cf');rect(toy.x-8,FLOOR-23,16,30,'#cdb6de');rect(toy.x-12,FLOOR-10,24,3,'#efdcf4');rect(toy.x-2,FLOOR-22,3,28,'#efdcf4');}
    for(const p of particles){ctx.globalAlpha=Math.min(1,p.life);heart(p.x,p.y,1.5);}
    ctx.globalAlpha=1;
  }
  function tick(dt) {
    clock+=dt;uiTime+=dt;savedTime+=dt;squash=Math.max(0,squash-dt*2.5);
    if(!pointer && mode==='fall') {
      vy+=850*dt;y+=vy*dt;
      if(y>=FLOOR){y=FLOOR;vy=0;squash=1;react('land',.55,'稳稳落地！摇摇尾巴，再蹭蹭你。');save();}
    } else if(!pointer && target!==null && (mode==='walk'||mode==='play')) {
      const dx=target-x;face=dx<0?-1:1;x+=Math.sign(dx)*Math.min(Math.abs(dx),dt*(mode==='play'?110:75));
      if(Math.abs(dx)<2){target=null;if(mode==='walk')react('idle',0,'我走过来啦，陪我玩一会儿吧。');}
    }
    if(mode!=='held'&&mode!=='fall'&&mode!=='idle'&&clock>until){mode='idle';toy=null;target=null;renderUI();}
    pet.food=Math.max(0,pet.food-dt*.018);
    pet.energy=clamp(pet.energy+dt*(mode==='sleep'?1.5:-.01),0,100);
    particles.forEach(p=>{p.life-=dt;p.y-=dt*30;});particles=particles.filter(p=>p.life>0);
    if(uiTime>1){uiTime=0;renderUI();}
    if(savedTime>8){savedTime=0;save();}
  }
  function loop(now) {
    if(!opened || document.hidden){raf=0;return;}
    const dt=Math.min(.05,Math.max(0,(now-last)/1000));last=now;tick(dt);draw();raf=requestAnimationFrame(loop);
  }
  function startLoop(){if(opened&&!document.hidden&&!raf){last=performance.now();raf=requestAnimationFrame(loop);}}
  const point=e=>{const r=canvas.getBoundingClientRect();return {x:(e.clientX-r.left)*W/r.width,y:(e.clientY-r.top)*H/r.height};};
  function finishPointer(e,cancelled=false) {
    if(!pointer||e.pointerId!==pointer.id)return;
    const p=pointer;pointer=null;
    if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);
    if(p.dragging){vy=0;react('fall',Infinity,'轻轻放下，猫咪会自己站稳。');}
    else if(!cancelled && p.onCat)action('pet');
    else if(!cancelled){const at=point(e);target=clamp(at.x,86,W-100);react('walk',8,'听到你的呼唤，小猫走过来啦～');}
    save();draw();
  }
  canvas.addEventListener('pointerdown',e=>{
    if(pointer||e.button!==0)return;e.preventDefault();const at=point(e);
    const onCat=Math.abs(at.x-x)<83&&at.y<y+12&&at.y>y-(mode==='sleep'?114:165);
    pointer={id:e.pointerId,start:at,onCat,dx:at.x-x,dy:at.y-y,dragging:false};
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove',e=>{
    if(!pointer||e.pointerId!==pointer.id||!pointer.onCat)return;
    const at=point(e);
    if(!pointer.dragging && Math.hypot(at.x-pointer.start.x,at.y-pointer.start.y)>6){pointer.dragging=true;target=null;toy=null;react('held',Infinity,'被你抱起来啦！小爪子晃呀晃～');}
    if(pointer.dragging){x=clamp(at.x-pointer.dx,86,W-100);y=clamp(at.y-pointer.dy,177,FLOOR);vy=0;draw();}
  });
  canvas.addEventListener('pointerup',e=>finishPointer(e));
  canvas.addEventListener('pointercancel',e=>finishPointer(e,true));
  canvas.addEventListener('lostpointercapture',e=>finishPointer(e,true));
  canvas.addEventListener('contextmenu',e=>e.preventDefault());
  canvas.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();action('pet');}});
  canvas.tabIndex=0;
  document.querySelectorAll('[data-pet-action]').forEach(b=>b.addEventListener('click',()=>action(b.dataset.petAction==='sleep'&&mode==='sleep'?'wake':b.dataset.petAction)));
  $('petScenes').addEventListener('click',e=>{
    const b=e.target.closest('[data-pet-scene]');if(!b)return;
    pet.scene=b.dataset.petScene;renderUI();draw();save();
  });
  function open() {
    if(opened)return;opened=true;returnFocus=document.activeElement;
    modal.classList.add('show');modal.setAttribute('aria-hidden','false');
    document.querySelector('.shell').inert=true;document.body.classList.add('pet-is-open');
    fitPetViewport();renderUI();draw();startLoop();$('petClose').focus();
  }
  function close() {
    if(!opened)return;
    if(pointer)finishPointer({pointerId:pointer.id},true);
    opened=false;cancelAnimationFrame(raf);raf=0;y=FLOOR;mode='idle';toy=null;target=null;
    save();modal.classList.remove('show');modal.setAttribute('aria-hidden','true');
    document.querySelector('.shell').inert=false;document.body.classList.remove('pet-is-open');
    returnFocus?.focus();
  }
  $('petOpen').addEventListener('click',open);$('petClose').addEventListener('click',close);
  modal.addEventListener('keydown',e=>{
    if(e.isComposing||composing||e.keyCode===229)return;
    if(e.key==='Escape'){e.preventDefault();close();}
    if(e.key==='Tab'){
      const nodes=[...modal.querySelectorAll('button,input,textarea,select,[tabindex="0"]')].filter(n=>!n.disabled&&n.getClientRects().length);
      const first=nodes[0],end=nodes[nodes.length-1];
      if(e.shiftKey&&document.activeElement===first){e.preventDefault();end.focus();}
      else if(!e.shiftKey&&document.activeElement===end){e.preventDefault();first.focus();}
    }
  });
  $('petReset').addEventListener('click',()=>{
    pet=fresh();x=pet.x;y=FLOOR;vy=0;target=null;toy=null;mode='idle';
    pet.scene='room';message('养成数据已重置，小猫正在等你重新陪伴。');renderUI();draw();save();
  });
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden){if(pointer)finishPointer({pointerId:pointer.id},true);if(opened)save();cancelAnimationFrame(raf);raf=0;}
    else startLoop();
  });
  window.addEventListener('pagehide',()=>{if(opened)save();});
})();
