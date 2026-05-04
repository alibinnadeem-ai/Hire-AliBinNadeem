'use strict';

const bcrypt = require('bcryptjs');
const Joi = require('joi');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');

const { query } = require('../../lib/db');
const { EVENT_TYPES, PROGRAMS, PROJECTS, SERVICES, VENTURES } = require('../../lib/data');

const RATE_LIMIT_WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10);
const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX || '100', 10);
const CONTACT_WINDOW_MS = 60 * 60 * 1000;
const CONTACT_MAX = 5;

const globalHits = new Map();
const contactHits = new Map();

const contactSchema = Joi.object({
  name: Joi.string().min(2).max(100).required(),
  email: Joi.string().email().required(),
  phone: Joi.string().max(20).allow('').optional(),
  company: Joi.string().max(100).allow('').optional(),
  subject: Joi.string().max(200).required(),
  message: Joi.string().min(10).max(3000).required(),
  interest: Joi.string().max(100).allow('').optional(),
  engagement_type: Joi.string().valid('advisory-sprint', 'fractional-cto', 'full-build', 'training', 'general').optional(),
  budget_range: Joi.string().max(50).allow('').optional(),
  timeline: Joi.string().max(50).allow('').optional(),
  website: Joi.string().allow('').optional(),
});

const enquirySchema = Joi.object({
  name: Joi.string().min(2).max(100).required(),
  email: Joi.string().email().required(),
  phone: Joi.string().max(20).allow('').optional(),
  company: Joi.string().max(100).allow('').optional(),
  service: Joi.string().max(100).required(),
  engagement_type: Joi.string().valid('advisory-sprint', 'fractional-cto', 'full-build', 'training', 'other').required(),
  description: Joi.string().min(20).max(3000).required(),
  budget_range: Joi.string().max(50).allow('').optional(),
  timeline: Joi.string().max(50).allow('').optional(),
  referral: Joi.string().max(100).allow('').optional(),
});

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || '0.0.0.0';
}

function checkRateLimit(store, key, max, windowMs) {
  const now = Date.now();
  const bucket = store.get(key);

  if (!bucket || now - bucket.start > windowMs) {
    store.set(key, { count: 1, start: now });
    return false;
  }

  bucket.count += 1;
  store.set(key, bucket);
  return bucket.count > max;
}

function setSecurityHeaders(req, res) {
  const origin = req.headers.origin;
  const allowed = (process.env.CORS_ORIGIN || 'http://localhost:3002').split(',').map((v) => v.trim());
  if (origin && allowed.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-session-id');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
}

function requireAdminHeader(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.ADMIN_JWT_SECRET}`) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

function requireAdminJwt(req, res) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    res.status(401).json({ error: 'No token' });
    return null;
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (!decoded.isAdmin) {
      res.status(403).json({ error: 'Admin required' });
      return null;
    }
    return decoded;
  } catch {
    res.status(401).json({ error: 'Invalid token' });
    return null;
  }
}

function mailer() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

function emailRow(label, value) {
  return value
    ? `<tr><td style="color:#2997ff;font-size:10px;padding:6px 0 2px;text-transform:uppercase;letter-spacing:.08em">${label}</td></tr><tr><td style="color:#fff;padding:0 0 10px">${value}</td></tr>`
    : '';
}

async function notifyContact(data) {
  if (!process.env.SMTP_USER) return;

  const transport = mailer();
  await transport.sendMail({
    from: process.env.EMAIL_FROM,
    to: process.env.EMAIL_TO,
    replyTo: data.email,
    subject: `[ABN Consultant] ${data.subject} - ${data.name}`,
    html: `<div style="font-family:system-ui;max-width:580px;padding:32px;background:#0d0d0f;color:#fff;border-radius:16px">
      <h2 style="color:#2997ff;margin:0 0 6px">New Consulting Enquiry</h2>
      <p style="color:rgba(255,255,255,.35);font-size:11px;margin:0 0 24px">${new Date().toLocaleString('en-GB', { timeZone: 'Asia/Karachi' })} PKT</p>
      <table style="width:100%;border-collapse:collapse">
        ${emailRow('Name', data.name)} ${emailRow('Email', `<a href="mailto:${data.email}" style="color:#fff">${data.email}</a>`)}
        ${emailRow('Phone', data.phone)} ${emailRow('Company', data.company)}
        ${emailRow('Service Interest', data.interest)} ${emailRow('Engagement Type', data.engagement_type)}
        ${emailRow('Budget Range', data.budget_range)} ${emailRow('Timeline', data.timeline)}
        ${emailRow('Subject', data.subject)} ${emailRow('Message', `<span style="white-space:pre-wrap;color:rgba(255,255,255,.7)">${data.message}</span>`)}
      </table>
      <a href="mailto:${data.email}?subject=Re: ${encodeURIComponent(data.subject)}"
         style="display:inline-block;margin-top:16px;background:#0066cc;color:#fff;padding:12px 24px;border-radius:30px;text-decoration:none">
        Reply to ${data.name} ->
      </a>
    </div>`,
  });

  await transport.sendMail({
    from: process.env.EMAIL_FROM,
    to: data.email,
    subject: 'Consulting enquiry received - Ali Bin Nadeem',
    html: `<div style="font-family:system-ui;max-width:560px;padding:32px;background:#fff;border-radius:16px;border:1px solid #f0f0f0">
      <h2 style="margin:0 0 4px">Ali Bin Nadeem</h2>
      <p style="color:#888;font-size:12px;margin:0 0 24px">Technology Consultant · Entrepreneur · MS · ASM</p>
      <p>Hi ${data.name.split(' ')[0]},</p>
      <p>Thank you for your consulting enquiry. I have received your message and will review it carefully before responding within <strong>24 hours</strong>.</p>
      <p style="margin-top:24px">
        <a href="https://www.linkedin.com/in/alibinnadeem/" style="background:#0066cc;color:#fff;padding:10px 20px;border-radius:30px;text-decoration:none;font-size:13px;margin-right:8px">LinkedIn</a>
        <a href="https://wa.me/14085001113" style="border:1px solid #0066cc;color:#0066cc;padding:10px 20px;border-radius:30px;text-decoration:none;font-size:13px">WhatsApp</a>
      </p>
      <p style="margin-top:24px;color:#888;font-size:12px">Rawalpindi · Islamabad · Silicon Valley · Qatar</p>
    </div>`,
  });
}

function jsonBody(req) {
  return req.body && typeof req.body === 'object' ? req.body : {};
}

async function handleContact(req, res) {
  if (req.method === 'POST') {
    const ip = getClientIp(req);
    if (checkRateLimit(contactHits, ip, CONTACT_MAX, CONTACT_WINDOW_MS)) {
      return res.status(429).json({ error: 'Too many requests' });
    }

    const { error, value } = contactSchema.validate(jsonBody(req), { abortEarly: false });
    if (error) {
      return res.status(400).json({ error: 'Validation failed', details: error.details.map((d) => d.message) });
    }

    if (value.website) {
      return res.status(200).json({ success: true });
    }

    await Promise.allSettled([
      notifyContact(value),
      query(
        `INSERT INTO contacts (name,email,phone,company,subject,message,interest,engagement_type,budget_range,timeline,source,ip_address,created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'consultant',$11,NOW())`,
        [
          value.name,
          value.email,
          value.phone || null,
          value.company || null,
          value.subject,
          value.message,
          value.interest || null,
          value.engagement_type || null,
          value.budget_range || null,
          value.timeline || null,
          ip,
        ]
      ).catch((e) => console.error('[DB]', e.message)),
    ]);

    return res.status(200).json({ success: true, message: "Enquiry received! I'll respond within 24 hours." });
  }

  if (req.method === 'GET') {
    if (!requireAdminHeader(req, res)) return;
    try {
      const { rows } = await query('SELECT * FROM contacts ORDER BY created_at DESC LIMIT 100');
      return res.status(200).json({ data: rows, count: rows.length });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

async function handleEnquiry(req, res, slug) {
  if (!slug && req.method === 'POST') {
    const ip = getClientIp(req);
    if (checkRateLimit(contactHits, ip, CONTACT_MAX, CONTACT_WINDOW_MS)) {
      return res.status(429).json({ error: 'Too many requests' });
    }

    const { error, value } = enquirySchema.validate(jsonBody(req), { abortEarly: false });
    if (error) {
      return res.status(400).json({ error: 'Validation failed', details: error.details.map((d) => d.message) });
    }

    try {
      await query(
        `INSERT INTO enquiries (name,email,phone,company,service,engagement_type,description,budget_range,timeline,referral,ip_address,status,created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'new',NOW())`,
        [
          value.name,
          value.email,
          value.phone || null,
          value.company || null,
          value.service,
          value.engagement_type,
          value.description,
          value.budget_range || null,
          value.timeline || null,
          value.referral || null,
          ip,
        ]
      );
    } catch (e) {
      console.error('[ENQUIRY DB]', e.message);
    }
    return res.status(200).json({ success: true, message: "Enquiry logged. I'll be in touch within 24 hours." });
  }

  if (!slug && req.method === 'GET') {
    if (!requireAdminHeader(req, res)) return;
    try {
      const { rows } = await query('SELECT * FROM enquiries ORDER BY created_at DESC LIMIT 200');
      const byService = rows.reduce((acc, row) => {
        acc[row.service] = acc[row.service] || [];
        acc[row.service].push(row);
        return acc;
      }, {});
      return res.status(200).json({ data: rows, count: rows.length, by_service: byService });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (slug && req.method === 'PATCH') {
    if (!requireAdminHeader(req, res)) return;
    const { status, notes } = jsonBody(req);
    try {
      await query('UPDATE enquiries SET status=$1,admin_notes=$2,updated_at=NOW() WHERE id=$3', [status, notes, slug]);
      return res.status(200).json({ success: true });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

function filterWithSearch(items, queryValue, accessor) {
  if (!queryValue) return items;
  const q = String(queryValue).toLowerCase();
  return items.filter((item) => accessor(item).toLowerCase().includes(q));
}

async function handleProjects(req, res, slug) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  if (slug === 'stats') {
    const categories = PROJECTS.reduce((acc, p) => {
      acc[p.cat] = (acc[p.cat] || 0) + 1;
      return acc;
    }, {});
    return res.status(200).json({
      total: PROJECTS.length,
      live: PROJECTS.filter((p) => p.status === 'live').length,
      categories,
    });
  }

  if (slug) {
    const project = PROJECTS.find((p) => p.id === slug);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    return res.status(200).json({ data: project });
  }

  const { cat, search, status } = req.query;
  let results = [...PROJECTS];
  if (cat) results = results.filter((p) => p.cat.toLowerCase() === String(cat).toLowerCase());
  if (status) results = results.filter((p) => p.status === status);
  results = filterWithSearch(results, search, (p) => p.name);
  const categories = [...new Set(PROJECTS.map((p) => p.cat))];
  return res.status(200).json({ data: results, total: results.length, categories });
}

async function handleVentures(req, res, slug) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  if (slug === 'stats') {
    const byType = VENTURES.reduce((acc, venture) => {
      acc[venture.type] = (acc[venture.type] || 0) + 1;
      return acc;
    }, {});
    return res.status(200).json({
      total: VENTURES.length,
      active: VENTURES.filter((v) => v.status === 'active').length,
      by_type: byType,
    });
  }

  if (slug) {
    const venture = VENTURES.find((v) => v.id === slug);
    if (!venture) return res.status(404).json({ error: 'Venture not found' });
    return res.status(200).json({ data: venture });
  }

  const { type, status } = req.query;
  let results = [...VENTURES];
  if (type) results = filterWithSearch(results, type, (v) => v.type);
  if (status) results = results.filter((v) => v.status === status);
  const types = [...new Set(VENTURES.map((v) => v.type))];
  return res.status(200).json({ data: results, total: results.length, types });
}

async function handleServices(req, res, slug) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (slug) {
    const service = SERVICES.find((s) => s.id === slug);
    if (!service) return res.status(404).json({ error: 'Service not found' });
    return res.status(200).json({ data: service });
  }

  const { type } = req.query;
  const results = type ? SERVICES.filter((s) => s.engagement_types.includes(String(type))) : SERVICES;
  return res.status(200).json({ data: results, total: results.length });
}

async function handleTraining(req, res, slug) {
  if (slug === 'enrol') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const { name, email, phone, program_id } = jsonBody(req);
    if (!name || !email || !program_id) {
      return res.status(400).json({ error: 'name, email, program_id required' });
    }
    const program = PROGRAMS.find((p) => p.id === program_id);
    if (!program) return res.status(404).json({ error: 'Program not found' });
    console.log('[TRAINING ENROL]', { name, email, phone, program_id });
    return res.status(200).json({
      success: true,
      program: program.name,
      message: `Enrolment request received for ${program.name}. We will confirm within 24 hours.`,
      next_step: program.url,
      notion: program.notion_url || null,
    });
  }

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (slug) {
    const program = PROGRAMS.find((p) => p.id === slug);
    if (!program) return res.status(404).json({ error: 'Program not found' });
    return res.status(200).json({ data: program });
  }

  const { region, partnership } = req.query;
  let results = [...PROGRAMS];
  if (region) results = filterWithSearch(results, region, (p) => p.region);
  if (partnership) {
    results = results.filter((p) => p.partnership.toLowerCase() === String(partnership).toLowerCase());
  }
  return res.status(200).json({ data: results, total: results.length });
}

async function handleBooking(req, res, slug) {
  if (slug === 'calendly-url') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    const { service, engagement } = req.query;
    const base = `https://calendly.com/${process.env.CALENDLY_USERNAME || 'alibinnadeem'}`;
    const eventSlug = EVENT_TYPES[service] || EVENT_TYPES[engagement] || EVENT_TYPES.default;
    return res.status(200).json({ url: `${base}/${eventSlug}`, service, event_type: eventSlug });
  }

  if (slug === 'request') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const { name, email, service, preferred_time } = jsonBody(req);
    if (!name || !email || !service) {
      return res.status(400).json({ error: 'name, email, and service are required' });
    }
    console.log('[BOOKING] Request:', { name, email, service, preferred_time });
    const base = `https://calendly.com/${process.env.CALENDLY_USERNAME || 'alibinnadeem'}`;
    return res.status(200).json({
      success: true,
      message: 'Booking request received. Ali will confirm within 24 hours.',
      calendly_url: `${base}/${EVENT_TYPES[service] || EVENT_TYPES.default}`,
    });
  }

  return res.status(404).json({ error: 'Not found' });
}

function getOrCreateSession(req) {
  return req.headers['x-session-id'] || getClientIp(req);
}

async function handleAnalytics(req, res, slug) {
  if (slug === 'pageview') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const { page, referrer } = jsonBody(req);
    try {
      await query(
        `INSERT INTO analytics_pageviews (page,referrer,user_agent,session_id,ip_address,created_at)
         VALUES ($1,$2,$3,$4,$5,NOW())`,
        [page || '/', referrer || null, req.headers['user-agent'] || null, getOrCreateSession(req), getClientIp(req)]
      );
    } catch {}
    return res.status(200).json({ success: true });
  }

  if (slug === 'event') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const { event_type, event_data } = jsonBody(req);
    if (!event_type) return res.status(400).json({ error: 'event_type required' });
    try {
      await query(
        `INSERT INTO analytics_events (event_type,event_data,session_id,ip_address,created_at)
         VALUES ($1,$2,$3,$4,NOW())`,
        [event_type, JSON.stringify(event_data || {}), getOrCreateSession(req), getClientIp(req)]
      );
    } catch {}
    return res.status(200).json({ success: true });
  }

  if (slug === 'summary') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    if (!requireAdminHeader(req, res)) return;
    try {
      const [total, today, week, contacts, topPages, topEvents] = await Promise.all([
        query('SELECT COUNT(*) c FROM analytics_pageviews'),
        query("SELECT COUNT(*) c FROM analytics_pageviews WHERE created_at > NOW() - INTERVAL '24 hours'"),
        query("SELECT COUNT(*) c FROM analytics_pageviews WHERE created_at > NOW() - INTERVAL '7 days'"),
        query("SELECT COUNT(*) c FROM contacts WHERE created_at > NOW() - INTERVAL '7 days'"),
        query('SELECT page, COUNT(*) views FROM analytics_pageviews GROUP BY page ORDER BY views DESC LIMIT 10'),
        query('SELECT event_type, COUNT(*) c FROM analytics_events GROUP BY event_type ORDER BY c DESC LIMIT 10'),
      ]);

      return res.status(200).json({
        pageviews: { total: +total.rows[0].c, today: +today.rows[0].c, week: +week.rows[0].c },
        contacts_this_week: +contacts.rows[0].c,
        top_pages: topPages.rows,
        top_events: topEvents.rows,
      });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(404).json({ error: 'Not found' });
}

async function handleAdmin(req, res, slug, id) {
  if (slug === 'login') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const { email, password } = jsonBody(req);
    if (!email || !password) return res.status(400).json({ error: 'Credentials required' });
    if (email !== process.env.ADMIN_EMAIL) return res.status(401).json({ error: 'Invalid credentials' });

    const valid = await bcrypt.compare(password, process.env.ADMIN_PASSWORD_HASH || '');
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign({ email, isAdmin: true }, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    });
    return res.status(200).json({ token, email });
  }

  const admin = requireAdminJwt(req, res);
  if (!admin) return;

  if (slug === 'dashboard') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    try {
      const [contacts, pageviews, events] = await Promise.all([
        query('SELECT * FROM contacts ORDER BY created_at DESC LIMIT 50'),
        query("SELECT COUNT(*) c FROM analytics_pageviews WHERE created_at > NOW() - INTERVAL '7 days'"),
        query("SELECT event_type, COUNT(*) c FROM analytics_events GROUP BY event_type ORDER BY c DESC"),
      ]);
      return res.status(200).json({
        contacts: contacts.rows,
        pageviews_7d: +pageviews.rows[0].c,
        top_events: events.rows,
      });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (slug === 'contacts' && id) {
    if (req.method === 'PATCH') {
      const { status, notes } = jsonBody(req);
      try {
        await query('UPDATE contacts SET status=$1, admin_notes=$2, updated_at=NOW() WHERE id=$3', [status, notes, id]);
        return res.status(200).json({ success: true });
      } catch (e) {
        return res.status(500).json({ error: e.message });
      }
    }

    if (req.method === 'DELETE') {
      try {
        await query('DELETE FROM contacts WHERE id=$1', [id]);
        return res.status(200).json({ success: true });
      } catch (e) {
        return res.status(500).json({ error: e.message });
      }
    }

    return res.status(405).json({ error: 'Method not allowed' });
  }

  return res.status(404).json({ error: 'Not found' });
}

async function handleAuth(req, res, slug) {
  if (slug === 'linkedin') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: process.env.LINKEDIN_CLIENT_ID || '',
      redirect_uri: process.env.LINKEDIN_CALLBACK_URL || '',
      scope: 'r_liteprofile r_emailaddress',
      state: Math.random().toString(36).substring(7),
    });
    res.redirect(`https://www.linkedin.com/oauth/v2/authorization?${params}`);
    return;
  }

  if (slug === 'verify') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const { token } = jsonBody(req);
    if (!token) return res.status(200).json({ valid: false });
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      return res.status(200).json({ valid: true, user: decoded });
    } catch {
      return res.status(200).json({ valid: false });
    }
  }

  if (slug === 'linkedin-callback') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    const { code, error } = req.query;
    if (error || !code) {
      res.redirect('/?auth=error');
      return;
    }

    try {
      const tokenRes = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: String(code),
          redirect_uri: process.env.LINKEDIN_CALLBACK_URL || '',
          client_id: process.env.LINKEDIN_CLIENT_ID || '',
          client_secret: process.env.LINKEDIN_CLIENT_SECRET || '',
        }),
      });

      const tokenData = await tokenRes.json();
      const profileRes = await fetch('https://api.linkedin.com/v2/me', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      const profile = await profileRes.json();

      const token = jwt.sign(
        { linkedin_id: profile.id, name: `${profile.localizedFirstName} ${profile.localizedLastName}` },
        process.env.JWT_SECRET,
        { expiresIn: '1d' }
      );

      res.redirect(`/?auth=success&token=${token}`);
      return;
    } catch (e) {
      console.error('[AUTH] LinkedIn error:', e.message);
      res.redirect('/?auth=error');
      return;
    }
  }

  if (slug === 'linkedin' && req.query?.callback !== undefined) {
    return res.status(404).json({ error: 'Not found' });
  }

  return res.status(404).json({ error: 'Not found' });
}

async function handler(req, res) {
  try {
    setSecurityHeaders(req, res);
    if (req.method === 'OPTIONS') return res.status(204).end();

    const ip = getClientIp(req);
    if (checkRateLimit(globalHits, ip, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS)) {
      return res.status(429).json({ error: 'Too many requests' });
    }

    const path = Array.isArray(req.query.path) ? req.query.path : [];
    const [resource, slug, id] = path;

    if (resource === 'health') {
      return res.status(200).json({
        status: 'healthy',
        site: 'abn-consultant',
        version: '2.0.0',
        framework: 'next.js',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        env: process.env.NODE_ENV,
      });
    }

    if (resource === 'contact') return handleContact(req, res);
    if (resource === 'enquiry') return handleEnquiry(req, res, slug);
    if (resource === 'services') return handleServices(req, res, slug);
    if (resource === 'booking') return handleBooking(req, res, slug);
    if (resource === 'training') return handleTraining(req, res, slug);
    if (resource === 'ventures') return handleVentures(req, res, slug);
    if (resource === 'projects') return handleProjects(req, res, slug);
    if (resource === 'analytics') return handleAnalytics(req, res, slug);
    if (resource === 'admin') return handleAdmin(req, res, slug, id);

    if (resource === 'auth') {
      // Support legacy /api/auth/linkedin/callback in catch-all path form.
      if (slug === 'linkedin' && id === 'callback') {
        req.query = { ...req.query, code: req.query.code, error: req.query.error };
        return handleAuth(req, res, 'linkedin-callback');
      }
      return handleAuth(req, res, slug);
    }

    return res.status(404).json({ error: 'Not found' });
  } catch (err) {
    console.error('[ERROR]', err.stack || err.message || err);
    return res.status(500).json({
      error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
    });
  }
}

module.exports = handler;
