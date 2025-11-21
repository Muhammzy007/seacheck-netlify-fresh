const { connectToDatabase } = require('./utils/mongodb');

function verifyToken(token) {
  try {
    const payload = JSON.parse(Buffer.from(token, 'base64').toString());
    return payload.exp > Date.now() ? payload : null;
  } catch {
    return null;
  }
}

exports.handler = async (event, context) => {
  const { path, httpMethod, headers: eventHeaders } = event;
  const route = path.replace('/.netlify/functions/admin', '');

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS'
  };

  if (httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const { db } = await connectToDatabase();
    const giftCardsCollection = db.collection('giftcards');

    // Authentication check
    const authHeader = eventHeaders.authorization;
    let isAuthenticated = false;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const payload = verifyToken(token);
      if (payload) {
        isAuthenticated = true;
      }
    }

    if (route === '/history' && httpMethod === 'GET') {
      if (!isAuthenticated) {
        return { statusCode: 401, headers, body: JSON.stringify({ error: 'Authentication required' }) };
      }

      const giftCards = await giftCardsCollection.find({})
        .sort({ check_date: -1 })
        .toArray();

      return { statusCode: 200, headers, body: JSON.stringify(giftCards) };
    }

    if (route.startsWith('/record/') && httpMethod === 'DELETE') {
      if (!isAuthenticated) {
        return { statusCode: 401, headers, body: JSON.stringify({ error: 'Authentication required' }) };
      }

      const id = parseInt(route.split('/record/')[1]);
      const result = await giftCardsCollection.deleteOne({ id: id });

      if (result.deletedCount === 0) {
        return { statusCode: 404, headers, body: JSON.stringify({ error: 'Record not found' }) };
      }

      return { statusCode: 200, headers, body: JSON.stringify({ message: 'Record deleted successfully' }) };
    }

    return { statusCode: 404, headers, body: JSON.stringify({ error: 'Route not found' }) };

  } catch (error) {
    console.error('Admin function error:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal server error' }) };
  }
};
