/* V92 Android old compatibility mode: ES5 + clipboard/fetch/polyfill fallbacks. */
(function(w,d){
  w.__QF_COMPAT_V92__=true;
  if(!w.Promise){
    function P(fn){var self=this;self.s='p';self.v=void 0;self.q=[];function resolve(v){settle('f',v)}function reject(v){settle('r',v)}function settle(s,v){if(self.s!=='p')return;if(v&&typeof v.then==='function'){try{return v.then(resolve,reject)}catch(e){return reject(e)}}self.s=s;self.v=v;setTimeout(function(){var q=self.q.slice();self.q.length=0;for(var i=0;i<q.length;i++)handle(q[i]);},0)}function handle(h){try{var cb=self.s==='f'?h.f:h.r;if(!cb){(self.s==='f'?h.res:h.rej)(self.v);return}h.res(cb(self.v));}catch(e){h.rej(e)}}self.then=function(f,r){return new P(function(res,rej){var h={f:f,r:r,res:res,rej:rej}; if(self.s==='p')self.q.push(h); else setTimeout(function(){handle(h)},0);});};self['catch']=function(r){return self.then(null,r)};try{fn(resolve,reject)}catch(e){reject(e)}}
    P.resolve=function(v){return new P(function(res){res(v)})}; P.reject=function(e){return new P(function(_,rej){rej(e)})}; w.Promise=P;
  }
  if(!w.fetch){
    w.fetch=function(url,opts){opts=opts||{};return new Promise(function(resolve,reject){try{var x=new XMLHttpRequest();x.open(opts.method||'GET',url,true);var headers=opts.headers||{};for(var k in headers){if(headers.hasOwnProperty(k))x.setRequestHeader(k,headers[k]);}x.onreadystatechange=function(){if(x.readyState===4){var res={ok:x.status>=200&&x.status<300,status:x.status,statusText:x.statusText,text:function(){return Promise.resolve(x.responseText)},json:function(){try{return Promise.resolve(JSON.parse(x.responseText||'{}'))}catch(e){return Promise.reject(e)}}};resolve(res)}};x.onerror=function(){reject(new Error('fetch failed'))};x.ontimeout=function(){reject(new Error('fetch timeout'))};x.timeout=20000;x.send(opts.body||null)}catch(e){reject(e)}})};
  }
  if(!String.prototype.padStart){String.prototype.padStart=function(len,str){str=str||' ';var s=String(this);while(s.length<len)s=String(str)+s;return s.slice(-len)}}
  if(w.NodeList&&!NodeList.prototype.forEach){NodeList.prototype.forEach=Array.prototype.forEach;}
  if(w.HTMLCollection&&!HTMLCollection.prototype.forEach){HTMLCollection.prototype.forEach=Array.prototype.forEach;}
  if(w.Element&&!Element.prototype.remove){Element.prototype.remove=function(){if(this.parentNode)this.parentNode.removeChild(this)}}
  if(!w.CSS)w.CSS={}; if(!w.CSS.escape){w.CSS.escape=function(s){return String(s).replace(/[^a-zA-Z0-9_-]/g,function(c){return '\\'+c})}}
  try{new w.Event('x')}catch(e){w.Event=function(type,params){params=params||{};var ev=d.createEvent('Event');ev.initEvent(type,!!params.bubbles,!!params.cancelable);return ev;}}
  w.__qfCompatError=function(msg){try{var box=d.getElementById('compatErrorBox');if(!box){box=d.createElement('div');box.id='compatErrorBox';box.style.cssText='position:fixed;left:8px;right:8px;bottom:88px;z-index:9999;background:#fff7e6;color:#7a4a00;border:1px solid #ffd48a;border-radius:12px;padding:10px;font-weight:700;font-size:13px;box-shadow:0 8px 25px rgba(0,0,0,.16)';d.body.appendChild(box)}box.innerHTML='Lỗi JS trên Android cũ: '+String(msg).slice(0,160);}catch(_){}};
  w.onerror=function(msg){w.__qfCompatError(msg);return false};
})(window,document);

var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var __read = (this && this.__read) || function (o, n) {
    var m = typeof Symbol === "function" && o[Symbol.iterator];
    if (!m) return o;
    var i = m.call(o), r, ar = [], e;
    try {
        while ((n === void 0 || n-- > 0) && !(r = i.next()).done) ar.push(r.value);
    }
    catch (error) { e = { error: error }; }
    finally {
        try {
            if (r && !r.done && (m = i["return"])) m.call(i);
        }
        finally { if (e) throw e.error; }
    }
    return ar;
};
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
var __values = (this && this.__values) || function(o) {
    var s = typeof Symbol === "function" && Symbol.iterator, m = s && o[s], i = 0;
    if (m) return m.call(o);
    if (o && typeof o.length === "number") return {
        next: function () {
            if (o && i >= o.length) o = void 0;
            return { value: o && o[i++], done: !o };
        }
    };
    throw new TypeError(s ? "Object is not iterable." : "Symbol.iterator is not defined.");
};
function copyText(t) { navigator.clipboard && navigator.clipboard.writeText(String(t || '')); toast('Đã copy'); }
function copyValue(btn) { var inp = btn.parentElement.querySelector('input'); copyText(inp.value); }
function toast(t) { var d = document.createElement('div'); d.className = 'toast'; d.textContent = t; document.body.appendChild(d); setTimeout(function () { return d.remove(); }, 1700); }
function pasteToInput(id) {
    return __awaiter(this, void 0, void 0, function () {
        var el, text, e_1;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    el = document.getElementById(id);
                    if (!el) {
                        toast('Không thấy ô nhập');
                        return [2 /*return*/];
                    }
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 5, , 6]);
                    text = '';
                    if (!(navigator.clipboard && navigator.clipboard.readText)) return [3 /*break*/, 3];
                    return [4 /*yield*/, navigator.clipboard.readText()];
                case 2:
                    text = _a.sent();
                    return [3 /*break*/, 4];
                case 3:
                    toast('Trình duyệt không hỗ trợ nút dán');
                    return [2 /*return*/];
                case 4:
                    el.value = text || '';
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    el.focus();
                    toast('Đã dán');
                    return [3 /*break*/, 6];
                case 5:
                    e_1 = _a.sent();
                    toast('Không đọc được clipboard, hãy cho phép quyền dán');
                    return [3 /*break*/, 6];
                case 6: return [2 /*return*/];
            }
        });
    });
}
function postJson(url, data) {
    return __awaiter(this, void 0, void 0, function () { var r; return __generator(this, function (_a) {
        switch (_a.label) {
            case 0: return [4 /*yield*/, fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) })];
            case 1:
                r = _a.sent();
                return [2 /*return*/, r.json()];
        }
    }); });
}
// v72: đồng bộ countdown 2FA theo giờ server để nhiều iPhone mở cùng lúc không bị lệch nhau.
var serverTimeOffsetMs = 0;
var lastOtpSlot = -1;
function syncedNow() { return Date.now() + serverTimeOffsetMs; }
function systemRemain() {
    var sec = Math.floor(syncedNow() / 1000);
    var rem = 30 - (sec % 30);
    return rem === 0 ? 30 : rem;
}
function systemSlot() { return Math.floor(syncedNow() / 30000); }
function syncServerTime() {
    return __awaiter(this, void 0, void 0, function () {
        var before, r, d, after, networkMiddle, _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    _b.trys.push([0, 3, , 4]);
                    before = Date.now();
                    return [4 /*yield*/, fetch('/api/time?ts=' + before, { cache: 'no-store' })];
                case 1:
                    r = _b.sent();
                    return [4 /*yield*/, r.json()];
                case 2:
                    d = _b.sent();
                    after = Date.now();
                    if (d && d.now) {
                        networkMiddle = before + Math.round((after - before) / 2);
                        serverTimeOffsetMs = Number(d.now) - networkMiddle;
                    }
                    return [3 /*break*/, 4];
                case 3:
                    _a = _b.sent();
                    return [3 /*break*/, 4];
                case 4: return [2 /*return*/];
            }
        });
    });
}
function refreshSecretOtp(secret, codeEl, remainEl) {
    return __awaiter(this, void 0, void 0, function () { var r, d, _a; return __generator(this, function (_b) {
        switch (_b.label) {
            case 0:
                _b.trys.push([0, 3, , 4]);
                return [4 /*yield*/, fetch('/api/otp?secret=' + encodeURIComponent(secret), { cache: 'no-store' })];
            case 1:
                r = _b.sent();
                return [4 /*yield*/, r.json()];
            case 2:
                d = _b.sent();
                if (d && d.now) {
                    serverTimeOffsetMs = Number(d.now) - Date.now();
                }
                if (codeEl)
                    codeEl.textContent = d.otp || codeEl.textContent;
                if (remainEl)
                    remainEl.textContent = systemRemain() + 's';
                return [3 /*break*/, 4];
            case 3:
                _a = _b.sent();
                return [3 /*break*/, 4];
            case 4: return [2 /*return*/];
        }
    }); });
}
function tickOtpCountdown() {
    var rem = systemRemain();
    document.querySelectorAll('.otp-remain').forEach(function (x) { return x.textContent = rem + 's'; });
    var liveRemain = document.getElementById('liveRemain');
    if (liveRemain)
        liveRemain.textContent = rem + 's';
    var slot = systemSlot();
    if (slot !== lastOtpSlot) {
        lastOtpSlot = slot;
        document.querySelectorAll('.otpcode[data-secret]').forEach(function (el) { return refreshSecretOtp(el.dataset.secret, el, el.parentElement.querySelector('.otp-remain')); });
        updateOtp();
        updateUser2faOtp();
    }
}
document.addEventListener('click', function (e) { return __awaiter(void 0, void 0, void 0, function () { var raw, box, d; var _a; return __generator(this, function (_b) {
    switch (_b.label) {
        case 0:
            if (!(e.target && e.target.id === 'getCodeBtn')) return [3 /*break*/, 2];
            raw = ((_a = document.getElementById('accountRaw')) === null || _a === void 0 ? void 0 : _a.value) || '';
            box = document.getElementById('codeResult');
            box.innerHTML = '<div class="card"><b>Đang lấy code...</b></div>';
            return [4 /*yield*/, postJson('/Home/GetCode', { raw: raw })];
        case 1:
            d = _b.sent();
            if (d.status) {
                box.innerHTML = '<section class="card"><h2>✅ Kết quả Get Code</h2><div class="field"><label>Code</label><div class="copy-row"><input readonly value="' + (d.code || '') + '"><button onclick="copyValue(this)">📋</button></div></div><div class="field"><label>Content</label><div class="copy-row"><input readonly value="' + (d.content || '') + '"><button onclick="copyValue(this)">📋</button></div></div></section>';
            }
            else {
                box.innerHTML = '<section class="card"><h2>⚠️ Chưa lấy được code</h2><p>' + (d.message || 'Không có code mới') + '</p>' + (d.openUrl ? '<a class="btn primary wide" target="_blank" href="' + d.openUrl + '">Mở email để lấy mã</a>' : '') + '</section>';
            }
            _b.label = 2;
        case 2: return [2 /*return*/];
    }
}); }); });
function updateOtp() {
    return __awaiter(this, void 0, void 0, function () { var inp, s, r, d, _a; return __generator(this, function (_b) {
        switch (_b.label) {
            case 0:
                inp = document.getElementById('liveSecret');
                if (!inp)
                    return [2 /*return*/];
                s = inp.value.trim();
                if (!s) {
                    document.getElementById('liveOtp').textContent = '------';
                    return [2 /*return*/];
                }
                _b.label = 1;
            case 1:
                _b.trys.push([1, 4, , 5]);
                return [4 /*yield*/, fetch('/api/otp?secret=' + encodeURIComponent(s), { cache: 'no-store' })];
            case 2:
                r = _b.sent();
                return [4 /*yield*/, r.json()];
            case 3:
                d = _b.sent();
                if (d && d.now) {
                    serverTimeOffsetMs = Number(d.now) - Date.now();
                }
                document.getElementById('liveOtp').textContent = d.otp || '------';
                document.getElementById('liveRemain').textContent = systemRemain() + 's';
                return [3 /*break*/, 5];
            case 4:
                _a = _b.sent();
                return [3 /*break*/, 5];
            case 5: return [2 /*return*/];
        }
    }); });
}
function isLikely2faSecret(v) {
    var s = String(v || '').replace(/\s+/g, '').trim().toUpperCase();
    return /^[A-Z2-7]{16,}$/.test(s);
}
function splitUser2faRaw(raw) {
    raw = String(raw || '').trim();
    if (!raw)
        return { user: '', secret: '' };
    var parts = (raw.includes('|') ? raw.split('|') : raw.split(/\s+/)).map(function (x) { return x.trim(); }).filter(Boolean);
    if (parts.length < 2)
        return { user: parts[0] || '', secret: '' };
    var secretIndex = parts.findIndex(isLikely2faSecret);
    if (secretIndex >= 0) {
        var secret = parts[secretIndex].replace(/\s+/g, '').toUpperCase();
        var userPart = parts.find(function (x, i) { return i !== secretIndex && !isLikely2faSecret(x); }) || '';
        return { user: userPart, secret: secret };
    }
    // Không nhận ra secret thì giữ cách cũ: phần 1 là user, phần 2 là secret.
    return { user: parts[0] || '', secret: parts[1] || '' };
}
function parseUser2faInput() {
    var combined = document.getElementById('u2faCombined');
    var user = document.getElementById('u2faUser');
    var secret = document.getElementById('u2faSecret');
    if (!combined || !user || !secret)
        return;
    var raw = combined.value.trim();
    if (!raw)
        return;
    var parsed = splitUser2faRaw(raw);
    if (parsed.user)
        user.value = parsed.user;
    if (parsed.secret)
        secret.value = parsed.secret;
    updateUser2faOtp();
}
function syncCombinedFromFields() {
    var combined = document.getElementById('u2faCombined');
    var user = document.getElementById('u2faUser');
    var secret = document.getElementById('u2faSecret');
    if (!combined || !user || !secret)
        return;
    var u = user.value.trim();
    var s = secret.value.trim().replace(/\s+/g, '').toUpperCase();
    if (s && secret.value !== s)
        secret.value = s;
    if (u && s)
        combined.value = u + '|' + s;
}
function updateUser2faOtp() {
    return __awaiter(this, void 0, void 0, function () {
        var sec, box, r, d, _a;
        var _b;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    sec = ((_b = document.getElementById('u2faSecret')) === null || _b === void 0 ? void 0 : _b.value.trim()) || '';
                    box = document.getElementById('u2faLiveOtp');
                    if (!box)
                        return [2 /*return*/];
                    if (!sec) {
                        box.textContent = '------';
                        return [2 /*return*/];
                    }
                    _c.label = 1;
                case 1:
                    _c.trys.push([1, 4, , 5]);
                    return [4 /*yield*/, fetch('/api/otp?secret=' + encodeURIComponent(sec), { cache: 'no-store' })];
                case 2:
                    r = _c.sent();
                    return [4 /*yield*/, r.json()];
                case 3:
                    d = _c.sent();
                    if (d && d.now) {
                        serverTimeOffsetMs = Number(d.now) - Date.now();
                    }
                    box.textContent = d.otp || '------';
                    return [3 /*break*/, 5];
                case 4:
                    _a = _c.sent();
                    box.textContent = '------';
                    return [3 /*break*/, 5];
                case 5: return [2 /*return*/];
            }
        });
    });
}
document.addEventListener('input', function (e) {
    if (e.target && e.target.id === 'u2faCombined')
        parseUser2faInput();
    if (e.target && e.target.id === 'u2faUser') {
        syncCombinedFromFields();
    }
    if (e.target && e.target.id === 'u2faSecret') {
        syncCombinedFromFields();
        updateUser2faOtp();
    }
});
syncServerTime().then(function () { tickOtpCountdown(); updateUser2faOtp(); });
setInterval(tickOtpCountdown, 500);
setInterval(syncServerTime, 30000);
function sendNameToTool(name, mode) {
    return __awaiter(this, void 0, void 0, function () {
        var box, d, e_2;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    box = document.getElementById('toolSendResult');
                    if (box)
                        box.innerHTML = '<div class="notice">Đang gửi sang iPhone Tool...</div>';
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 3, , 4]);
                    return [4 /*yield*/, postJson('/IphoneTool/SendName', { name: name, mode: mode || 'user' })];
                case 2:
                    d = _a.sent();
                    if (box)
                        box.innerHTML = '<div class="notice ' + (d.status ? 'ok' : 'warn') + '">' + (d.message || 'Đã gửi') + '</div>';
                    toast(d.status ? (d.queued ? 'Đã gửi lệnh đổi tên' : 'Đã gửi sang Tool') : 'Đã lưu hàng chờ');
                    return [3 /*break*/, 4];
                case 3:
                    e_2 = _a.sent();
                    if (box)
                        box.innerHTML = '<div class="notice warn">Không gửi được: ' + e_2.message + '</div>';
                    return [3 /*break*/, 4];
                case 4: return [2 /*return*/];
            }
        });
    });
}
document.addEventListener('click', function (e) { return __awaiter(void 0, void 0, void 0, function () {
    var clearId, el, copyId, el, pasteId, copyVal, copySimId, el, v, checkSimId, direct, sel, u, sec, u;
    var _a, _b, _c;
    return __generator(this, function (_d) {
        switch (_d.label) {
            case 0:
                clearId = e.target && e.target.getAttribute && e.target.getAttribute('data-clear-input');
                if (clearId) {
                    el = document.getElementById(clearId);
                    if (el) {
                        el.value = '';
                        el.dispatchEvent(new Event('input', { bubbles: true }));
                    }
                }
                copyId = e.target && e.target.getAttribute && e.target.getAttribute('data-copy-input');
                if (copyId) {
                    el = document.getElementById(copyId);
                    if (el) {
                        copyText(el.value);
                    }
                }
                pasteId = e.target && e.target.getAttribute && e.target.getAttribute('data-paste-input');
                if (!pasteId) return [3 /*break*/, 2];
                return [4 /*yield*/, pasteToInput(pasteId)];
            case 1:
                _d.sent();
                _d.label = 2;
            case 2:
                copyVal = e.target && e.target.getAttribute && e.target.getAttribute('data-copy');
                if (copyVal !== null && copyVal !== undefined) {
                    copyText(copyVal);
                }
                copySimId = e.target && e.target.getAttribute && e.target.getAttribute('data-copy-sim-id');
                if (copySimId) {
                    el = document.querySelector('.sim-code[data-id="' + CSS.escape(copySimId) + '"]');
                    v = (el ? el.textContent : '').trim();
                    if (!v || v === '------') {
                        toast('Chưa có OTP để copy');
                    }
                    else
                        copyText(v);
                }
                checkSimId = e.target && e.target.getAttribute && e.target.getAttribute('data-check-sim-id');
                if (!checkSimId) return [3 /*break*/, 4];
                return [4 /*yield*/, pollSim(checkSimId)];
            case 3:
                _d.sent();
                _d.label = 4;
            case 4:
                direct = e.target && e.target.getAttribute && e.target.getAttribute('data-send-tool');
                if (!direct) return [3 /*break*/, 6];
                return [4 /*yield*/, sendNameToTool(direct, 'user')];
            case 5:
                _d.sent();
                _d.label = 6;
            case 6:
                if (!(e.target && e.target.id === 'sendSelectedUserBtn')) return [3 /*break*/, 8];
                sel = document.getElementById('sendUserSelect');
                if (!sel) return [3 /*break*/, 8];
                return [4 /*yield*/, sendNameToTool(sel.value, 'selected')];
            case 7:
                _d.sent();
                _d.label = 8;
            case 8:
                if (!(e.target && e.target.id === 'sendUser2faNow')) return [3 /*break*/, 10];
                u = ((_a = document.getElementById('u2faUser')) === null || _a === void 0 ? void 0 : _a.value.trim()) || '';
                sec = ((_b = document.getElementById('u2faSecret')) === null || _b === void 0 ? void 0 : _b.value.trim()) || '';
                if (!u || !sec) {
                    toast('Thiếu user hoặc secret 2FA');
                    return [2 /*return*/];
                }
                return [4 /*yield*/, sendNameToTool(u + '|' + sec, 'user2fa')];
            case 9:
                _d.sent();
                _d.label = 10;
            case 10:
                if (!(e.target && e.target.id === 'sendUserOnlyNow')) return [3 /*break*/, 12];
                u = ((_c = document.getElementById('u2faUser')) === null || _c === void 0 ? void 0 : _c.value.trim()) || '';
                if (!u) {
                    toast('Thiếu user');
                    return [2 /*return*/];
                }
                return [4 /*yield*/, sendNameToTool(u, 'user')];
            case 11:
                _d.sent();
                _d.label = 12;
            case 12: return [2 /*return*/];
        }
    });
}); });
function pollSim(onlyId) {
    return __awaiter(this, void 0, void 0, function () {
        var items, items_1, items_1_1, el, id, r, d, codeEl, timeTxt, e_3, e_4_1;
        var e_4, _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    items = __spreadArray([], __read(document.querySelectorAll('.sim-status[data-id]')), false).filter(function (x) { return !onlyId || String(x.dataset.id) === String(onlyId); });
                    _b.label = 1;
                case 1:
                    _b.trys.push([1, 9, 10, 11]);
                    items_1 = __values(items), items_1_1 = items_1.next();
                    _b.label = 2;
                case 2:
                    if (!!items_1_1.done) return [3 /*break*/, 8];
                    el = items_1_1.value;
                    _b.label = 3;
                case 3:
                    _b.trys.push([3, 6, , 7]);
                    id = el.dataset.id;
                    el.textContent = 'Đang kiểm tra...';
                    return [4 /*yield*/, fetch('/api/sim/status/' + encodeURIComponent(id))];
                case 4:
                    r = _b.sent();
                    return [4 /*yield*/, r.json()];
                case 5:
                    d = _b.sent();
                    if (!d.status) {
                        el.textContent = d.message || 'Lỗi kiểm tra OTP';
                        el.classList.add('warn');
                        return [3 /*break*/, 7];
                    }
                    codeEl = document.querySelector('.sim-code[data-id="' + CSS.escape(id) + '"]');
                    timeTxt = d.checkedAt ? (' • ' + d.checkedAt) : '';
                    if (d.code) {
                        if (codeEl)
                            codeEl.textContent = d.code;
                        el.textContent = (d.message || 'Đã nhận OTP') + timeTxt;
                        el.classList.add('ok');
                        if (!el.dataset.doneToast) {
                            toast('Đã nhận OTP SIM: ' + d.code);
                            el.dataset.doneToast = '1';
                        }
                    }
                    else {
                        if (codeEl && !codeEl.textContent.trim())
                            codeEl.textContent = '------';
                        el.textContent = (d.message || 'Chưa có OTP') + timeTxt;
                        if (d.status === 'error' || d.status === 'cancel')
                            el.classList.add('warn');
                        else
                            el.classList.remove('warn');
                    }
                    return [3 /*break*/, 7];
                case 6:
                    e_3 = _b.sent();
                    el.textContent = 'Lỗi: ' + e_3.message;
                    return [3 /*break*/, 7];
                case 7:
                    items_1_1 = items_1.next();
                    return [3 /*break*/, 2];
                case 8: return [3 /*break*/, 11];
                case 9:
                    e_4_1 = _b.sent();
                    e_4 = { error: e_4_1 };
                    return [3 /*break*/, 11];
                case 10:
                    try {
                        if (items_1_1 && !items_1_1.done && (_a = items_1.return)) _a.call(items_1);
                    }
                    finally { if (e_4) throw e_4.error; }
                    return [7 /*endfinally*/];
                case 11: return [2 /*return*/];
            }
        });
    });
}
setInterval(function () { return pollSim(); }, 5000);
pollSim();
document.addEventListener('submit', function (e) {
    if (e.target && e.target.id === 'simGetForm') {
        var btn = document.getElementById('simGetBtn');
        var box = document.getElementById('simGetLoading');
        if (btn) {
            btn.disabled = true;
            btn.textContent = '⏳ Đang lấy số...';
        }
        if (box)
            box.style.display = 'block';
    }
});
function normalizeSearchText(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim(); }
function filterCountryOptions() {
    var inp = document.getElementById('countrySearch');
    var sel = document.getElementById('countrySelect');
    if (!inp || !sel)
        return;
    var qRaw = inp.value.trim();
    var q = normalizeSearchText(qRaw).replace(/^\+/, '');
    var numeric = /^\d+$/.test(q);
    var firstVisible = null;
    __spreadArray([], __read(sel.options), false).forEach(function (opt) {
        var hay = normalizeSearchText(opt.dataset.search || opt.textContent || '');
        var show = true;
        if (q) {
            if (numeric) {
                var dialParts = (opt.dataset.search || '').match(/\+?\d+/g) || [];
                show = dialParts.some(function (x) { return x.replace(/\D/g, '') === q || x.replace(/\D/g, '').startsWith(q); });
            }
            else {
                show = hay.includes(q);
            }
        }
        opt.hidden = !show;
        opt.disabled = !show;
        if (show && !firstVisible)
            firstVisible = opt;
    });
    if (firstVisible && sel.selectedOptions[0] && sel.selectedOptions[0].disabled) {
        sel.value = firstVisible.value;
    }
}
document.addEventListener('input', function (e) { if (e.target && e.target.id === 'countrySearch')
    filterCountryOptions(); });
document.addEventListener('DOMContentLoaded', filterCountryOptions);
document.addEventListener('DOMContentLoaded', function () {
    var el = document.getElementById('siteDomain');
    if (el) {
        var h = (location.hostname || '').replace(/^www\./, '');
        el.textContent = h || 'Localhost';
    }
});
function makeWithdrawMail(base) {
    base = String(base || '').replace(/\s+/g, '').trim();
    var m = base.match(/^([^@]+)@([^@]+\.[^@]+)$/);
    if (!m)
        return '';
    var local = m[1].replace(/\./g, '');
    var domain = m[2].toLowerCase();
    if (!local)
        return '';
    var dotted = local.length > 1 ? local[0] + '.' + local.slice(1) : local;
    var n = String(Math.floor(Math.random() * 999) + 1).padStart(3, '0');
    return dotted + '+tiktoktool' + n + '@' + domain;
}
function refreshWithdrawMail() {
    var el = document.getElementById('withdrawMailInput');
    if (!el)
        return;
    var v = makeWithdrawMail(el.dataset.base || '');
    if (v)
        el.value = v;
}
document.addEventListener('DOMContentLoaded', function () { refreshWithdrawMail(); });
document.addEventListener('click', function (e) { if (e.target && e.target.id === 'refreshWithdrawMail') {
    refreshWithdrawMail();
    toast('Đã random mail mới');
} });
