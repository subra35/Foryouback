const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const MEMORIES_FILE = path.join(__dirname, 'memories.json');
const NOTES_FILE = path.join(__dirname, 'notes.json');
const STATIC_DIR = path.join(__dirname, '..');

app.use(express.json());

app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

function readFile(file) {
    if (!fs.existsSync(file)) return [];
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return []; }
}
function writeFile(file, data) {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// ── Memories ──────────────────────────────────────────────
app.get('/api/memories', (req, res) => res.json(readFile(MEMORIES_FILE)));

app.post('/api/memories', (req, res) => {
    const { url, cloudId, caption, timestamp, id } = req.body;
    if (!url) return res.status(400).json({ error: 'url is required' });
    const list = readFile(MEMORIES_FILE);
    const item = { id: id || (Date.now() + Math.random()), url, cloudId, caption: caption || '', timestamp };
    list.push(item);
    writeFile(MEMORIES_FILE, list);
    res.json(item);
});

app.put('/api/memories/:id', (req, res) => {
    let list = readFile(MEMORIES_FILE);
    const idx = list.findIndex(m => String(m.id) === String(req.params.id));
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    list[idx] = { ...list[idx], caption: req.body.caption };
    writeFile(MEMORIES_FILE, list);
    res.json(list[idx]);
});

app.delete('/api/memories/:id', (req, res) => {
    let list = readFile(MEMORIES_FILE).filter(m => String(m.id) !== String(req.params.id));
    writeFile(MEMORIES_FILE, list);
    res.json({ success: true });
});

// ── Notes ─────────────────────────────────────────────────
app.get('/api/notes', (req, res) => res.json(readFile(NOTES_FILE)));

app.post('/api/notes', (req, res) => {
    const { text, category } = req.body;
    if (!text) return res.status(400).json({ error: 'text is required' });
    const list = readFile(NOTES_FILE);
    const item = { id: Date.now() + Math.random(), text, category: category || 'love', createdAt: new Date().toISOString() };
    list.push(item);
    writeFile(NOTES_FILE, list);
    res.json(item);
});

app.put('/api/notes/:id', (req, res) => {
    let list = readFile(NOTES_FILE);
    const idx = list.findIndex(n => String(n.id) === String(req.params.id));
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    list[idx] = { ...list[idx], text: req.body.text, category: req.body.category };
    writeFile(NOTES_FILE, list);
    res.json(list[idx]);
});

app.delete('/api/notes/:id', (req, res) => {
    let list = readFile(NOTES_FILE).filter(n => String(n.id) !== String(req.params.id));
    writeFile(NOTES_FILE, list);
    res.json({ success: true });
});

// ── Static ────────────────────────────────────────────────
app.use(express.static(STATIC_DIR));
app.get('/explore',            (req, res) => res.sendFile(path.join(STATIC_DIR, 'explore', 'index.html')));
app.get('/explore/',           (req, res) => res.sendFile(path.join(STATIC_DIR, 'explore', 'index.html')));
app.get('/explore/memories',   (req, res) => res.sendFile(path.join(STATIC_DIR, 'explore', 'memories', 'index.html')));
app.get('/explore/memories/',  (req, res) => res.sendFile(path.join(STATIC_DIR, 'explore', 'memories', 'index.html')));
app.get('/explore/anniversary',   (req, res) => res.sendFile(path.join(STATIC_DIR, 'explore', 'anniversary', 'index.html')));
app.get('/explore/anniversary/', (req, res) => res.sendFile(path.join(STATIC_DIR, 'explore', 'anniversary', 'index.html')));

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
