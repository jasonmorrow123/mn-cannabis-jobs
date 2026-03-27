const express = require('express');
const path = require('path');
const fs = require('fs');
const nodemailer = require('nodemailer');
const { Pool } = require('pg');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL || 'admin@findjackpots.com';
const SMTP_HOST = process.env.SMTP_HOST || 'mail.privateemail.com';
const SMTP_PORT = process.env.SMTP_PORT || 465;
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const DATABASE_URL = process.env.DATABASE_URL || '';

// DB pool (only if DATABASE_URL is set)
let pool = null;
if (DATABASE_URL) {
  pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  console.log('PostgreSQL connected.');
} else {
  console.log('No DATABASE_URL — using jobs.json fallback.');
}

// Mailer
function getMailer() {
  if (!SMTP_USER || !SMTP_PASS) return null;
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: parseInt(SMTP_PORT),
    secure: true,
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });
}

async function sendEmail(subject, text) {
  const mailer = getMailer();
  if (!mailer) return;
  try {
    await mailer.sendMail({ from: SMTP_USER, to: NOTIFY_EMAIL, subject, text });
  } catch (e) {
    console.error('Email error:', e.message);
  }
}

// Load jobs from flat file (fallback)
function getJobsFromFile() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'jobs.json'), 'utf8'));
  } catch (e) {
    return [];
  }
}

// GET all jobs
app.get('/api/jobs', async (req, res) => {
  const { category, type, location, search } = req.query;

  try {
    if (pool) {
      let query = `SELECT * FROM jobs WHERE is_active = true`;
      const params = [];

      if (category && category !== 'all') {
        params.push(category);
        query += ` AND category = $${params.length}`;
      }
      if (type && type !== 'all') {
        params.push(type);
        query += ` AND type = $${params.length}`;
      }
      if (location && location !== 'all') {
        params.push(`%${location}%`);
        query += ` AND location ILIKE $${params.length}`;
      }
      if (search) {
        params.push(`%${search}%`);
        query += ` AND (title ILIKE $${params.length} OR company ILIKE $${params.length} OR description ILIKE $${params.length})`;
      }

      query += ` ORDER BY featured DESC, created_at DESC`;
      const { rows } = await pool.query(query, params);

      // Normalize to match frontend expectations
      const jobs = rows.map(r => ({
        id: r.id,
        title: r.title,
        company: r.company,
        location: r.location,
        type: r.type,
        category: r.category,
        salary: r.salary,
        description: r.description,
        applyUrl: r.apply_url,
        posted: r.posted_date,
        expires: r.expires_date,
        featured: r.featured
      }));

      return res.json(jobs);
    }
  } catch (e) {
    console.error('DB error, falling back to file:', e.message);
  }

  // Fallback to file
  let jobs = getJobsFromFile();
  if (category && category !== 'all') jobs = jobs.filter(j => j.category === category);
  if (type && type !== 'all') jobs = jobs.filter(j => j.type === type);
  if (search) {
    const q = search.toLowerCase();
    jobs = jobs.filter(j =>
      j.title.toLowerCase().includes(q) ||
      j.company.toLowerCase().includes(q) ||
      j.description.toLowerCase().includes(q)
    );
  }
  jobs.sort((a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0));
  res.json(jobs);
});

// GET single job
app.get('/api/jobs/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  try {
    if (pool) {
      const { rows } = await pool.query('SELECT * FROM jobs WHERE id = $1 AND is_active = true', [id]);
      if (!rows[0]) return res.status(404).json({ error: 'Job not found' });
      const r = rows[0];
      return res.json({ id: r.id, title: r.title, company: r.company, location: r.location, type: r.type, category: r.category, salary: r.salary, description: r.description, applyUrl: r.apply_url, posted: r.posted_date, expires: r.expires_date, featured: r.featured });
    }
  } catch (e) {
    console.error('DB error:', e.message);
  }
  const job = getJobsFromFile().find(j => j.id === id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

// POST email alert signup
app.post('/api/alerts', async (req, res) => {
  const { email, keywords } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });

  // Save to DB
  if (pool) {
    try {
      await pool.query(
        'INSERT INTO alert_signups (email, keywords) VALUES ($1, $2)',
        [email, keywords || '']
      );
    } catch (e) {
      console.error('DB alert error:', e.message);
    }
  }

  // Always email as backup
  await sendEmail(
    'New Job Alert Signup — mncannabisjobs.com',
    `Email: ${email}\nKeywords: ${keywords || 'none'}\nSigned up: ${new Date().toISOString()}`
  );

  res.json({ success: true });
});

// POST job posting request
app.post('/api/post-job', async (req, res) => {
  const { company, contact, email, phone, title, location, type, category, salary, description, applyUrl } = req.body;
  if (!company || !email || !title) return res.status(400).json({ error: 'Missing required fields' });

  // Save to DB
  if (pool) {
    try {
      await pool.query(
        `INSERT INTO job_submissions (company, contact_name, email, phone, title, location, type, category, salary, description, apply_url)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [company, contact, email, phone, title, location, type, category, salary, description, applyUrl]
      );
    } catch (e) {
      console.error('DB submission error:', e.message);
    }
  }

  // Always email as backup
  await sendEmail(
    `New Job Posting Request: ${title} at ${company}`,
    `Company: ${company}\nContact: ${contact}\nEmail: ${email}\nPhone: ${phone}\nTitle: ${title}\nLocation: ${location}\nType: ${type}\nCategory: ${category}\nSalary: ${salary}\nApply URL: ${applyUrl}\n\nDescription:\n${description}`
  );

  res.json({ success: true });
});

// Legal pages
app.get('/privacy', (req, res) => res.sendFile(path.join(__dirname, 'public', 'privacy.html')));
app.get('/terms', (req, res) => res.sendFile(path.join(__dirname, 'public', 'terms.html')));

// Serve index.html for all other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3002;
app.listen(PORT, () => console.log(`MN Cannabis Jobs running on port ${PORT}`));
