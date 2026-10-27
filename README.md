# Mentor Desk

1. Install Node 18+ and MongoDB (or use a MongoDB Atlas URI).
2. Copy `.env.example` to `.env` and set `JWT_SECRET`, `HOD_EMAIL`, `HOD_PASSWORD` (and `MONGO_URI` if not local). The HOD account is created or synchronized from these values when the server connects to MongoDB.
3. `npm install`
4. `npm start`, then open http://localhost:3000

Accounts
- HOD: created from `.env` on first start. Can view every mentee, manage mentors and assignments, endorse profiles, export reports, and inspect the audit log.
- Mentor: created by the HOD. One mentor can have many mentees.
- Mentee: signs up on the sign-in page.
- Mentees can use the profile navigation to update personal details and academic details independently.
- The student workspace includes an overview, personal details, and academic details section, with mentor notes visible from each section.
- The application now uses a role-aware dashboard: mentees manage their profile and progress, mentors review mentees and share notes or recommendations, and HODs manage mentor accounts and assignments.
- Role permissions: mentees edit only their own profile and view their mentor updates; mentors view only assigned mentees and add notes or recommendations; HODs view all mentees, review profiles, manage mentors and assignments, and access reports and audit logs.
- Additional workflows: mentees submit profiles for HOD review; HODs endorse profiles or request changes; mentors can create shared recommendations or private notes, set goals, and schedule meetings with minutes; mentees can mark their goals complete.
- Default local HOD credentials from `.env.example`: `hod@college.edu` / `12345678`. Change `HOD_PASSWORD` in `.env` and in the production environment before using the application.

Before going live: serve over HTTPS, use a strong JWT_SECRET, and add rate limiting on /api/auth.

Deploying on Vercel
- Use a MongoDB Atlas database. In Atlas, Network Access, allow 0.0.0.0/0 (Vercel has no fixed IP).
- In Vercel, Project Settings, Environment Variables, add MONGO_URI (the mongodb+srv:// string), JWT_SECRET, HOD_EMAIL and HOD_PASSWORD, then redeploy.
- A "500 FUNCTION_INVOCATION_FAILED" page means the function crashed. Open the deployment's Logs to see why.
