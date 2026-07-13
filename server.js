const express = require('express');
const path = require('path');

const app = express();
const PORT = 3000;

// Serve static files from /smart-meal-plan-generator-main/FRONTEND
app.use(express.static(path.join(__dirname, 'smart-meal-plan-generator-main', 'FRONTEND')));

// Redirect the root to /user/home.html
app.get('/', (req, res) => {
  res.redirect('/user/home.html');
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});
