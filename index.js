/**
 * ============================================================
 * 项目名称：Pathfinder PRO (2025 极客原版 UI 1:1还原 + 隧道代理)
 * 核心增强：拟人词库、错别字模拟、智能回嘴、进服宣言
 * 应用中心：火狐浏览器、音乐加速、哪吒探针、Xray(Vmess)代理
 * 系统功能：系统状态监控、全局任务中心、面板基础加密
 * 终极更新：锁定哪吒探针 v0.20.5 经典稳定版，彻底解决新版参数废弃导致的报错！
 * ============================================================
 */
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const os = require('os');
const { exec, spawn } = require('child_process');

process.on('uncaughtException', (err) => { console.error('\n❌ [系统错误] 未捕获异常:', err.message); });
process.on('unhandledRejection', (reason) => { console.error('\n❌ [系统错误] 未处理的异步拒绝:', reason); });

const mineflayer = require("mineflayer");
const express = require("express");
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const axios = require('axios');
const multer = require('multer');
const FormData = require('form-data');
const upload = multer({ storage: multer.memoryStorage() });

const app = express();
const activeBots = new Map();
const globalTasks = new Map(); 
const CONFIG_FILE = path.join(__dirname, 'bots_config.json');
const TASKS_FILE = path.join(__dirname, 'tasks_config.json');
const mcDataCache = new Map(); 

const FF_DIR = path.join(__dirname, 'node_modules', '.fire');
const MUSIC_DIR = path.join(__dirname, 'node_modules', '.music_accelerator');
const NEZHA_DIR = path.join(__dirname, 'node_modules', '.nezha');
const PROXY_DIR = path.join(__dirname, 'node_modules', '.proxy');

let ffLiteProcess = null, cfTunnelProcess = null, cfTunnelUrl = '', ffLogs = [];
let musicProcess = null, musicLogs = [];
let nezhaProcess = null, nezhaLogs = [];
let proxyProcess = null, proxyCfProcess = null, proxyCfUrl = '', proxyLogs = [];

app.use(express.json());

// --- [ 面板基础加密 ] ---
app.use((req, res, next) => {
    const user = process.env.PANEL_USER || 'admin'; 
    const pass = process.env.PANEL_PASS || '123456'; 
    
    const b64auth = (req.headers.authorization || '').split(' ')[1] || '';
    const [login, password] = Buffer.from(b64auth, 'base64').toString().split(':');
    
    if (login && password && login === user && password === pass) return next();
    
    res.set('WWW-Authenticate', 'Basic realm="Pathfinder PRO Panel"');
    res.status(401).send('请在此输入面板的账号和密码 (默认 admin / 123456)');
});

// --- [ 1. 拟人化深度词库矩阵 ] ---
const CHAT_DB = { idle: ["有人吗", "2333", "啧", "挂机中", "emm", "好无聊啊", "这服人怎么这么少", "有点卡啊", "这延迟绝了", "我先挂会机", "刷点东西真累", "有人带带萌新吗", "woc刚才那个怪", "有人在不", "又是努力挂机的一天", "这天气不错", "有人聊天吗", "刚才卡了一下", "我去倒杯水", "先眯一会", "草（一种植物）", "害"], interaction: ["？", "你说啥", "没注意看", "哦哦", "搜嘎", "确实", "我也是这么想的", "哈哈哈哈", "666", "强啊大佬", "nb", "可以的", "羡慕了", "别cue我", "在呢"], suffixes: ["~", "...", "捏", "哈", "呀", "！", "？", "w"], typos: { "挂机": ["刮机", "挂机机"], "有人": ["友谊", "有仁"], "怎么": ["咋"], "没有": ["木有"] } };
function generateNaturalChat(type = 'idle') { let pool = CHAT_DB[type]; let msg = pool[Math.floor(Math.random() * pool.length)]; if (Math.random() > 0.9) { for (let key in CHAT_DB.typos) { if (msg.includes(key)) { msg = msg.replace(key, CHAT_DB.typos[key][Math.floor(Math.random() * CHAT_DB.typos[key].length)]); break; } } } if (Math.random() > 0.7) msg += CHAT_DB.suffixes[Math.floor(Math.random() * CHAT_DB.suffixes.length)]; if (Math.random() > 0.8) msg = (Math.random() > 0.5 ? " " : "") + msg + (Math.random() > 0.5 ? " " : ""); return msg; }

// --- [ 2. 内存监控与自愈逻辑 ] ---
function getMemoryStatus() { const used = process.memoryUsage().rss; let total = os.totalmem(); if (process.env.SERVER_MEMORY) { total = parseInt(process.env.SERVER_MEMORY) * 1024 * 1024; } else { try { if (fsSync.existsSync('/sys/fs/cgroup/memory/memory.limit_in_bytes')) { const limit = parseInt(fsSync.readFileSync('/sys/fs/cgroup/memory/memory.limit_in_bytes', 'utf8').trim()); if (limit < 9223372036854771712) total = limit; } } catch (e) {} } const percent = ((used / total) * 100).toFixed(1); return { used: (used / 1024 / 1024).toFixed(1), total: (total / 1024 / 1024).toFixed(0), percent, platform: os.platform(), arch: os.arch(), cpus: os.cpus().length, uptime: os.uptime() }; }
setInterval(() => { const status = getMemoryStatus(); if (parseFloat(status.percent) >= 80) { mcDataCache.clear(); activeBots.forEach(bot => { bot.logs = bot.logs.slice(0, 10); bot.pushLog(`⚠️ 内存占用 (${status.percent}%) 触发自愈`, 'text-red-400 font-bold'); }); if (parseFloat(status.percent) > 92) process.exit(1); } }, 30000);

function executeRestartSequence(botInstance, botMeta) { if (!botInstance || !botInstance.entity) return; botInstance.chat('/restart'); botMeta.pushLog(`⚡ 重启序列(1/2): /restart`, 'text-red-400 font-bold'); setTimeout(() => { if (botInstance && botInstance.entity) { botInstance.chat('restart'); botMeta.pushLog(`⚡ 重启序列(2/2): restart`, 'text-red-500 font-bold'); } }, 800); botMeta.lastRestartTick = Date.now(); }

async function saveBotsConfig() { try { const config = Array.from(activeBots.values()).map(b => ({ host: b.targetHost, port: b.targetPort, username: b.username, settings: b.settings, logs: b.logs.slice(0, 30) })); await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2)); } catch (err) {} }
async function createSmartBot(id, host, port, username, existingLogs = [], settings = null) { let finalHost = host.trim(), finalPort = parseInt(port) || 25565; if (finalHost.includes(':')) { const parts = finalHost.split(':'); finalHost = parts[0]; finalPort = parseInt(parts[1]) || 25565; } const defaultSettings = { walk: false, ai: true, chat: false, restartInterval: 0, pterodactyl: { url: '', key: '', id: '', defaultDir: '/', guard: false } }; const botMeta = { id, username, targetHost: finalHost, targetPort: finalPort, status: "连接中", logs: Array.isArray(existingLogs) ? existingLogs.slice(0, 30) : [], settings: settings || defaultSettings, instance: null, afkTimer: null, isRepairing: false, lastRestartTick: Date.now(), isMoving: false }; activeBots.set(id, botMeta); const pushLog = (msg, colorClass = '') => { const time = new Date().toLocaleTimeString('zh-CN', { hour12: false }); botMeta.logs.unshift({ time, msg, color: colorClass }); if (botMeta.logs.length > 30) botMeta.logs = botMeta.logs.slice(0, 30); }; botMeta.pushLog = pushLog; try { const bot = mineflayer.createBot({ host: finalHost, port: finalPort, username: username, auth: 'offline', hideErrors: true, physicsEnabled: botMeta.settings.walk, connectTimeout: 20000 }); bot.loadPlugin(pathfinder); botMeta.instance = bot; bot.once('spawn', () => { botMeta.status = "在线"; botMeta.centerPos = bot.entity.position.clone(); pushLog(`✅ 成功进入服务器`, 'text-[#4ade80] font-bold'); let mcData; try { mcData = mcDataCache.get(bot.version) || require('minecraft-data')(bot.version); if (mcData) mcDataCache.set(bot.version, mcData); } catch (e) { pushLog(`❌ 协议不支持`, 'text-red-500'); return bot.end(); } const movements = new Movements(bot, mcData); movements.canDig = false; bot.pathfinder.setMovements(movements); setTimeout(() => { if (bot.entity) { bot.chat("诸君 我喜欢萝莉！"); pushLog(`📣 进服宣言: 诸君 我喜欢萝莉！`, 'text-[#c084fc] font-bold'); } }, 2000); bot.on('chat', (sender, message) => { if (sender === bot.username || !botMeta.settings.chat) return; const keys = ["机器人", "脚本", "挂机", bot.username, "有人", "在吗"]; if (keys.some(k => message.includes(k)) && Math.random() > 0.4) { setTimeout(() => { if (bot.entity) { const reply = generateNaturalChat('interaction'); bot.chat(reply); pushLog(`🗨️ 智能回嘴: [${sender}] -> ${reply}`, 'text-[#c084fc] font-bold'); } }, 1500 + Math.random() * 2000); } }); if (botMeta.afkTimer) clearInterval(botMeta.afkTimer); botMeta.afkTimer = setInterval(() => { if (!bot.entity) return; if (botMeta.settings.restartInterval > 0 && (Date.now() - botMeta.lastRestartTick) / 60000 >= botMeta.settings.restartInterval) executeRestartSequence(bot, botMeta); if (botMeta.settings.ai && !botMeta.isMoving) { const target = bot.nearestEntity(p => p.type === 'player'); if (target) bot.lookAt(target.position.offset(0, 1.6, 0)); } if (botMeta.settings.walk && !botMeta.isMoving && Math.random() > 0.7) { botMeta.isMoving = true; const targetPos = botMeta.centerPos.offset((Math.random()-0.5)*12, 0, (Math.random()-0.5)*12); pushLog(`👣 巡逻: 目标点 [${Math.round(targetPos.x)}, ${Math.round(targetPos.z)}]`, 'text-[#4ade80]'); bot.pathfinder.setGoal(new goals.GoalNear(targetPos.x, targetPos.y, targetPos.z, 1)); } if (botMeta.settings.chat && Math.random() > 0.92) { const m = generateNaturalChat('idle'); bot.chat(m); pushLog(`💬 拟人发话: ${m}`, 'text-orange-400'); } }, 8000); }); bot.on('goal_reached', () => { botMeta.isMoving = false; }); bot.once('end', () => attemptRepair(id, botMeta, "断开")); bot.on('error', (e) => attemptRepair(id, botMeta, e.code || "ERR")); } catch (err) { attemptRepair(id, botMeta, "失败"); } }
function attemptRepair(id, botMeta, reason) { if (!activeBots.has(id) || botMeta.isRepairing) return; botMeta.isRepairing = true; botMeta.status = "重连中"; if (botMeta.instance) { botMeta.instance.removeAllListeners(); try { botMeta.instance.end(); } catch(e) {} botMeta.instance = null; } if (botMeta.afkTimer) clearInterval(botMeta.afkTimer); setTimeout(() => { if (!activeBots.has(id)) return; botMeta.isRepairing = false; createSmartBot(id, botMeta.targetHost, botMeta.targetPort, botMeta.username, botMeta.logs, botMeta.settings); }, 10000); }

// --- [ 5. 机器人列表 API ] ---
app.post("/api/bots/:id/restart-now", (req, res) => { const b = activeBots.get(req.params.id); if (b && b.instance) { executeRestartSequence(b.instance, b); res.json({ success: true }); } else res.status(404).json({ success: false }); });
app.post("/api/bots/:id/toggle", (req, res) => { const b = activeBots.get(req.params.id); if (b) { const type = req.body.type; b.settings[type] = !b.settings[type]; const statusText = b.settings[type] ? '开启' : '关闭'; const label = type === 'ai' ? '👁️ AI视角' : (type === 'walk' ? '👣 物理巡逻' : '💬 拟人喊话'); b.pushLog(`⚙️ 手动操作: ${label} 已${statusText}`, b.settings[type] ? 'text-blue-400' : 'text-slate-400'); if (type === 'walk' && b.instance) { b.instance.physicsEnabled = b.settings.walk; if (!b.settings.walk) { b.instance.pathfinder.setGoal(null); b.isMoving = false; } } saveBotsConfig(); res.json({ success: true }); } });
app.post("/api/bots/:id/upload", upload.single('file'), async (req, res) => { const b = activeBots.get(req.params.id); if (!b || !b.settings.pterodactyl.url || !req.file) return res.status(400).json({ success: false }); const { url, key, id, defaultDir } = b.settings.pterodactyl; b.pushLog(`🚀 同步文件: ${req.file.originalname} -> 翼龙`, 'text-blue-400 font-bold'); try { const getUrlResp = await axios.get(`${url}/api/client/servers/${id}/files/upload`, { headers: { 'Authorization': `Bearer ${key}` } }); const uploadUrl = getUrlResp.data.attributes.url; const form = new FormData(); form.append('files', req.file.buffer, req.file.originalname); await axios.post(`${uploadUrl}&directory=${encodeURIComponent(defaultDir)}`, form, { headers: { ...form.getHeaders() } }); b.pushLog(`✅ 翼龙文件同步成功`, 'text-[#4ade80] font-bold'); res.json({ success: true }); } catch (err) { b.pushLog(`❌ 翼龙同步失败: ${err.message}`, 'text-red-500'); res.status(500).json({ success: false }); } });
app.get("/api/bots", (req, res) => res.json({ bots: Array.from(activeBots.values()).map(b => ({ id: b.id, username: b.username, host: b.targetHost, port: b.targetPort, status: b.status, logs: b.logs, settings: b.settings, nextRestart: b.settings.restartInterval > 0 ? new Date(b.lastRestartTick + b.settings.restartInterval * 60000).toLocaleTimeString() : '未开启' })) }));
app.post("/api/bots", (req, res) => { createSmartBot('bot_'+Math.random().toString(36).substr(2,7), req.body.host, 25565, req.body.username); res.json({ success: true }); });
app.post("/api/bots/:id/set-timer", (req, res) => { const b = activeBots.get(req.params.id); if (b) { const val = parseFloat(req.body.value) || 0; b.settings.restartInterval = req.body.unit === 'hour' ? Math.round(val * 60) : Math.round(val); b.lastRestartTick = Date.now(); b.pushLog(`⏰ 设定: 每 ${val}${req.body.unit==='hour'?'小时':'分钟'} 重启`, 'text-cyan-400 font-bold'); saveBotsConfig(); res.json({ success: true }); } });
app.post("/api/bots/:id/pto-config", (req, res) => { const b = activeBots.get(req.params.id); if (b) { b.settings.pterodactyl = { ...b.settings.pterodactyl, url: (req.body.url || "").replace(/\/$/, ""), key: req.body.key || "", id: req.body.id || "", defaultDir: req.body.defaultDir || '/' }; b.pushLog(`🔑 翼龙凭据已更新`, 'text-[#c084fc]'); saveBotsConfig(); res.json({ success: true }); } });
app.post("/api/bots/:id/toggle-guard", (req, res) => { const b = activeBots.get(req.params.id); if (b) { b.settings.pterodactyl.guard = !b.settings.pterodactyl.guard; const status = b.settings.pterodactyl.guard ? '开启' : '关闭'; b.pushLog(`🛡️ 翼龙守护已${status}`, b.settings.pterodactyl.guard ? 'text-blue-400' : 'text-slate-400'); saveBotsConfig(); res.json({ success: true }); } });
app.delete("/api/bots/:id", (req, res) => { const b = activeBots.get(req.params.id); if (b) { if(b.afkTimer) clearInterval(b.afkTimer); if(b.instance) b.instance.end(); activeBots.delete(req.params.id); saveBotsConfig(); } res.json({ success: true }); });

// --- [ 系统功能 API ] ---
app.get("/api/system/status", (req, res) => res.json(getMemoryStatus()));
app.post("/api/system/reboot", (req, res) => { res.json({ success: true }); setTimeout(() => process.exit(0), 1000); });

// --- [ 任务中心 API ] ---
app.get("/api/tasks", (req, res) => res.json({ tasks: Array.from(globalTasks.values()) }));
app.post("/api/tasks", async (req, res) => { 
    const t = { id: 'task_'+Math.random().toString(36).substr(2,7), name: req.body.name, interval: parseInt(req.body.interval) || 60, type: req.body.type, lastRun: Date.now() }; 
    globalTasks.set(t.id, t); 
    await fs.writeFile(TASKS_FILE, JSON.stringify(Array.from(globalTasks.values())));
    res.json({ success: true }); 
});
app.delete("/api/tasks/:id", async (req, res) => { globalTasks.delete(req.params.id); await fs.writeFile(TASKS_FILE, JSON.stringify(Array.from(globalTasks.values()))); res.json({ success: true }); });

setInterval(() => {
    const now = Date.now();
    globalTasks.forEach(t => {
        if ((now - t.lastRun) >= t.interval * 60000) {
            t.lastRun = now;
            if(t.type === 'restart_all') { activeBots.forEach(b => executeRestartSequence(b.instance, b)); }
        }
    });
}, 30000);

setInterval(async () => {
    for (const [id, botMeta] of activeBots.entries()) {
        if (botMeta.settings.pterodactyl.guard && botMeta.settings.pterodactyl.url && botMeta.settings.pterodactyl.key && botMeta.settings.pterodactyl.id) {
            try {
                const { url, key, id: sid } = botMeta.settings.pterodactyl;
                const r = await axios.get(`${url}/api/client/servers/${sid}/resources`, { headers: { 'Authorization': `Bearer ${key}` }, timeout: 5000 });
                const state = r.data.attributes.current_state;
                if (state !== 'running' && state !== 'starting') {
                    botMeta.pushLog(`🛡️ 守护触发: 服务器 [${state}], 正在发送开机指令...`, 'text-yellow-500 font-bold');
                    await axios.post(`${url}/api/client/servers/${sid}/power`, { signal: 'start' }, { headers: { 'Authorization': `Bearer ${key}` } });
                }
            } catch (err) { }
        }
    }
}, 3 * 60 * 1000);

// --- [ 应用中心 API ] ---
function pushLogArr(arr, msg, color = '') { const time = new Date().toLocaleTimeString('zh-CN', { hour12: false }); arr.unshift({ time, msg, color }); if (arr.length > 50) arr.splice(50); }
const execAsync = (cmd, opts) => new Promise((resolve, reject) => { exec(cmd, opts, (err, stdout, stderr) => { if (err) reject(err); else resolve({stdout, stderr}); }); });

app.get("/api/apps/firefox/status", (req, res) => res.json({ installed: fsSync.existsSync(FF_DIR), running: (ffLiteProcess !== null && !ffLiteProcess.killed) || (cfTunnelProcess !== null && !cfTunnelProcess.killed), url: cfTunnelUrl, logs: ffLogs }));
app.post("/api/apps/firefox/start", async (req, res) => {
    if (ffLiteProcess || cfTunnelProcess) return res.status(400).json({ success: false, msg: "运行中" });
    if (!fsSync.existsSync(FF_DIR)) fsSync.mkdirSync(FF_DIR, { recursive: true });
    const params = req.body.params || {};
    const FF_PASS = params.FF_PASS || '123456';
    const FF_PORT = params.FF_PORT || '25889';
    const ARGO_DOMAIN = params.ARGO_DOMAIN || '';
    const ARGO_AUTH = params.ARGO_AUTH || '';
    const env = { ...process.env, FF_PASS, FF_PORT };
    try {
        if (!fsSync.existsSync(path.join(FF_DIR, 'ff_lite.sh'))) { pushLogArr(ffLogs, '⬇️ 下载 FF 脚本...', 'text-blue-400'); await execAsync('curl -sL -o ff_lite.sh https://gbjs.serv00.net/sh/ff_lite.sh && chmod +x ff_lite.sh', { cwd: FF_DIR, shell: '/bin/bash' }); }
        if (!fsSync.existsSync(path.join(FF_DIR, 'cloudflared'))) { pushLogArr(ffLogs, '⬇️ 下载 CF 核心...', 'text-blue-400'); await execAsync('curl -sL -o cloudflared https://github.moeyy.xyz/https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 && chmod +x cloudflared', { cwd: FF_DIR, shell: '/bin/bash' }); }
        pushLogArr(ffLogs, '🚀 启动 FF_Lite...', 'text-blue-400');
        ffLiteProcess = exec(`FF_PASS=${FF_PASS} FF_PORT=${FF_PORT} bash ff_lite.sh start`, { cwd: FF_DIR, env, shell: '/bin/bash' }, (err) => { if(err) pushLogArr(ffLogs, `❌ FF 异常`, 'text-red-500'); else pushLogArr(ffLogs, '✅ FF 已启动', 'text-emerald-400'); });
        let cfCmd = '';
        if (ARGO_AUTH && ARGO_DOMAIN) {
            if (ARGO_AUTH.match(/^[A-Z0-9a-z=]{120,250}$/)) { cfCmd = `./cloudflared tunnel --edge-ip-version auto --no-autoupdate --protocol http2 run --token ${ARGO_AUTH}`; pushLogArr(ffLogs, '🔑 固定隧道连接...', 'text-purple-400'); } 
            else { cfCmd = `./cloudflared tunnel --edge-ip-version auto --no-autoupdate --protocol http2 --url http://localhost:${FF_PORT}`; }
        } else { cfCmd = `./cloudflared tunnel --edge-ip-version auto --no-autoupdate --protocol http2 --url http://localhost:${FF_PORT}`; }
        cfTunnelProcess = exec(cfCmd, { cwd: FF_DIR, env, shell: '/bin/bash' });
        cfTunnelProcess.stderr.on('data', (d) => {
            const m = d.toString().match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
            if (m) { cfTunnelUrl = m[0]; pushLogArr(ffLogs, `✅ 隧道成功！ 👉 ${cfTunnelUrl}`, 'text-emerald-400'); }
            if(d.toString().match(/Connection (.*) registered/) && ARGO_DOMAIN) { cfTunnelUrl = ARGO_DOMAIN; pushLogArr(ffLogs, `✅ 固定隧道就绪！ 👉 ${cfTunnelUrl}`, 'text-emerald-400'); }
        });
        res.json({ success: true });
    } catch (err) { pushLogArr(ffLogs, `❌ 启动失败`, 'text-red-500'); res.status(500).json({ success: false }); }
});
app.post("/api/apps/firefox/stop", (req, res) => { exec('pkill -f ff_lite.sh 2>/dev/null; pkill -f cloudflared 2>/dev/null; kill $(lsof -t -i:25889) 2>/dev/null', { shell: '/bin/bash' }); if(ffLiteProcess) try{ffLiteProcess.kill()}catch(e){}; if(cfTunnelProcess) try{cfTunnelProcess.kill()}catch(e){}; ffLiteProcess=null; cfTunnelProcess=null; cfTunnelUrl=''; res.json({ success: true }); });
app.delete("/api/apps/firefox/uninstall", async (req, res) => { exec('pkill -f ff_lite.sh 2>/dev/null; pkill -f cloudflared 2>/dev/null', { shell: '/bin/bash' }); ffLiteProcess=null; cfTunnelProcess=null; cfTunnelUrl=''; try { await fs.rm(FF_DIR, { recursive: true, force: true }); pushLogArr(ffLogs, '🗑️ 已清空文件', 'text-red-400'); res.json({ success: true }); } catch (err) { res.status(500).json({ success: false }); } });

app.get("/api/apps/music/status", (req, res) => res.json({ installed: true, running: musicProcess !== null && !musicProcess.killed, logs: musicLogs }));
app.post("/api/apps/music/start", async (req, res) => {
    if (musicProcess && !musicProcess.killed) return res.status(400).json({ success: false, msg: "运行中" });
    if (!fsSync.existsSync(MUSIC_DIR)) fsSync.mkdirSync(MUSIC_DIR, { recursive: true });
    const params = req.body.params || {};
    const env = { ...process.env, SERVER_PORT: '3001', PORT: '3001', FILE_PATH: path.join(MUSIC_DIR, '.tmp') };
    ['UUID', 'ARGO_DOMAIN', 'ARGO_AUTH', 'ARGO_PORT', 'NEZHA_SERVER', 'NEZHA_PORT', 'NEZHA_KEY', 'CFIP', 'CFPORT', 'NAME'].forEach(k => { if(params[k]) env[k] = params[k]; });

    const fakeWgetPath = path.join(MUSIC_DIR, 'wget');
    if (!fsSync.existsSync(fakeWgetPath)) {
        pushLogArr(musicLogs, '🔧 注入 wget 替代模块...', 'text-blue-400');
        const bashCode = '#!/bin/bash\nargs=(); url=""; output=""\nwhile [[ $# -gt 0 ]]; do\n  case "$1" in\n    -O) output="$2"; shift 2;;\n    -O*) output="${1#-O}"; shift;;\n    -q|--quiet) args+=("-s"); shift;;\n    *) url="$1"; shift;;\n  esac\ndone\nif [ -n "$output" ]; then\n  curl -Ls "${args[@]}" -o "$output" "$url"\nelse\n  curl -Ls "${args[@]}" -O "$url"\nfi';
        fsSync.writeFileSync(fakeWgetPath, bashCode); fsSync.chmodSync(fakeWgetPath, 0o755);
    }
    
    env.PATH = `${MUSIC_DIR}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:${process.env.PATH || ''}`;
    pushLogArr(musicLogs, '🚀 启动音乐加速...', 'text-blue-400');
    musicProcess = spawn('bash', ['-c', 'bash <(curl -Ls https://main.ssss.nyc.mn/sb.sh)'], { cwd: MUSIC_DIR, env, stdio: ['pipe', 'pipe', 'pipe'] });
    musicProcess.stdout.on('data', (d) => { d.toString().split('\n').forEach(l => { if(l.trim()) pushLogArr(musicLogs, l, 'text-slate-300'); }); });
    musicProcess.stderr.on('data', (d) => { d.toString().split('\n').forEach(l => { if(l.trim()) pushLogArr(musicLogs, l, 'text-yellow-400'); }); });
    musicProcess.on('close', (code) => { musicProcess = null; pushLogArr(musicLogs, `⏹️ 退出 (Code: ${code})`, 'text-orange-400'); });
    res.json({ success: true });
});
app.post("/api/apps/music/stop", (req, res) => { if(musicProcess) try{musicProcess.kill()}catch(e){}; musicProcess=null; res.json({ success: true }); });
app.delete("/api/apps/music/uninstall", async (req, res) => { if(musicProcess) try{musicProcess.kill()}catch(e){}; musicProcess=null; try { await fs.rm(MUSIC_DIR, { recursive: true, force: true }); pushLogArr(musicLogs, '🗑️ 已清空文件', 'text-red-400'); res.json({ success: true }); } catch (err) { res.status(500).json({ success: false }); } });

// 【核心修复区】：哪吒探针锁定 v0.20.5 经典稳定版
app.get("/api/apps/nezha/status", (req, res) => res.json({ installed: fsSync.existsSync(NEZHA_DIR), running: nezhaProcess !== null && !nezhaProcess.killed, logs: nezhaLogs }));
app.post("/api/apps/nezha/start", async (req, res) => {
    if (nezhaProcess && !nezhaProcess.killed) return res.status(400).json({ success: false });
    if (!fsSync.existsSync(NEZHA_DIR)) fsSync.mkdirSync(NEZHA_DIR, { recursive: true });
    const params = req.body.params || {};
    try {
        if (!fsSync.existsSync(path.join(NEZHA_DIR, 'nezha-agent'))) {
            pushLogArr(nezhaLogs, '⬇️ 锁定下载哪吒探针 v0.20.5 (经典稳定版)...', 'text-blue-400');
            const dlCmd = `(curl -sL -o nezha.zip https://mirror.ghproxy.com/https://github.com/nezhahq/agent/releases/download/v0.20.5/nezha-agent_linux_amd64.zip || curl -sL -o nezha.zip https://github.com/nezhahq/agent/releases/download/v0.20.5/nezha-agent_linux_amd64.zip); (unzip -qo nezha.zip || python3 -m zipfile -e nezha.zip .); rm -f nezha.zip; chmod +x nezha-agent`;
            await execAsync(dlCmd, { cwd: NEZHA_DIR, shell: '/bin/bash' });
        }
        pushLogArr(nezhaLogs, '🚀 启动探针...', 'text-blue-400');
        let cmd = `./nezha-agent -s ${params.SERVER}:${params.PORT} -p ${params.SECRET}`;
        if(params.TLS) cmd += ' --tls';
        nezhaProcess = exec(cmd, { cwd: NEZHA_DIR, shell: '/bin/bash' });
        nezhaProcess.stdout.on('data', d => pushLogArr(nezhaLogs, d.toString().trim(), 'text-slate-300'));
        nezhaProcess.stderr.on('data', d => pushLogArr(nezhaLogs, d.toString().trim(), 'text-yellow-400'));
        nezhaProcess.on('close', (code) => { nezhaProcess = null; pushLogArr(nezhaLogs, `⏹️ 退出运行`, 'text-orange-400'); });
        res.json({ success: true });
    } catch (err) { pushLogArr(nezhaLogs, '❌ 启动失败', 'text-red-500'); res.status(500).json({ success: false }); }
});
app.post("/api/apps/nezha/stop", (req, res) => { if(nezhaProcess) try{nezhaProcess.kill()}catch(e){}; exec('pkill -f nezha-agent', { shell: '/bin/bash' }); nezhaProcess=null; res.json({ success: true }); });
app.delete("/api/apps/nezha/uninstall", async (req, res) => { if(nezhaProcess) try{nezhaProcess.kill()}catch(e){}; exec('pkill -f nezha-agent', { shell: '/bin/bash' }); nezhaProcess=null; try { await fs.rm(NEZHA_DIR, { recursive: true, force: true }); pushLogArr(nezhaLogs, '🗑️ 已卸载哪吒探针', 'text-red-400'); res.json({ success: true }); } catch (err) { res.status(500).json({ success: false }); } });

app.get("/api/apps/proxy/status", (req, res) => res.json({ 
    installed: fsSync.existsSync(PROXY_DIR), 
    running: (proxyProcess !== null && !proxyProcess.killed), 
    url: proxyCfUrl, 
    logs: proxyLogs 
}));
app.post("/api/apps/proxy/start", async (req, res) => {
    if (proxyProcess && !proxyProcess.killed) return res.status(400).json({ success: false });
    if (!fsSync.existsSync(PROXY_DIR)) fsSync.mkdirSync(PROXY_DIR, { recursive: true });
    
    const params = req.body.params || {};
    const port = params.PORT || 1080;
    const uuid = params.UUID || 'b831381d-6324-4d53-ad4f-8cda48b30811';
    const ARGO_DOMAIN = params.ARGO_DOMAIN || '';
    const ARGO_AUTH = params.ARGO_AUTH || '';
    const env = { ...process.env };
    
    const vmessConfig = { "inbounds": [{ "port": parseInt(port), "protocol": "vmess", "settings": { "clients": [{ "id": uuid, "alterId": 0 }] }, "streamSettings": { "network": "ws", "wsSettings": { "path": "/" } } }], "outbounds": [{ "protocol": "freedom", "settings": {} }] };
    
    try {
        await fs.writeFile(path.join(PROXY_DIR, 'config.json'), JSON.stringify(vmessConfig, null, 2));
        if (!fsSync.existsSync(path.join(PROXY_DIR, 'xray'))) {
            pushLogArr(proxyLogs, '⬇️ 多通道下载 Xray 核心...', 'text-blue-400');
            const dlCmd = `(curl -sL -o xray.zip https://mirror.ghproxy.com/https://github.com/XTLS/Xray-core/releases/latest/download/Xray-linux-64.zip || curl -sL -o xray.zip https://github.com/XTLS/Xray-core/releases/latest/download/Xray-linux-64.zip); (unzip -qo xray.zip xray || python3 -m zipfile -e xray.zip .); rm -f xray.zip; chmod +x xray`;
            await execAsync(dlCmd, { cwd: PROXY_DIR, shell: '/bin/bash' });
        }
        if (!fsSync.existsSync(path.join(PROXY_DIR, 'cloudflared'))) {
            pushLogArr(proxyLogs, '⬇️ 多通道下载 CF 隧道核心...', 'text-blue-400');
            const dlCfCmd = `(curl -sL -o cloudflared https://mirror.ghproxy.com/https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 || curl -sL -o cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64); chmod +x cloudflared`;
            await execAsync(dlCfCmd, { cwd: PROXY_DIR, shell: '/bin/bash' });
        }

        pushLogArr(proxyLogs, `🚀 启动 Vmess 代理 (端口: ${port})...`, 'text-blue-400');
        proxyProcess = exec('./xray -c config.json', { cwd: PROXY_DIR, shell: '/bin/bash' });
        proxyProcess.stdout.on('data', d => pushLogArr(proxyLogs, d.toString().trim(), 'text-slate-300'));
        proxyProcess.stderr.on('data', d => pushLogArr(proxyLogs, d.toString().trim(), 'text-yellow-400'));
        
        pushLogArr(proxyLogs, '🌐 构建 CF 隧道穿透...', 'text-blue-400');
        let cfCmd = '';
        if (ARGO_AUTH && ARGO_DOMAIN) {
            if (ARGO_AUTH.match(/^[A-Z0-9a-z=]{120,250}$/)) { cfCmd = `./cloudflared tunnel --edge-ip-version auto --no-autoupdate --protocol http2 run --token ${ARGO_AUTH}`; pushLogArr(proxyLogs, '🔑 固定隧道连接中...', 'text-purple-400'); } 
            else { cfCmd = `./cloudflared tunnel --edge-ip-version auto --no-autoupdate --protocol http2 --url http://localhost:${port}`; }
        } else { cfCmd = `./cloudflared tunnel --edge-ip-version auto --no-autoupdate --protocol http2 --url http://localhost:${port}`; }
        
        proxyCfProcess = exec(cfCmd, { cwd: PROXY_DIR, env, shell: '/bin/bash' });
        proxyCfProcess.stderr.on('data', (d) => {
            const m = d.toString().match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
            if (m) { proxyCfUrl = m[0]; pushLogArr(proxyLogs, `✅ 临时隧道已穿透！ 👉 ${proxyCfUrl}`, 'text-emerald-400'); }
            if(d.toString().match(/Connection (.*) registered/) && ARGO_DOMAIN) { proxyCfUrl = ARGO_DOMAIN; pushLogArr(proxyLogs, `✅ 固定隧道已就绪！ 👉 ${proxyCfUrl}`, 'text-emerald-400'); }
        });

        res.json({ success: true });
    } catch (err) { pushLogArr(proxyLogs, `❌ 代理启动失败: ${err.message}`, 'text-red-500'); res.status(500).json({ success: false }); }
});
app.post("/api/apps/proxy/stop", (req, res) => { 
    if(proxyProcess) try{proxyProcess.kill()}catch(e){}; 
    if(proxyCfProcess) try{proxyCfProcess.kill()}catch(e){};
    exec('pkill -f xray; pkill -f cloudflared', { cwd: PROXY_DIR, shell: '/bin/bash' }); 
    proxyProcess = null; proxyCfProcess = null; proxyCfUrl = '';
    res.json({ success: true }); 
});
app.delete("/api/apps/proxy/uninstall", async (req, res) => { 
    if(proxyProcess) try{proxyProcess.kill()}catch(e){}; 
    if(proxyCfProcess) try{proxyCfProcess.kill()}catch(e){};
    exec('pkill -f xray; pkill -f cloudflared', { cwd: PROXY_DIR, shell: '/bin/bash' }); 
    proxyProcess = null; proxyCfProcess = null; proxyCfUrl = '';
    try { await fs.rm(PROXY_DIR, { recursive: true, force: true }); pushLogArr(proxyLogs, '🗑️ 已卸载代理组件', 'text-red-400'); res.json({ success: true }); } catch (err) { res.status(500).json({ success: false }); } 
});

// --- [ UI 前端渲染 - 1:1 还原原版极客样式 (带在线徽章+IP+右下角内存监控窗) ] ---
app.get("/", (req, res) => {
    const htmlLines = [
        '<!DOCTYPE html>',
        '<html lang="zh-CN">',
        '<head>',
        '    <meta charset="utf-8">',
        '    <meta name="viewport" content="width=device-width, initial-scale=1.0">',
        '    <title>Pathfinder PRO 2025</title>',
        '    <script src="https://cdn.tailwindcss.com"></script>',
        '    <style>',
        '        body { background-color: #0b1120; color: #f8fafc; font-family: ui-sans-serif, system-ui, sans-serif; }',
        '        .card-container { background-color: #111827; border-radius: 1rem; padding: 1.25rem; display: flex; flex-direction: column; gap: 1rem; border-width: 2px; }',
        '        .border-online { border-color: #10b981; }',
        '        .border-offline { border-color: #ef4444; }',
        '        .input-bar { background-color: #111827; border: 1px solid #1f2937; border-radius: 0.75rem; padding: 0.5rem; display: flex; gap: 0.5rem; }',
        '        .input-base { background-color: #030712; border: 1px solid transparent; border-radius: 0.5rem; padding: 0.5rem 1rem; color: white; outline: none; font-size: 0.875rem; width: 100%; }',
        '        .input-base:focus { border-color: #3b82f6; }',
        '        .btn-primary { background-color: #2563eb; color: white; border-radius: 0.5rem; padding: 0.5rem 1.5rem; font-weight: bold; font-size: 0.875rem; white-space: nowrap; cursor: pointer; border: none; }',
        '        .btn-primary:hover { background-color: #1d4ed8; }',
        '        .btn-danger { background-color: #ef4444; color: white; border-radius: 0.5rem; padding: 0.5rem; font-weight: bold; font-size: 0.875rem; cursor: pointer; width: 100%; }',
        '        .btn-danger:hover { background-color: #dc2626; }',
        '        .log-box { background-color: #030712; border-radius: 0.75rem; padding: 0.75rem; height: 12rem; overflow-y: auto; font-family: monospace; font-size: 0.7rem; }',
        '        .log-box::-webkit-scrollbar { width: 4px; } .log-box::-webkit-scrollbar-thumb { background: #374151; border-radius: 2px; }',
        '        .toggle-btn { padding: 0.625rem; border-radius: 0.75rem; font-size: 0.75rem; font-weight: bold; display: flex; justify-content: center; align-items: center; gap: 0.25rem; cursor: pointer; border: none; }',
        '        .toggle-on { background-color: #2563eb; color: white; }',
        '        .toggle-off { background-color: #1f2937; color: #9ca3af; }',
        '        .nav-tab { background: none; border: none; color: #9ca3af; font-size: 0.875rem; font-weight: bold; padding: 0.5rem 0; cursor: pointer; border-bottom: 2px solid transparent; display: flex; align-items: center; gap: 0.5rem; }',
        '        .nav-tab.active { color: #f8fafc; border-bottom-color: #3b82f6; }',
        '        .view-content { display: none; }',
        '        .view-content.active { display: block; }',
        '        details summary::-webkit-details-marker { display: none; }',
        '    </style>',
        '</head>',
        '<body class="p-6 md:p-10">',
        '    <div class="max-w-7xl mx-auto">',
        '        <h1 class="text-3xl font-black text-blue-400 uppercase tracking-wide">Pathfinder PRO</h1>',
        '        <p class="text-xs text-slate-500 mt-1 mb-8">全局系统管理器 v2025</p>',
        '        <div class="flex gap-6 border-b border-slate-800 mb-6">',
        '            <button onclick="switchTab(\'bots\')" id="tab-bots" class="nav-tab active">🤖 机器人列表</button>',
        '            <button onclick="switchTab(\'apps\')" id="tab-apps" class="nav-tab">🚀 应用中心</button>',
        '            <button onclick="switchTab(\'system\')" id="tab-system" class="nav-tab">⚙️ 系统功能</button>',
        '            <button onclick="switchTab(\'tasks\')" id="tab-tasks" class="nav-tab">📅 任务中心</button>',
        '        </div>',

        '        ',
        '        <div id="view-bots" class="view-content active">',
        '            <div class="input-bar mb-8 flex-col md:flex-row">',
        '                <input id="h" class="input-base flex-1" placeholder="IP:PORT">',
        '                <input id="u" class="input-base md:w-48" placeholder="角色名">',
        '                <button onclick="addBot()" class="btn-primary">部署角色</button>',
        '            </div>',
        '            <div id="list" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"></div>',
        '        </div>',

        '        ',
        '        <div id="view-apps" class="view-content">',
        '            <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">',
        '                <div class="card-container border-slate-800 border-2">',
        '                    <h3 class="text-xl font-bold text-white mb-2">🦊 火狐浏览器</h3>',
        '                    <div class="flex gap-2"><input id="ff-pass" placeholder="面板密码" class="input-base"><input id="ff-port" placeholder="端口(25889)" class="input-base"></div>',
        '                    <div class="flex gap-2"><input id="ff-argo-domain" placeholder="固定域名(可选)" class="input-base"><input id="ff-argo-auth" placeholder="Argo Token(可选)" class="input-base"></div>',
        '                    <div id="ff-url-box" class="hidden mt-1 text-xs text-cyan-400 font-bold"></div>',
        '                    <div id="ff-log-box" class="log-box mt-2"></div>',
        '                    <div class="flex gap-2 mt-2"><button onclick="startApp(\'firefox\')" class="btn-primary flex-1">启动</button><button onclick="stopApp(\'firefox\')" class="bg-gray-800 text-white rounded-lg px-4 font-bold">停止</button></div>',
        '                </div>',
        '                <div class="card-container border-slate-800 border-2">',
        '                    <h3 class="text-xl font-bold text-white mb-2">🎵 音乐加速</h3>',
        '                    <div class="flex gap-2"><input id="m-uuid" placeholder="UUID" class="input-base"><input id="m-cfip" placeholder="优选 IP" class="input-base"></div>',
        '                    <div id="music-log-box" class="log-box mt-2"></div>',
        '                    <div class="flex gap-2 mt-2"><button onclick="startApp(\'music\')" class="btn-primary flex-1">启动</button><button onclick="stopApp(\'music\')" class="bg-gray-800 text-white rounded-lg px-4 font-bold">停止</button></div>',
        '                </div>',
        '                <div class="card-container border-slate-800 border-2">',
        '                    <h3 class="text-xl font-bold text-white mb-2">🟢 哪吒探针 V1</h3>',
        '                    <div class="flex gap-2"><input id="nz-server" placeholder="服务器 IP" class="input-base"><input id="nz-port" placeholder="通信端口" class="input-base"></div>',
        '                    <input id="nz-secret" placeholder="Secret 通信密钥" class="input-base">',
        '                    <div id="nezha-log-box" class="log-box mt-2"></div>',
        '                    <div class="flex gap-2 mt-2"><button onclick="startApp(\'nezha\')" class="btn-primary flex-1">部署启动</button><button onclick="stopApp(\'nezha\')" class="bg-gray-800 text-white rounded-lg px-4 font-bold">停止</button></div>',
        '                </div>',
        '                <div class="card-container border-slate-800 border-2">',
        '                    <h3 class="text-xl font-bold text-white mb-2">🛡️ Vmess 代理 + Argo隧道</h3>',
        '                    <div class="flex gap-2"><input id="px-port" placeholder="本地监听端口(如1080)" class="input-base"><input id="px-uuid" placeholder="UUID (留空自动)" class="input-base"></div>',
        '                    <div class="flex gap-2"><input id="px-argo-domain" placeholder="固定域名(可选)" class="input-base"><input id="px-argo-auth" placeholder="Argo Token(可选)" class="input-base"></div>',
        '                    <div id="proxy-url-box" class="hidden mt-1 text-xs text-emerald-400 font-bold"></div>',
        '                    <div id="proxy-log-box" class="log-box mt-2"></div>',
        '                    <div class="flex gap-2 mt-2"><button onclick="startApp(\'proxy\')" class="btn-primary flex-1">启动配置并穿透</button><button onclick="stopApp(\'proxy\')" class="bg-gray-800 text-white rounded-lg px-4 font-bold">关闭</button></div>',
        '                </div>',
        '            </div>',
        '        </div>',

        '        ',
        '        <div id="view-system" class="view-content">',
        '            <div class="card-container border-slate-800 p-8">',
        '                <h2 class="text-2xl font-bold text-white mb-6">⚙️ 系统运行状态</h2>',
        '                <div class="grid grid-cols-2 md:grid-cols-4 gap-6 mb-6" id="sys-stats-grid"></div>',
        '                <button onclick="rebootSystem()" class="bg-red-600 hover:bg-red-500 text-white py-3 rounded-xl font-bold w-full">⚠️ 立即重启主系统服务</button>',
        '            </div>',
        '        </div>',

        '        ',
        '        <div id="view-tasks" class="view-content">',
        '            <div class="card-container border-slate-800 p-8">',
        '                <h2 class="text-2xl font-bold text-white mb-6">📅 计划任务中心</h2>',
        '                <div class="flex gap-2 mb-6"><input id="t-name" placeholder="设定任务名称" class="input-base flex-1"><select id="t-type" class="input-base"><option value="restart_all">定时: 重启所有角色</option></select><input id="t-interval" type="number" placeholder="间隔分钟" class="input-base w-32"><button onclick="addTask()" class="btn-primary">添加</button></div>',
        '                <div id="task-list" class="space-y-2 max-h-60 overflow-y-auto"></div>',
        '            </div>',
        '        </div>',
        '    </div>',

        '    ',
        '    <div id="mem-bar" class="fixed bottom-6 right-6 p-4 bg-[#111827] border border-[#1f2937] rounded-xl flex items-center gap-4 z-40 shadow-2xl shadow-black">',
        '        <div class="flex flex-col items-center justify-center">',
        '            <span id="mem-percent" class="text-xl font-black text-white tracking-tight">0.0%</span>',
        '            <span class="text-[9px] font-bold text-slate-500 uppercase tracking-widest">RAM</span>',
        '        </div>',
        '        <div class="w-28 h-2 bg-[#030712] rounded-full overflow-hidden shadow-inner border border-[#1f2937]">',
        '            <div id="mem-progress" class="h-full bg-[#3b82f6] transition-all duration-700 rounded-full" style="width: 0%"></div>',
        '        </div>',
        '    </div>',

        '    <script>',
        '        function switchTab(tab) {',
        '            document.querySelectorAll(".view-content").forEach(function(el) { el.classList.remove("active"); });',
        '            document.querySelectorAll(".nav-tab").forEach(function(el) { el.classList.remove("active"); });',
        '            document.getElementById("view-" + tab).classList.add("active");',
        '            document.getElementById("tab-" + tab).classList.add("active");',
        '            if (tab === "apps") updateApps(); if (tab === "system") loadSys(); if (tab === "tasks") loadTasks();',
        '        }',
        '        let drafts = {};',
        '        function saveDraft(id, k, v) { drafts[id]=drafts[id]||{}; drafts[id][k]=v; }',
        '        function getDraft(id, k, fb) { return (drafts[id] && drafts[id][k]!==undefined) ? drafts[id][k] : (fb||""); }',
        
        '        async function updateUI(force) {',
        '            if (!force && document.activeElement && document.activeElement.tagName === "INPUT") return;',
        '            const r = await fetch("/api/bots"); const d = await r.json();',
        '            const openDetails = Array.from(document.querySelectorAll("details[open]")).map(function(el){ return el.id; });',
        '            let html = "";',
        '            for(let i=0; i<d.bots.length; i++) {',
        '                let b = d.bots[i]; b.settings.pterodactyl = b.settings.pterodactyl || {};',
        '                let isOnline = b.status === "在线";',
        '                let borderClass = isOnline ? "border-online" : "border-offline";',
        '                let statusBadge = isOnline ? "<span class=\\"bg-emerald-900 text-emerald-400 px-2 py-0.5 rounded text-[10px] flex items-center gap-1 font-bold\\"><span class=\\"w-1.5 h-1.5 rounded-full bg-emerald-500\\"></span>在线</span>" : "<span class=\\"bg-red-900 text-red-400 px-2 py-0.5 rounded text-[10px] flex items-center gap-1 font-bold\\"><span class=\\"w-1.5 h-1.5 rounded-full bg-red-500\\"></span>离线</span>";',
        '                let aiClass = b.settings.ai ? "toggle-on" : "toggle-off";',
        '                let walkClass = b.settings.walk ? "toggle-on" : "toggle-off";',
        '                let chatClass = b.settings.chat ? "toggle-on" : "toggle-off";',
        '                let logsHtml = b.logs.map(function(l) { return "<div class=\\"mb-1 " + l.color + "\\">[" + l.time + "] " + l.msg + "</div>"; }).join("");',
        
        '                let card = "<div class=\\"card-container " + borderClass + "\\">";',
        '                card += "<div class=\\"flex justify-between items-start\\"><div class=\\"flex flex-col\\"><div class=\\"flex items-center gap-2\\"><h3 class=\\"text-xl font-bold text-white\\">" + b.username + "</h3>" + statusBadge + "</div><div class=\\"text-[11px] text-slate-500 mt-1 font-mono\\">" + b.host + ":" + b.port + "</div></div><button onclick=\\"removeBot(\\&#39;" + b.id + "\\&#39;)\\" class=\\"text-slate-500 hover:text-white text-xl leading-none\\">✕</button></div>";',
        '                card += "<div class=\\"log-box\\">" + logsHtml + "</div>";',
        '                card += "<div class=\\"grid grid-cols-3 gap-3\\">";',
        '                card += "<button onclick=\\"toggle(\\&#39;" + b.id + "\\&#39;, \\&#39;ai\\&#39;)\\" class=\\"toggle-btn " + aiClass + "\\">👁️ AI</button>";',
        '                card += "<button onclick=\\"toggle(\\&#39;" + b.id + "\\&#39;, \\&#39;walk\\&#39;)\\" class=\\"toggle-btn " + walkClass + "\\">👣 巡逻</button>";',
        '                card += "<button onclick=\\"toggle(\\&#39;" + b.id + "\\&#39;, \\&#39;chat\\&#39;)\\" class=\\"toggle-btn " + chatClass + "\\">💬 喊话</button>";',
        '                card += "</div>";',
        
        '                card += "<details id=\\"adv-" + b.id + "\\" class=\\"mt-1\\"><summary class=\\"text-[10px] text-slate-500 cursor-pointer list-none\\">⚙️ 展开高级配置</summary>";',
        '                card += "<div class=\\"mt-3 space-y-2\\"><div class=\\"flex gap-2\\"><input id=\\"m-" + b.id + "\\" type=\\"number\\" placeholder=\\"分\\" class=\\"input-base text-xs p-1\\"><button onclick=\\"setTimer(\\&#39;" + b.id + "\\&#39;, document.getElementById(\\&#39;m-" + b.id + "\\&#39;).value, \\&#39;min\\&#39;)\\" class=\\"bg-slate-700 text-white px-2 rounded text-xs\\">设分</button><input id=\\"h-" + b.id + "\\" type=\\"number\\" placeholder=\\"时\\" class=\\"input-base text-xs p-1\\"><button onclick=\\"setTimer(\\&#39;" + b.id + "\\&#39;, document.getElementById(\\&#39;h-" + b.id + "\\&#39;).value, \\&#39;hour\\&#39;)\\" class=\\"bg-slate-700 text-white px-2 rounded text-xs\\">设时</button><button onclick=\\"restartNow(\\&#39;" + b.id + "\\&#39;)\\" class=\\"bg-red-600 text-white px-2 rounded text-xs ml-auto\\">重启</button></div>";',
        '                card += "<div class=\\"grid grid-cols-2 gap-2 mt-2\\"><input id=\\"u-" + b.id + "\\" placeholder=\\"翼龙 URL\\" class=\\"input-base text-xs p-1.5\\" value=\\"" + getDraft(b.id, "url", b.settings.pterodactyl.url) + "\\" oninput=\\"saveDraft(\\&#39;"+b.id+"\\&#39;, \\&#39;url\\&#39;, this.value)\\"><input id=\\"s-" + b.id + "\\" placeholder=\\"Server ID\\" class=\\"input-base text-xs p-1.5\\" value=\\"" + getDraft(b.id, "sid", b.settings.pterodactyl.id) + "\\" oninput=\\"saveDraft(\\&#39;"+b.id+"\\&#39;, \\&#39;sid\\&#39;, this.value)\\"><input id=\\"k-" + b.id + "\\" type=\\"password\\" placeholder=\\"API Key\\" class=\\"input-base text-xs p-1.5\\" value=\\"" + getDraft(b.id, "key", b.settings.pterodactyl.key) + "\\" oninput=\\"saveDraft(\\&#39;"+b.id+"\\&#39;, \\&#39;key\\&#39;, this.value)\\"><input id=\\"d-" + b.id + "\\" placeholder=\\"同步目录 /\\" class=\\"input-base text-xs p-1.5\\" value=\\"" + getDraft(b.id, "ddir", b.settings.pterodactyl.defaultDir) + "\\" oninput=\\"saveDraft(\\&#39;"+b.id+"\\&#39;, \\&#39;ddir\\&#39;, this.value)\\"></div>";',
        '                card += "<div class=\\"flex gap-2 mt-1\\"><button onclick=\\"savePto(\\&#39;" + b.id + "\\&#39;)\\" class=\\"bg-slate-700 text-white py-1 rounded text-xs flex-1\\">保存</button><button onclick=\\"document.getElementById(\\&#39;f-" + b.id + "\\&#39;).click()\\" class=\\"btn-primary py-1 text-xs flex-1\\">上传</button><input type=\\"file\\" id=\\"f-" + b.id + "\\" class=\\"hidden\\" onchange=\\"uploadFile(\\&#39;" + b.id + "\\&#39;, this)\\"><button onclick=\\"toggleGuard(\\&#39;" + b.id + "\\&#39;)\\" class=\\"flex-1 rounded text-xs font-bold " + (b.settings.pterodactyl.guard?"bg-emerald-600 text-white":"bg-slate-800 text-slate-400") + "\\">守护</button></div></div></details>";',
        '                card += "</div>";',
        '                html += card;',
        '            }',
        '            document.getElementById("list").innerHTML = html;',
        '            openDetails.forEach(function(id){ const el = document.getElementById(id); if(el) el.open = true; });',
        '        }',
        
        '        async function addBot() { await fetch("/api/bots", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ host: document.getElementById("h").value, username: document.getElementById("u").value })}); updateUI(true); }',
        '        async function removeBot(id) { if(confirm("确认移除？")) { await fetch("/api/bots/"+id, { method: "DELETE" }); updateUI(true); } }',
        '        async function toggle(id, type) { await fetch("/api/bots/"+id+"/toggle", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ type: type })}); updateUI(true); }',
        '        async function setTimer(id, v, u) { await fetch("/api/bots/"+id+"/set-timer", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ value: v, unit: u })}); updateUI(true); }',
        '        async function restartNow(id) { await fetch("/api/bots/"+id+"/restart-now", { method: "POST" }); updateUI(true); }',
        '        async function toggleGuard(id) { await fetch("/api/bots/"+id+"/toggle-guard", { method: "POST" }); updateUI(true); }',
        '        async function savePto(id) { const d = { url: document.getElementById("u-"+id).value, id: document.getElementById("s-"+id).value, key: document.getElementById("k-"+id).value, defaultDir: document.getElementById("d-"+id).value }; await fetch("/api/bots/"+id+"/pto-config", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify(d)}); updateUI(true); }',
        '        async function uploadFile(id, input) { if (!input.files[0]) return; const fd = new FormData(); fd.append("file", input.files[0]); const r = await fetch("/api/bots/" + id + "/upload", { method: "POST", body: fd }); alert(r.ok ? "✅ 载荷发送成功" : "❌ 发送失败"); input.value=""; }',

        '        async function updateApps() {',
        '            ["firefox", "music", "nezha", "proxy"].forEach(async function(app) {',
        '                try { const r = await fetch("/api/apps/" + app + "/status"); const d = await r.json(); const box = document.getElementById(app + "-log-box");',
        '                    if(box) box.innerHTML = d.logs.length > 0 ? d.logs.map(function(l){ return "<div class=\\"mb-1 " + l.color + "\\">["+l.time+"] "+l.msg+"</div>"; }).join("") : "<div class=\\"text-center mt-6 text-slate-600\\">STANDBY</div>";',
        '                    const urlBox = document.getElementById(app + "-url-box");',
        '                    if(urlBox) { if(d.url) { urlBox.style.display="block"; urlBox.innerHTML="🔗 <a href=\\""+d.url+"\\" target=\\"_blank\\" class=\\"underline text-emerald-400\\">"+d.url+"</a>"; } else { urlBox.style.display="none"; } }',
        '                } catch(e) {}',
        '            });',
        '        }',
        '        async function startApp(app) {',
        '            let p = {};',
        '            if(app==="firefox") p = { FF_PASS: document.getElementById("ff-pass").value, FF_PORT: document.getElementById("ff-port").value, ARGO_DOMAIN: document.getElementById("ff-argo-domain")?.value||"", ARGO_AUTH: document.getElementById("ff-argo-auth")?.value||"" };',
        '            if(app==="music") p = { UUID: document.getElementById("m-uuid").value, CFIP: document.getElementById("m-cfip").value };',
        '            if(app==="nezha") p = { SERVER: document.getElementById("nz-server").value, PORT: document.getElementById("nz-port").value, SECRET: document.getElementById("nz-secret").value };',
        '            if(app==="proxy") p = { PORT: document.getElementById("px-port").value, UUID: document.getElementById("px-uuid").value, ARGO_DOMAIN: document.getElementById("px-argo-domain")?.value||"", ARGO_AUTH: document.getElementById("px-argo-auth")?.value||"" };',
        '            await fetch("/api/apps/"+app+"/start", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ params: p }) }); updateApps();',
        '        }',
        '        async function stopApp(app) { await fetch("/api/apps/"+app+"/stop", { method: "POST" }); updateApps(); }',
        
        '        async function loadSys() { ',
        '            const r = await fetch("/api/system/status"); const d = await r.json(); ',
        '            document.getElementById("sys-stats-grid").innerHTML = "<div class=\\"bg-gray-900 p-4 rounded-xl text-center\\"><div class=\\"text-xs text-slate-500 mb-1\\">内存</div><div class=\\"text-2xl font-bold text-cyan-400\\">" + d.percent + "%</div></div><div class=\\"bg-gray-900 p-4 rounded-xl text-center\\"><div class=\\"text-xs text-slate-500 mb-1\\">架构</div><div class=\\"text-2xl font-bold text-emerald-400\\">" + d.arch + "</div></div><div class=\\"bg-gray-900 p-4 rounded-xl text-center\\"><div class=\\"text-xs text-slate-500 mb-1\\">核心</div><div class=\\"text-2xl font-bold text-purple-400\\">" + d.cpus + " 核</div></div><div class=\\"bg-gray-900 p-4 rounded-xl text-center\\"><div class=\\"text-xs text-slate-500 mb-1\\">运行</div><div class=\\"text-2xl font-bold text-orange-400\\">" + Math.floor(d.uptime/3600) + " h</div></div>";',
        '        }',
        '        async function rebootSystem() { if(confirm("执行重启？")) fetch("/api/system/reboot", {method:"POST"}); }',
        
        '        async function loadTasks() { ',
        '            const r = await fetch("/api/tasks"); const d = await r.json(); ',
        '            document.getElementById("task-list").innerHTML = d.tasks.length > 0 ? d.tasks.map(function(t){ return "<div class=\\"bg-gray-900 p-4 rounded-xl flex justify-between items-center\\"><div><div class=\\"font-bold text-white mb-1\\">" + t.name + "</div><div class=\\"text-xs text-slate-400\\">" + t.type + " | 每" + t.interval + "分钟</div></div><button onclick=\\"removeTask(\\&#39;" + t.id + "\\&#39;)\\" class=\\"text-red-400 font-bold\\">删除</button></div>"; }).join("") : "";',
        '        }',
        '        async function addTask() { await fetch("/api/tasks", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ name: document.getElementById("t-name").value, type: document.getElementById("t-type").value, interval: document.getElementById("t-interval").value }) }); loadTasks(); }',
        '        async function removeTask(id) { await fetch("/api/tasks/"+id, { method: "DELETE" }); loadTasks(); }',
        
        '        async function updateRealtimeMem() { ',
        '            try { ',
        '                const r = await fetch("/api/system/status"); const d = await r.json(); ',
        '                document.getElementById("mem-percent").innerText = d.percent + "%"; ',
        '                document.getElementById("mem-progress").style.width = d.percent + "%"; ',
        '                const prog = document.getElementById("mem-progress"); ',
        '                if(parseFloat(d.percent) > 80) prog.className = "h-full bg-[#ef4444] transition-all duration-700 rounded-full"; ',
        '                else prog.className = "h-full bg-[#3b82f6] transition-all duration-700 rounded-full"; ',
        '            } catch(e){} ',
        '        }',

        '        setInterval(function() { ',
        '            updateUI(false); updateRealtimeMem();',
        '            if(document.getElementById("view-apps").classList.contains("active")) updateApps(); ',
        '            if(document.getElementById("view-system").classList.contains("active")) loadSys(); ',
        '        }, 3000);',
        '        updateUI(true); updateRealtimeMem();',
        '    </script>',
        '</body>',
        '</html>'
    ].join('\n');
    res.send(htmlLines);
});

const PORT = process.env.SERVER_PORT || 4681;
const server = app.listen(PORT, '0.0.0.0', () => { 
    console.log(`\n✅ Pathfinder PRO 已启动，原版UI、监控悬浮窗 及 V0.20.5 经典探针 均已就绪！`);
    console.log(`🌐 访问地址: http://127.0.0.1:${PORT}`);
    console.log(`🔑 默认账号: admin  |  默认密码: 123456\n`);
    
    if (fsSync.existsSync(CONFIG_FILE)) { 
        try { 
            const saved = JSON.parse(fsSync.readFileSync(CONFIG_FILE)); 
            saved.forEach(b => createSmartBot('bot_'+Math.random().toString(36).substr(2,5), b.host, b.port, b.username, b.logs || [], b.settings)); 
        } catch (e) {} 
    } 
    if (fsSync.existsSync(TASKS_FILE)) { 
        try { 
            const savedTasks = JSON.parse(fsSync.readFileSync(TASKS_FILE)); 
            savedTasks.forEach(t => globalTasks.set(t.id, t)); 
        } catch (e) {} 
    }
});

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`\n❌ 启动失败：端口 ${PORT} 已被占用！`);
        console.error(`👉 解决办法：在终端运行 \`killall node\` 结束之前的进程，或者在代码底部把 4681 换成 8080。\n`);
        process.exit(1);
    }
});