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
    marks: [{ subject: String, got: Number, max: Number }],
    status: { type: String, enum: ['draft', 'submitted', 'endorsed', 'changes-requested'], default: 'draft' },
    endorsementRemark: String
  }
}, { timestamps: true }));
const Note = mongoose.model('Note', new mongoose.Schema({
  mentee: { type: ObjectId, ref: 'User', index: true },
  author: { type: ObjectId, ref: 'User' },
  kind: { type: String, enum: ['Note', 'Recommendation'], default: 'Note' },
  text: String,
  visibility: { type: String, enum: ['shared', 'private'], default: 'shared' }
}, { timestamps: true }));
const Goal = mongoose.model('Goal', new mongoose.Schema({
  mentee: { type: ObjectId, ref: 'User', index: true }, author: { type: ObjectId, ref: 'User' },
  title: String, dueDate: Date, status: { type: String, enum: ['open', 'done'], default: 'open' }
}, { timestamps: true }));
const Meeting = mongoose.model('Meeting', new mongoose.Schema({
  mentee: { type: ObjectId, ref: 'User', index: true }, mentor: { type: ObjectId, ref: 'User' },
  scheduledAt: Date, topic: String, minutes: String
}, { timestamps: true }));
const AuditLog = mongoose.model('AuditLog', new mongoose.Schema({
  actor: { type: ObjectId, ref: 'User' }, action: String, target: { type: ObjectId, ref: 'User' },
  metadata: mongoose.Schema.Types.Mixed
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
      hod.email = HOD_EMAIL; hod.hash = await bcrypt.hash(HOD_PASSWORD, 10); await hod.save();
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
async function audit(actor, action, target, metadata = {}) {
  await AuditLog.create({ actor: actor?._id, action, target, metadata });
}

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
  req.user.profile = { ...req.user.profile?.toObject?.(), roll: s(b.roll, 40), dept: s(b.dept, 80), year: s(b.year, 40), contact: s(b.contact, 120),
    hobbies: s(b.hobbies, 300), goals: s(b.goals, 300), about: s(b.about, 2000), marks, status: 'draft', endorsementRemark: '' };
  await req.user.save();
  await audit(req.user, 'profile.updated', req.user);
  res.json({ user: pub(req.user) });
});
app.get('/api/me/notes', auth('mentee'), async (req, res) =>
  res.json(await Note.find({ mentee: req.user.id, visibility: 'shared' }).sort('-createdAt')));
app.post('/api/me/profile/submit', auth('mentee'), async (req, res) => {
  req.user.profile ||= {};
  req.user.profile.status = 'submitted'; req.user.profile.endorsementRemark = '';
  await req.user.save(); await audit(req.user, 'profile.submitted', req.user);
  res.json({ user: pub(req.user) });
});

/* ---- mentor + HOD ---- */
app.get('/api/mentees', auth('mentor', 'admin', 'hod'), async (req, res) => {
  const q = { role: 'mentee' };
  if (req.user.role === 'mentor') q.mentor = req.user.id;           // mentors see only assigned mentees
  res.json((await User.find(q).sort('name')).map(pub));
});
async function loadMentee(req, res) {
  const m = await User.findOne({ _id: req.params.id, role: 'mentee' }).catch(() => null);
  if (!m) { res.status(404).json({ error: 'Mentee not found.' }); return null; }
  if (req.user.role === 'mentor' && String(m.mentor) !== req.user.id) { res.status(403).json({ error: 'This mentee is not assigned to you.' }); return null; }
  return m;
}
app.get('/api/mentees/:id', auth('mentor', 'admin', 'hod'), async (req, res) => {
  const m = await loadMentee(req, res); if (!m) return;
  const notes = req.user.role === 'mentor'
    ? await Note.find({ mentee: m.id }).sort('-createdAt')
    : await Note.find({ mentee: m.id }).sort('-createdAt');
  res.json({ mentee: pub(m), notes });
});
app.post('/api/mentees/:id/notes', auth('mentor'), async (req, res) => {   // HOD is read-only
  const m = await loadMentee(req, res); if (!m) return;
  const text = s(req.body.text, 3000);
  if (!text) return res.status(400).json({ error: 'Write something first.' });
  const visibility = req.body.visibility === 'private' ? 'private' : 'shared';
  const note = await Note.create({ mentee: m.id, author: req.user.id, text, visibility, kind: req.body.kind === 'Recommendation' ? 'Recommendation' : 'Note' });
  await audit(req.user, 'note.created', m, { visibility, kind: note.kind });
  res.json(note);
});

/* ---- HOD only ---- */
app.get('/api/mentors', auth('hod'), async (req, res) =>
  res.json((await User.find({ role: 'mentor' }).sort('name')).map(pub)));
app.post('/api/mentors', auth('hod'), async (req, res) => {
  const name = s(req.body.name, 100), email = s(req.body.email, 200).toLowerCase(), password = s(req.body.password, 200);
  if (!name || !email || password.length < 8) return res.status(400).json({ error: 'Enter a name, an email and a temporary password of at least 8 characters.' });
  if (await User.exists({ email })) return res.status(409).json({ error: 'That email already has an account.' });
  const mentor = await User.create({ name, email, hash: await bcrypt.hash(password, 10), role: 'mentor' });
  await audit(req.user, 'user.created', mentor, { role: 'mentor' });
  res.json(pub(mentor));
});
app.put('/api/mentees/:id/mentor', auth('hod'), async (req, res) => {
  const m = await User.findOne({ _id: req.params.id, role: 'mentee' }).catch(() => null);
  if (!m) return res.status(404).json({ error: 'Mentee not found.' });
  if (req.body.mentor && !(await User.exists({ _id: req.body.mentor, role: 'mentor' }))) return res.status(400).json({ error: 'Choose a valid mentor.' });
  m.mentor = req.body.mentor || null; await m.save(); await audit(req.user, 'mentor.assigned', m, { mentor: m.mentor });
  res.json(pub(m));
});
app.put('/api/mentees/:id/endorsement', auth('hod'), async (req, res) => {
  const m = await User.findOne({ _id: req.params.id, role: 'mentee' }).catch(() => null);
  if (!m) return res.status(404).json({ error: 'Mentee not found.' });
  const status = ['endorsed', 'changes-requested'].includes(req.body.status) ? req.body.status : null;
  if (!status) return res.status(400).json({ error: 'Choose endorsed or changes-requested.' });
  m.profile ||= {};
  m.profile.status = status; m.profile.endorsementRemark = s(req.body.remark, 1000);
  await m.save(); await audit(req.user, `profile.${status}`, m, { remark: m.profile.endorsementRemark });
  res.json(pub(m));
});
app.get('/api/mentees/:id/goals', auth('mentor', 'hod'), async (req, res) => {
  const m = await loadMentee(req, res); if (!m) return;
  res.json(await Goal.find({ mentee: m.id }).sort('dueDate'));
});
app.post('/api/mentees/:id/goals', auth('mentor'), async (req, res) => {
  const m = await loadMentee(req, res); if (!m) return;
  const title = s(req.body.title, 300); if (!title) return res.status(400).json({ error: 'Add a goal title.' });
  const goal = await Goal.create({ mentee: m.id, author: req.user.id, title, dueDate: req.body.dueDate || null });
  await audit(req.user, 'goal.created', m, { title }); res.json(goal);
});
app.put('/api/goals/:id', auth('mentor', 'mentee'), async (req, res) => {
  const goal = await Goal.findById(req.params.id); if (!goal) return res.status(404).json({ error: 'Goal not found.' });
  if (req.user.role === 'mentee' && String(goal.mentee) !== req.user.id) return res.status(403).json({ error: 'You do not have access to this goal.' });
  goal.status = req.body.status === 'done' ? 'done' : 'open'; await goal.save(); res.json(goal);
});
app.get('/api/mentees/:id/meetings', auth('mentor', 'hod'), async (req, res) => {
  const m = await loadMentee(req, res); if (!m) return; res.json(await Meeting.find({ mentee: m.id }).sort('scheduledAt'));
});
app.post('/api/mentees/:id/meetings', auth('mentor'), async (req, res) => {
  const m = await loadMentee(req, res); if (!m) return;
  const topic = s(req.body.topic, 300); if (!topic || !req.body.scheduledAt) return res.status(400).json({ error: 'Add a topic and meeting time.' });
  const meeting = await Meeting.create({ mentee: m.id, mentor: req.user.id, topic, scheduledAt: req.body.scheduledAt, minutes: s(req.body.minutes, 5000) });
  await audit(req.user, 'meeting.created', m, { topic }); res.json(meeting);
});
app.get('/api/reports/mentees.csv', auth('hod'), async (req, res) => {
  const rows = await User.find({ role: 'mentee' }).sort('name');
  const safe = value => `"${String(value ?? '').replace(/"/g, '""').replace(/^[=+\-@]/, '')}"`;
  res.type('text/csv').send(['Name,Email,Department,Year,Profile status,Mentor', ...rows.map(m => [
    safe(m.name), safe(m.email), safe(m.profile?.dept), safe(m.profile?.year), safe(m.profile?.status),
    safe(m.mentor ? String(m.mentor) : '')
  ].join(','))].join('\n'));
});
app.get('/api/audit-log', auth('hod'), async (req, res) => res.json(await AuditLog.find().sort('-createdAt').limit(200).populate('actor', 'name email')));

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));
app.use((e, req, res, next) => { console.error(e); res.status(500).json({ error: 'Server error. Try again.' }); });

module.exports = app;
if (require.main === module) app.listen(PORT, () => console.log(`Mentor Desk running at http://localhost:${PORT}`));
