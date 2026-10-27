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

Deploying on Vercel
- Use a MongoDB Atlas database. In Atlas, Network Access, allow 0.0.0.0/0 (Vercel has no fixed IP).
- In Vercel, Project Settings, Environment Variables, add MONGO_URI (the mongodb+srv:// string), JWT_SECRET, HOD_EMAIL and HOD_PASSWORD, then redeploy.
- A "500 FUNCTION_INVOCATION_FAILED" page means the function crashed. Open the deployment's Logs to see why.
