// server.ts
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { requireAuth, AuthRequest } from './src/middleware/auth.ts';
import { getOrCreateUser, syncUserData, getUserData } from './src/db/users.ts';
import firebaseConfig from './firebase-applet-config.json' assert { type: 'json' };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

// Parse JSON bodies
app.use(express.json());

// Serve Firebase config publicly
app.get('/firebase-config', (req, res) => {
  res.json(firebaseConfig);
});

// Authenticate / register user profile in PostgreSQL
app.post('/api/auth/register', requireAuth, async (req: AuthRequest, res) => {
  try {
    const firebaseUser = req.user;
    if (!firebaseUser) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const email = firebaseUser.email || '';
    const uid = firebaseUser.uid;

    const dbUser = await getOrCreateUser(uid, email);
    res.json({ success: true, user: dbUser });
  } catch (error: any) {
    console.error('Registration API Error:', error);
    res.status(500).json({ error: error.message || 'Database registration failed' });
  }
});

// Fetch all synchronized user data keys from PostgreSQL
app.get('/api/sync', requireAuth, async (req: AuthRequest, res) => {
  try {
    const firebaseUser = req.user;
    if (!firebaseUser) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Get DB user id
    const dbUser = await getOrCreateUser(firebaseUser.uid, firebaseUser.email || '');
    const data = await getUserData(dbUser.id);
    
    res.json({ success: true, data });
  } catch (error: any) {
    console.error('Sync Fetch API Error:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch sync data' });
  }
});

// Save/Sync a key-value pair to PostgreSQL
app.post('/api/sync', requireAuth, async (req: AuthRequest, res) => {
  try {
    const firebaseUser = req.user;
    if (!firebaseUser) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { key, value } = req.body;
    if (!key) {
      return res.status(400).json({ error: 'Missing sync key' });
    }

    // Get DB user id
    const dbUser = await getOrCreateUser(firebaseUser.uid, firebaseUser.email || '');
    const updatedRow = await syncUserData(dbUser.id, key, value);

    res.json({ success: true, data: updatedRow });
  } catch (error: any) {
    console.error('Sync Save API Error:', error);
    res.status(500).json({ error: error.message || 'Failed to save sync data' });
  }
});

// Serve static files from /smart-meal-plan-generator-main/FRONTEND
app.use(express.static(path.join(__dirname, 'smart-meal-plan-generator-main', 'FRONTEND')));

// Redirect the root to /user/home.html
app.get('/', (req, res) => {
  res.redirect('/user/home.html');
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});
