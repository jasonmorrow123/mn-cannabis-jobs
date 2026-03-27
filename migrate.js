const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function migrate() {
  console.log('Running migrations...');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS jobs (
      id SERIAL PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      company VARCHAR(255) NOT NULL,
      location VARCHAR(255) NOT NULL,
      type VARCHAR(50),
      category VARCHAR(100),
      salary VARCHAR(100),
      description TEXT,
      apply_url VARCHAR(500),
      posted_date DATE DEFAULT CURRENT_DATE,
      expires_date DATE,
      featured BOOLEAN DEFAULT false,
      is_active BOOLEAN DEFAULT true,
      source VARCHAR(50) DEFAULT 'manual',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS alert_signups (
      id SERIAL PRIMARY KEY,
      email VARCHAR(255) NOT NULL,
      keywords VARCHAR(500),
      signed_up_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS job_submissions (
      id SERIAL PRIMARY KEY,
      company VARCHAR(255) NOT NULL,
      contact_name VARCHAR(255),
      email VARCHAR(255) NOT NULL,
      phone VARCHAR(50),
      title VARCHAR(255) NOT NULL,
      location VARCHAR(255),
      type VARCHAR(50),
      category VARCHAR(100),
      salary VARCHAR(100),
      description TEXT,
      apply_url VARCHAR(500),
      status VARCHAR(50) DEFAULT 'pending',
      submitted_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  console.log('✅ Tables created.');

  // Seed jobs from jobs.json if jobs table is empty
  const { rows } = await pool.query('SELECT COUNT(*) FROM jobs');
  if (parseInt(rows[0].count) === 0) {
    console.log('Seeding jobs from jobs.json...');
    const jobs = require('./jobs.json');
    for (const job of jobs) {
      await pool.query(
        `INSERT INTO jobs (title, company, location, type, category, salary, description, apply_url, posted_date, expires_date, featured, source)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'seed')`,
        [job.title, job.company, job.location, job.type, job.category, job.salary,
         job.description, job.applyUrl || null, job.posted, job.expires, job.featured || false]
      );
    }
    console.log(`✅ Seeded ${jobs.length} jobs.`);
  } else {
    console.log(`ℹ️ Jobs table already has data — skipping seed.`);
  }

  await pool.end();
  console.log('Migration complete.');
}

migrate().catch(err => { console.error(err); process.exit(1); });
