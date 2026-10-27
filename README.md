# Mentor Desk

1. Install Node 18+ and MongoDB (or use a MongoDB Atlas URI).
2. `cp .env.example .env` and set `JWT_SECRET`, `HOD_EMAIL`, `HOD_PASSWORD` (and `MONGO_URI` if not local).
3. `npm install`
4. `npm start`, then open http://localhost:3000

Accounts
- HOD: created from `.env` on first start. Sign in, open "Mentors and assignment", add mentors and assign mentees.
- Mentor: created by the HOD. One mentor can have many mentees.
- Mentee: signs up on the sign-in page.

Before going live: serve over HTTPS, use a strong JWT_SECRET, and add rate limiting on /api/auth.
