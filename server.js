const express = require('express');
const fs = require('fs');
const path = require('path');
const webpush = require('web-push');

const app = express();
const PORT = process.env.PORT || 3000;
const MEMORIES_FILE    = path.join(__dirname, 'memories.json');
const NOTES_FILE       = path.join(__dirname, 'notes.json');
const COMMENTS_FILE    = path.join(__dirname, 'comments.json');
const SUBS_FILE        = path.join(__dirname, 'subscriptions.json');
const VAPID_FILE       = path.join(__dirname, 'vapid.json');
const STATIC_DIR       = path.join(__dirname, '..');

app.use(express.json());

app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

// ── File helpers ───────────────────────────────────────────
function readFile(file) {
    if (!fs.existsSync(file)) return [];
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return []; }
}
function writeFile(file, data) {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
}
function makeId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ── Startup migration: persist ids/replies/reactions ───────
(function migrateCommentsFile() {
    const all = readFile(COMMENTS_FILE);
    let changed = false;
    all.forEach(entry => {
        if (!Array.isArray(entry.comments)) return;
        entry.comments.forEach(c => {
            if (!c.id)        { c.id = makeId();  changed = true; }
            if (!c.replies)   { c.replies = [];   changed = true; }
            if (!c.reactions) { c.reactions = {}; changed = true; }
            // migrate old {emoji: count} → {emoji: [names]}
            Object.keys(c.reactions).forEach(emoji => {
                if (typeof c.reactions[emoji] === 'number') {
                    c.reactions[emoji] = Array(c.reactions[emoji]).fill('Someone');
                    changed = true;
                }
            });
        });
    });
    if (changed) writeFile(COMMENTS_FILE, all);
})();

// ── VAPID setup ────────────────────────────────────────────
let vapidKeys;
if (fs.existsSync(VAPID_FILE)) {
    vapidKeys = JSON.parse(fs.readFileSync(VAPID_FILE, 'utf8'));
} else {
    vapidKeys = webpush.generateVAPIDKeys();
    fs.writeFileSync(VAPID_FILE, JSON.stringify(vapidKeys, null, 2));
}
webpush.setVapidDetails('mailto:love@local.app', vapidKeys.publicKey, vapidKeys.privateKey);

app.get('/api/vapid-key', (req, res) => res.json({ publicKey: vapidKeys.publicKey }));

// ── Push subscription ──────────────────────────────────────
app.post('/api/push/subscribe', (req, res) => {
    const sub = req.body;
    if (!sub || !sub.endpoint) return res.status(400).json({ error: 'Invalid subscription' });
    let subs = readFile(SUBS_FILE);
    const exists = subs.some(s => s.endpoint === sub.endpoint);
    if (!exists) { subs.push(sub); writeFile(SUBS_FILE, subs); }
    res.json({ success: true });
});

app.delete('/api/push/subscribe', (req, res) => {
    const { endpoint } = req.body;
    let subs = readFile(SUBS_FILE).filter(s => s.endpoint !== endpoint);
    writeFile(SUBS_FILE, subs);
    res.json({ success: true });
});

// ── Custom push message ─────────────────────────────────────
app.post('/api/push/send', async (req, res) => {
    const { title, body } = req.body;
    if (!title && !body) return res.status(400).json({ error: 'title or body required' });
    await sendPush({
        title: title || '💌 For My Love',
        body: body || '',
        icon: '/notif-icon.png',
        tag: 'custom-message'
    });
    res.json({ success: true });
});

async function sendPush(payload) {
    const subs = readFile(SUBS_FILE);
    const dead = [];
    for (const sub of subs) {
        try {
            await webpush.sendNotification(sub, JSON.stringify(payload));
        } catch (e) {
            if (e.statusCode === 410 || e.statusCode === 404) dead.push(sub.endpoint);
        }
    }
    if (dead.length) {
        const alive = readFile(SUBS_FILE).filter(s => !dead.includes(s.endpoint));
        writeFile(SUBS_FILE, alive);
    }
}

// ── Memories ──────────────────────────────────────────────
app.get('/api/memories', (req, res) => res.json(readFile(MEMORIES_FILE)));

app.post('/api/memories', async (req, res) => {
    const { url, cloudId, caption, timestamp, id, uploader } = req.body;
    if (!url) return res.status(400).json({ error: 'url is required' });
    const list = readFile(MEMORIES_FILE);
    const item = { id: id || makeId(), url, cloudId, caption: caption || '', uploader: uploader || '', timestamp };
    list.push(item);
    writeFile(MEMORIES_FILE, list);
    res.json(item);
    sendPush({ title: '📸 New Memory Added!', body: `${uploader || 'Someone'} uploaded a new photo`, icon: '/notif-icon.png', tag: 'new-memory' });
});

app.put('/api/memories/:id', (req, res) => {
    let list = readFile(MEMORIES_FILE);
    const idx = list.findIndex(m => String(m.id) === String(req.params.id));
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    list[idx] = { ...list[idx], caption: req.body.caption, uploader: req.body.uploader || list[idx].uploader };
    writeFile(MEMORIES_FILE, list);
    res.json(list[idx]);
});

app.delete('/api/memories/:id', (req, res) => {
    let list = readFile(MEMORIES_FILE).filter(m => String(m.id) !== String(req.params.id));
    writeFile(MEMORIES_FILE, list);
    res.json({ success: true });
});

// ── Comments (with replies + reactions) ───────────────────
function migrateComments(comments) {
    return comments.map(c => ({
        id: c.id || makeId(),
        name: c.name,
        text: c.text,
        timestamp: c.timestamp,
        replies: c.replies || [],
        reactions: c.reactions || {}
    }));
}

app.get('/api/comments/:memoryId', (req, res) => {
    const all = readFile(COMMENTS_FILE);
    const entry = all.find(e => String(e.memoryId) === String(req.params.memoryId));
    res.json(entry ? migrateComments(entry.comments) : []);
});

app.post('/api/comments/:memoryId', async (req, res) => {
    const { name, text } = req.body;
    if (!name || !text) return res.status(400).json({ error: 'name and text required' });
    let all = readFile(COMMENTS_FILE);
    let entry = all.find(e => String(e.memoryId) === String(req.params.memoryId));
    if (!entry) { entry = { memoryId: req.params.memoryId, comments: [] }; all.push(entry); }
    const comment = { id: makeId(), name, text, timestamp: new Date().toISOString(), replies: [], reactions: {} };
    entry.comments.push(comment);
    writeFile(COMMENTS_FILE, all);
    res.json(comment);
    sendPush({ title: '💬 New Comment!', body: `${name}: ${text}`, icon: '/notif-icon.png', tag: 'new-comment' });
});

// Reply to a comment
app.post('/api/comments/:memoryId/:commentId/reply', async (req, res) => {
    const { name, text } = req.body;
    if (!name || !text) return res.status(400).json({ error: 'name and text required' });
    let all = readFile(COMMENTS_FILE);
    const entry = all.find(e => String(e.memoryId) === String(req.params.memoryId));
    if (!entry) return res.status(404).json({ error: 'Memory comments not found' });
    const comment = entry.comments.find(c => c.id === req.params.commentId);
    if (!comment) return res.status(404).json({ error: 'Comment not found' });
    if (!comment.replies) comment.replies = [];
    const reply = { id: makeId(), name, text, timestamp: new Date().toISOString() };
    comment.replies.push(reply);
    writeFile(COMMENTS_FILE, all);
    res.json(reply);
    sendPush({ title: '↩️ New Reply!', body: `${name} replied: ${text}`, icon: '/notif-icon.png', tag: 'new-reply' });
});

// React to a comment (toggle emoji)
app.post('/api/comments/:memoryId/:commentId/react', async (req, res) => {
    const { emoji, name } = req.body;
    if (!emoji) return res.status(400).json({ error: 'emoji required' });
    let all = readFile(COMMENTS_FILE);
    const entry = all.find(e => String(e.memoryId) === String(req.params.memoryId));
    if (!entry) return res.status(404).json({ error: 'Memory comments not found' });
    const comment = entry.comments.find(c => c.id === req.params.commentId);
    if (!comment) return res.status(404).json({ error: 'Comment not found' });
    if (!comment.reactions) comment.reactions = {};
    if (!Array.isArray(comment.reactions[emoji])) comment.reactions[emoji] = [];
    comment.reactions[emoji].push(name || 'Someone');
    writeFile(COMMENTS_FILE, all);
    res.json({ reactions: comment.reactions });
    sendPush({ title: `${emoji} Reaction!`, body: `${name || 'Someone'} reacted ${emoji} to a comment`, icon: '/notif-icon.png', tag: 'new-reaction' });
});

// ── Notes ─────────────────────────────────────────────────
app.get('/api/notes', (req, res) => res.json(readFile(NOTES_FILE)));

app.post('/api/notes', async (req, res) => {
    const { text, category, uploader } = req.body;
    if (!text) return res.status(400).json({ error: 'text is required' });
    const list = readFile(NOTES_FILE);
    const item = { id: Date.now() + Math.random(), text, category: category || 'love', uploader: uploader || '', createdAt: new Date().toISOString() };
    list.push(item);
    writeFile(NOTES_FILE, list);
    res.json(item);
    sendPush({ title: '💌 New Love Note!', body: `${uploader || 'Someone'} added a note: "${text.slice(0, 60)}"`, icon: '/notif-icon.png', tag: 'new-note' });
});

app.put('/api/notes/:id', (req, res) => {
    let list = readFile(NOTES_FILE);
    const idx = list.findIndex(n => String(n.id) === String(req.params.id));
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    list[idx] = { ...list[idx], text: req.body.text, category: req.body.category, uploader: req.body.uploader || list[idx].uploader };
    writeFile(NOTES_FILE, list);
    res.json(list[idx]);
});

app.delete('/api/notes/:id', (req, res) => {
    let list = readFile(NOTES_FILE).filter(n => String(n.id) !== String(req.params.id));
    writeFile(NOTES_FILE, list);
    res.json({ success: true });
});

// ── Days Together Milestone ────────────────────────────────
app.post('/api/notify/milestone', async (req, res) => {
    const { days } = req.body;
    sendPush({ title: '🎉 Love Milestone!', body: `You've been together for ${days} days! 💕`, icon: '/notif-icon.png', tag: 'milestone' });
    res.json({ success: true });
});

// ── Download Proxy ────────────────────────────────────────
app.get('/api/download', async (req, res) => {
    const { url, name } = req.query;
    if (!url) return res.status(400).json({ error: 'url required' });
    try {
        const response = await fetch(url);
        if (!response.ok) return res.status(502).json({ error: 'Failed to fetch image' });
        const contentType = response.headers.get('content-type') || 'image/jpeg';
        const filename = name ? `memory-${name}.jpg` : 'memory-photo.jpg';
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Type', contentType);
        const buffer = Buffer.from(await response.arrayBuffer());
        res.send(buffer);
    } catch (e) {
        res.status(500).json({ error: 'Download failed' });
    }
});

// ── Static ────────────────────────────────────────────────
app.use(express.static(STATIC_DIR));
app.get('/explore',             (req, res) => res.sendFile(path.join(STATIC_DIR, 'explore', 'index.html')));
app.get('/explore/',            (req, res) => res.sendFile(path.join(STATIC_DIR, 'explore', 'index.html')));
app.get('/explore/memories',    (req, res) => res.sendFile(path.join(STATIC_DIR, 'explore', 'memories', 'index.html')));
app.get('/explore/memories/',   (req, res) => res.sendFile(path.join(STATIC_DIR, 'explore', 'memories', 'index.html')));
app.get('/explore/anniversary', (req, res) => res.sendFile(path.join(STATIC_DIR, 'explore', 'anniversary', 'index.html')));
app.get('/explore/anniversary/',(req, res) => res.sendFile(path.join(STATIC_DIR, 'explore', 'anniversary', 'index.html')));
app.get('/explore/birthday',    (req, res) => res.sendFile(path.join(STATIC_DIR, 'explore', 'birthday', 'index.html')));
app.get('/explore/birthday/',   (req, res) => res.sendFile(path.join(STATIC_DIR, 'explore', 'birthday', 'index.html')));
app.get('/birthday-cake.html',  (req, res) => res.sendFile(path.join(STATIC_DIR, 'birthday-cake.html')));

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
