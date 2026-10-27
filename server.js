require('dotenv').config();
const express = require('express'), mongoose = require('mongoose'), bcrypt = require('bcryptjs'),
  jwt = require('jsonwebtoken'), path = require('path');
const { JWT_SECRET, PORT = 3000, HOD_PASSWORD } = process.env;
const HOD_EMAIL = String(process.env.HOD_EMAIL || '').trim().toLowerCase();
const MONGO_URI = process.env.MONGO_URI || (process.env.VERCEL ? '' : 'mongodb://127.0.0.1:27017/mentordesk');

const { ObjectId } = mongoose.Schema.Types;
const User = mongoose.model('User', new mongoose.Schema({
  name: String,
  email: { type: String, unique: true, lowercase: true, trim: true },
  hash: String,
  role: { type: String, enum: ['mentee', 'mentor', 'hod'], default: 'mentee' },
  mentor: { type: ObjectId, ref: 'User', default: null, index: true }, // many mentees -> one mentor
  profile: {
    roll: String, dept: String, year: String, contact: String, hobbies: String, goals: String, about: String,
    marks: [{ subject: String, got: Number, max: Number }]
  }
}, { timestamps: true }));
const Note = mongoose.model('Note', new mongoose.Schema({
  mentee: { type: ObjectId, ref: 'User', index: true },
  author: { type: ObjectId, ref: 'User' },
  kind: { type: String, enum: ['Note', 'Recommendation'], default: 'Note' },
  text: String
}, { timestamps: true }));

const app = express();
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Connect lazily and reuse the connection, so this also works on serverless hosts like Vercel
let conn;
function connect() {
  if (!conn) conn = mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 8000 }).then(async () => {
    if (HOD_EMAIL && HOD_PASSWORD) {
      let hod = await User.findOne({ role: 'hod' });
      if (!hod) hod = new User({ name: 'HOD', role: 'hod' });
      hod.email = HOD_EMAIL;
      hod.hash = await bcrypt.hash(HOD_PASSWORD, 10);
      await hod.save();
    }
  }).catch(e => { conn = null; throw e; });
  return conn;
}
app.use('/api', async (req, res, next) => {
  if (!JWT_SECRET) return res.status(500).json({ error: 'Server setup incomplete: JWT_SECRET is not set.' });
  if (!MONGO_URI) return res.status(500).json({ error: 'Server setup incomplete: MONGO_URI is not set.' });
  try { await connect(); next(); }
  catch (e) { console.error('MongoDB connection failed:', e.message); res.status(500).json({ error: 'Cannot reach the database. Check MONGO_URI and network access.' }); }
});

const sign = u => jwt.sign({ id: u.id }, JWT_SECRET, { expiresIn: '7d' });
const pub = u => ({ id: u.id, name: u.name, email: u.email, role: u.role, mentor: u.mentor, profile: u.profile });
const s = (v, n = 500) => String(v ?? '').trim().slice(0, n);

const auth = (...roles) => async (req, res, next) => {
  let u;
  try {
    const t = (req.headers.authorization || '').replace('Bearer ', '');
    u = await User.findById(jwt.verify(t, JWT_SECRET).id);
  } catch { /* handled below */ }
  if (!u) return res.status(401).json({ error: 'Sign in again.' });
  if (roles.length && !roles.includes(u.role)) return res.status(403).json({ error: 'You do not have access to this.' });
  req.user = u; next();
};

/* ---- auth ---- */
app.post('/api/auth/register', async (req, res) => {   // self sign-up creates mentees only
  const name = s(req.body.name, 100), email = s(req.body.email, 200).toLowerCase(), password = s(req.body.password, 200);
  if (!name || !email || password.length < 8) return res.status(400).json({ error: 'Enter your name, an email and a password of at least 8 characters.' });
  if (await User.exists({ email })) return res.status(409).json({ error: 'That email already has an account.' });
  const u = await User.create({ name, email, hash: await bcrypt.hash(password, 10), role: 'mentee' });
  res.json({ token: sign(u), user: pub(u) });
});
app.post('/api/auth/login', async (req, res) => {
  const u = await User.findOne({ email: s(req.body.email, 200).toLowerCase() });
  if (!u || !(await bcrypt.compare(s(req.body.password, 200), u.hash))) return res.status(401).json({ error: 'Email or password is incorrect.' });
  res.json({ token: sign(u), user: pub(u) });
});
app.get('/api/me', auth(), async (req, res) => {
  await req.user.populate('mentor', 'name');
  res.json({ user: pub(req.user) });
});

/* ---- mentee ---- */
app.put('/api/me/profile', auth('mentee'), async (req, res) => {
  const b = req.body, marks = (Array.isArray(b.marks) ? b.marks : []).slice(0, 30).map(m => {
    const max = Math.max(1, +m.max || 100); return { subject: s(m.subject, 80), got: Math.min(max, Math.max(0, +m.got || 0)), max };
  }).filter(m => m.subject);
  req.user.name = s(b.name, 100) || req.user.name;
  req.user.profile = { roll: s(b.roll, 40), dept: s(b.dept, 80), year: s(b.year, 40), contact: s(b.contact, 120),
    hobbies: s(b.hobbies, 300), goals: s(b.goals, 300), about: s(b.about, 2000), marks };
  await req.user.save();
  res.json({ user: pub(req.user) });
});
app.get('/api/me/notes', auth('mentee'), async (req, res) =>
  res.json(await Note.find({ mentee: req.user.id }).sort('-createdAt')));

/* ---- mentor + HOD ---- */
app.get('/api/mentees', auth('mentor', 'hod'), async (req, res) => {
  const q = { role: 'mentee' };
  if (req.user.role === 'mentor') q.mentor = req.user.id;           // a mentor sees only their own mentees
  res.json((await User.find(q).sort('name')).map(pub));
});
async function loadMentee(req, res) {
  const m = await User.findOne({ _id: req.params.id, role: 'mentee' }).catch(() => null);
  if (!m) { res.status(404).json({ error: 'Mentee not found.' }); return null; }
  if (req.user.role === 'mentor' && String(m.mentor) !== req.user.id) { res.status(403).json({ error: 'This mentee is not assigned to you.' }); return null; }
  return m;
}
app.get('/api/mentees/:id', auth('mentor', 'hod'), async (req, res) => {
  const m = await loadMentee(req, res); if (!m) return;
  res.json({ mentee: pub(m), notes: await Note.find({ mentee: m.id }).sort('-createdAt') });
});
app.post('/api/mentees/:id/notes', auth('mentor'), async (req, res) => {   // HOD is read-only
  const m = await loadMentee(req, res); if (!m) return;
  const text = s(req.body.text, 3000);
  if (!text) return res.status(400).json({ error: 'Write something first.' });
  res.json(await Note.create({ mentee: m.id, author: req.user.id, text, kind: req.body.kind === 'Recommendation' ? 'Recommendation' : 'Note' }));
});

/* ---- HOD only ---- */
app.get('/api/mentors', auth('hod'), async (req, res) =>
  res.json((await User.find({ role: 'mentor' }).sort('name')).map(pub)));
app.post('/api/mentors', auth('hod'), async (req, res) => {
  const name = s(req.body.name, 100), email = s(req.body.email, 200).toLowerCase(), password = s(req.body.password, 200);
  if (!name || !email || password.length < 8) return res.status(400).json({ error: 'Enter a name, an email and a temporary password of at least 8 characters.' });
  if (await User.exists({ email })) return res.status(409).json({ error: 'That email already has an account.' });
  res.json(pub(await User.create({ name, email, hash: await bcrypt.hash(password, 10), role: 'mentor' })));
});
app.put('/api/mentees/:id/mentor', auth('hod'), async (req, res) => {
  const m = await User.findOne({ _id: req.params.id, role: 'mentee' }).catch(() => null);
  if (!m) return res.status(404).json({ error: 'Mentee not found.' });
  if (req.body.mentor && !(await User.exists({ _id: req.body.mentor, role: 'mentor' }))) return res.status(400).json({ error: 'Choose a valid mentor.' });
  m.mentor = req.body.mentor || null; await m.save();
  res.json(pub(m));
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));
app.use((e, req, res, next) => { console.error(e); res.status(500).json({ error: 'Server error. Try again.' }); });

module.exports = app;
if (require.main === module) app.listen(PORT, () => console.log(`Mentor Desk running at http://localhost:${PORT}`));
