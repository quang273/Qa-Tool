function copyText(t){navigator.clipboard&&navigator.clipboard.writeText(String(t||''));toast('Đã copy')}function copyValue(btn){const inp=btn.parentElement.querySelector('input');copyText(inp.value)}function toast(t){const d=document.createElement('div');d.className='toast';d.textContent=t;document.body.appendChild(d);setTimeout(()=>d.remove(),1700)}
async function pasteToInput(id){
  const el=document.getElementById(id);
  if(!el){toast('Không thấy ô nhập');return;}
  try{
    let text='';
    if(navigator.clipboard && navigator.clipboard.readText){
      text=await navigator.clipboard.readText();
    }else{
      toast('Trình duyệt không hỗ trợ nút dán');return;
    }
    el.value=text||'';
    el.dispatchEvent(new Event('input',{bubbles:true}));
    el.focus();
    toast('Đã dán');
  }catch(e){
    toast('Không đọc được clipboard, hãy cho phép quyền dán');
  }
}

async function postJson(url,data){const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});return r.json()}
function systemRemain(){return 30-(Math.floor(Date.now()/1000)%30)}
let lastOtpSlot=-1;
async function refreshSecretOtp(secret, codeEl, remainEl){try{const r=await fetch('/api/otp?secret='+encodeURIComponent(secret));const d=await r.json();if(codeEl)codeEl.textContent=d.otp||codeEl.textContent;if(remainEl)remainEl.textContent=systemRemain()+'s'}catch{}}
function tickOtpCountdown(){
  const rem=systemRemain();
  document.querySelectorAll('.otp-remain').forEach(x=>x.textContent=rem+'s');
  const liveRemain=document.getElementById('liveRemain'); if(liveRemain) liveRemain.textContent=rem+'s';
  const slot=Math.floor(Date.now()/30000);
  if(slot!==lastOtpSlot || rem===30){
    lastOtpSlot=slot;
    document.querySelectorAll('.otpcode[data-secret]').forEach(el=>refreshSecretOtp(el.dataset.secret,el,el.parentElement.querySelector('.otp-remain')));
    updateOtp();
  }
}
document.addEventListener('click',async e=>{if(e.target&&e.target.id==='getCodeBtn'){const raw=document.getElementById('accountRaw')?.value||'';const box=document.getElementById('codeResult');box.innerHTML='<div class="card"><b>Đang lấy code...</b></div>';const d=await postJson('/Home/GetCode',{raw});if(d.status){box.innerHTML='<section class="card"><h2>✅ Kết quả Get Code</h2><div class="field"><label>Code</label><div class="copy-row"><input readonly value="'+(d.code||'')+'"><button onclick="copyValue(this)">📋</button></div></div><div class="field"><label>Content</label><div class="copy-row"><input readonly value="'+(d.content||'')+'"><button onclick="copyValue(this)">📋</button></div></div></section>'}else{box.innerHTML='<section class="card"><h2>⚠️ Chưa lấy được code</h2><p>'+ (d.message||'Không có code mới') +'</p>'+ (d.openUrl?'<a class="btn primary wide" target="_blank" href="'+d.openUrl+'">Mở email để lấy mã</a>':'') +'</section>'}}});
async function updateOtp(){const inp=document.getElementById('liveSecret');if(!inp)return;const s=inp.value.trim();if(!s){document.getElementById('liveOtp').textContent='------';return}try{const r=await fetch('/api/otp?secret='+encodeURIComponent(s));const d=await r.json();document.getElementById('liveOtp').textContent=d.otp||'------';document.getElementById('liveRemain').textContent=systemRemain()+'s'}catch{}}

function isLikely2faSecret(v){
  const s=String(v||'').replace(/\s+/g,'').trim().toUpperCase();
  return /^[A-Z2-7]{16,}$/.test(s);
}
function splitUser2faRaw(raw){
  raw=String(raw||'').trim();
  if(!raw) return {user:'',secret:''};
  const parts=(raw.includes('|')?raw.split('|'):raw.split(/\s+/)).map(x=>x.trim()).filter(Boolean);
  if(parts.length<2) return {user:parts[0]||'',secret:''};
  const secretIndex=parts.findIndex(isLikely2faSecret);
  if(secretIndex>=0){
    const secret=parts[secretIndex].replace(/\s+/g,'').toUpperCase();
    const userPart=parts.find((x,i)=>i!==secretIndex && !isLikely2faSecret(x)) || '';
    return {user:userPart,secret};
  }
  // Không nhận ra secret thì giữ cách cũ: phần 1 là user, phần 2 là secret.
  return {user:parts[0]||'',secret:parts[1]||''};
}
function parseUser2faInput(){
  const combined=document.getElementById('u2faCombined');
  const user=document.getElementById('u2faUser');
  const secret=document.getElementById('u2faSecret');
  if(!combined||!user||!secret)return;
  const raw=combined.value.trim();
  if(!raw)return;
  const parsed=splitUser2faRaw(raw);
  if(parsed.user) user.value=parsed.user;
  if(parsed.secret) secret.value=parsed.secret;
  updateUser2faOtp();
}
async function updateUser2faOtp(){
  const sec=document.getElementById('u2faSecret')?.value.trim()||'';
  const box=document.getElementById('u2faLiveOtp');
  if(!box)return;
  if(!sec){ box.textContent='------'; return; }
  try{ const r=await fetch('/api/otp?secret='+encodeURIComponent(sec)); const d=await r.json(); box.textContent=d.otp||'------'; }catch{ box.textContent='------'; }
}
document.addEventListener('input',e=>{ if(e.target&&e.target.id==='u2faCombined') parseUser2faInput(); if(e.target&&e.target.id==='u2faSecret') updateUser2faOtp(); });

setInterval(()=>{tickOtpCountdown(); updateUser2faOtp();},500);tickOtpCountdown();

async function sendNameToTool(name, mode){
  const box=document.getElementById('toolSendResult');
  if(box) box.innerHTML='<div class="notice">Đang gửi sang iPhone Tool...</div>';
  try{
    const d=await postJson('/IphoneTool/SendName',{name,mode:mode||'user'});
    if(box) box.innerHTML='<div class="notice '+(d.status?'ok':'warn')+'">'+(d.message||'Đã gửi')+'</div>';
    toast(d.status?'Đã gửi sang Tool':'Đã lưu hàng chờ');
  }catch(e){
    if(box) box.innerHTML='<div class="notice warn">Không gửi được: '+e.message+'</div>';
  }
}
document.addEventListener('click', async e=>{

  const clearId=e.target && e.target.getAttribute && e.target.getAttribute('data-clear-input');
  if(clearId){ const el=document.getElementById(clearId); if(el){ el.value=''; el.dispatchEvent(new Event('input',{bubbles:true})); } }
  const copyId=e.target && e.target.getAttribute && e.target.getAttribute('data-copy-input');
  if(copyId){ const el=document.getElementById(copyId); if(el){ copyText(el.value); } }
  const pasteId=e.target && e.target.getAttribute && e.target.getAttribute('data-paste-input');
  if(pasteId){ await pasteToInput(pasteId); }
  const copyVal=e.target && e.target.getAttribute && e.target.getAttribute('data-copy');
  if(copyVal!==null && copyVal!==undefined){ copyText(copyVal); }
  const copySimId=e.target && e.target.getAttribute && e.target.getAttribute('data-copy-sim-id');
  if(copySimId){ const el=document.querySelector('.sim-code[data-id="'+CSS.escape(copySimId)+'"]'); copyText(el?el.textContent:''); }
  const direct=e.target && e.target.getAttribute && e.target.getAttribute('data-send-tool');
  if(direct){ await sendNameToTool(direct,'user'); }
  if(e.target && e.target.id==='sendSelectedUserBtn'){
    const sel=document.getElementById('sendUserSelect');
    if(sel) await sendNameToTool(sel.value,'selected');
  }
  if(e.target && e.target.id==='sendUser2faNow'){
    const u=document.getElementById('u2faUser')?.value.trim()||'';
    const sec=document.getElementById('u2faSecret')?.value.trim()||'';
    if(!u||!sec){toast('Thiếu user hoặc secret 2FA');return;}
    await sendNameToTool(u+'|'+sec,'user2fa');
  }
  if(e.target && e.target.id==='sendUserOnlyNow'){
    const u=document.getElementById('u2faUser')?.value.trim()||'';
    if(!u){toast('Thiếu user');return;}
    await sendNameToTool(u,'user');
  }

});

async function pollSim(){
  const items=[...document.querySelectorAll('.sim-status[data-id]')];
  for(const el of items){
    try{
      const id=el.dataset.id;
      const r=await fetch('/api/sim/status/'+encodeURIComponent(id));
      const d=await r.json();
      if(!d.status){el.textContent=d.message||'Lỗi kiểm tra OTP'; continue;}
      const codeEl=document.querySelector('.sim-code[data-id="'+CSS.escape(id)+'"]');
      if(d.code){
        if(codeEl) codeEl.textContent=d.code;
        el.textContent='Đã nhận OTP';
        el.classList.add('ok');
        if(!el.dataset.doneToast){ toast('Đã nhận OTP SIM: '+d.code); el.dataset.doneToast='1'; }
      }else if(d.status==='wait'){
        if(codeEl && codeEl.textContent==='') codeEl.textContent='------';
        el.textContent='Đang chờ SMS...';
      }else{
        el.textContent=d.raw||'Đang kiểm tra...';
      }
    }catch(e){el.textContent='Lỗi: '+e.message;}
  }
}
setInterval(pollSim,5000);pollSim();


document.addEventListener('submit', e=>{
  if(e.target && e.target.id==='simGetForm'){
    const btn=document.getElementById('simGetBtn');
    const box=document.getElementById('simGetLoading');
    if(btn){btn.disabled=true;btn.textContent='⏳ Đang lấy số...';}
    if(box) box.style.display='block';
  }
});


function normalizeSearchText(s){return String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim();}
function filterCountryOptions(){
  const inp=document.getElementById('countrySearch');
  const sel=document.getElementById('countrySelect');
  if(!inp||!sel)return;
  const qRaw=inp.value.trim();
  const q=normalizeSearchText(qRaw).replace(/^\+/,'');
  const numeric=/^\d+$/.test(q);
  let firstVisible=null;
  [...sel.options].forEach(opt=>{
    const hay=normalizeSearchText(opt.dataset.search||opt.textContent||'');
    let show=true;
    if(q){
      if(numeric){
        const dialParts=(opt.dataset.search||'').match(/\+?\d+/g)||[];
        show=dialParts.some(x=>x.replace(/\D/g,'')===q || x.replace(/\D/g,'').startsWith(q));
      }else{
        show=hay.includes(q);
      }
    }
    opt.hidden=!show; opt.disabled=!show;
    if(show && !firstVisible) firstVisible=opt;
  });
  if(firstVisible && sel.selectedOptions[0] && sel.selectedOptions[0].disabled){ sel.value=firstVisible.value; }
}
document.addEventListener('input',e=>{ if(e.target&&e.target.id==='countrySearch') filterCountryOptions(); });
document.addEventListener('DOMContentLoaded',filterCountryOptions);


document.addEventListener('DOMContentLoaded',()=>{
  const el=document.getElementById('siteDomain');
  if(el){
    const h=(location.hostname||'').replace(/^www\./,'');
    el.textContent=h || 'Localhost';
  }
});
