const express = require('express');
const path = require('path');
const fs = require('fs');
const nodemailer = require('nodemailer');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL || 'admin@findjackpots.com';
const SMTP_HOST = process.env.SMTP_HOST || 'mail.privateemail.com';
const SMTP_PORT = process.env.SMTP_PORT || 465;
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';

// Load jobs
function getJobs() {
  try {
    const data = fs.readFileSync(path.join(__dirname, 'jobs.json'), 'utf8');
    return JSON.parse(data);
  } catch (e) {
    return [];
  }
}

// GET all jobs (with optional filters)
app.get('/api/jobs', (req, res) => {
  let jobs = getJobs().filter(j => j.featured !== undefined); // all jobs
  const { category, type, location, search } = req.query;

  if (category && category !== 'all') {
    jobs = jobs.filter(j => j.category === category);
  }
  if (type && type !== 'all') {
    jobs = jobs.filter(j => j.type === type);
  }
  if (location && location !== 'all') {
    jobs = jobs.filter(j => j.location.toLowerCase().includes(location.toLowerCase()));
  }
  if (search) {
    const q = search.toLowerCase();
    jobs = jobs.filter(j =>
      j.title.toLowerCase().includes(q) ||
      j.company.toLowerCase().includes(q) ||
      j.description.toLowerCase().includes(q)
    );
  }

  // Featured first
  jobs.sort((a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0));
  res.json(jobs);
});

// GET single job
app.get('/api/jobs/:id', (req, res) => {
  const job = getJobs().find(j => j.id === parseInt(req.params.id));
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

// POST email alert signup
app.post('/api/alerts', async (req, res) => {
  const { email, keywords } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });

  // Email notification so signups are never lost on redeploy
  if (SMTP_USER && SMTP_PASS) {
    try {
      const transporter = nodemailer.createTransport({
        host: SMTP_HOST,
        port: parseInt(SMTP_PORT),
        secure: true,
        auth: { user: SMTP_USER, pass: SMTP_PASS }
      });
      await transporter.sendMail({
        from: SMTP_USER,
        to: NOTIFY_EMAIL,
        subject: `New Job Alert Signup — mncannabisjobs.com`,
        text: `New email alert signup:\n\nEmail: ${email}\nKeywords: ${keywords || 'none'}\nSigned up: ${new Date().toISOString()}`
      });
    } catch (e) {
      console.error('Alert email error:', e.message);
    }
  }

  res.json({ success: true });
});

// POST job posting request (manual fulfillment)
app.post('/api/post-job', async (req, res) => {
  const { company, contact, email, phone, title, location, type, category, salary, description, applyUrl } = req.body;
  if (!company || !email || !title) return res.status(400).json({ error: 'Missing required fields' });

  // Save submission
  const submissionsFile = path.join(__dirname, 'submissions.json');
  let submissions = [];
  try { submissions = JSON.parse(fs.readFileSync(submissionsFile, 'utf8')); } catch (e) {}
  const submission = { id: Date.now(), company, contact, email, phone, title, location, type, category, salary, description, applyUrl, submittedAt: new Date().toISOString(), status: 'pending' };
  submissions.push(submission);
  fs.writeFileSync(submissionsFile, JSON.stringify(submissions, null, 2));

  // Email notification
  if (SMTP_USER && SMTP_PASS) {
    try {
      const transporter = nodemailer.createTransport({
        host: SMTP_HOST,
        port: parseInt(SMTP_PORT),
        secure: true,
        auth: { user: SMTP_USER, pass: SMTP_PASS }
      });
      await transporter.sendMail({
        from: SMTP_USER,
        to: NOTIFY_EMAIL,
        subject: `New Job Posting Request: ${title} at ${company}`,
        text: `New job posting submission:\n\nCompany: ${company}\nContact: ${contact}\nEmail: ${email}\nPhone: ${phone}\nTitle: ${title}\nLocation: ${location}\nType: ${type}\nCategory: ${category}\nSalary: ${salary}\nApply URL: ${applyUrl}\n\nDescription:\n${description}`
      });
    } catch (e) {
      console.error('Email error:', e.message);
    }
  }

  res.json({ success: true });
});

// Serve index.html for all other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3002;
app.listen(PORT, () => console.log(`MN Cannabis Jobs running on port ${PORT}`));
