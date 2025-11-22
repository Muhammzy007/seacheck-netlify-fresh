const { connectToDatabase } = require('./utils/mongodb');

// Simple JWT-like token verification
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

    // Authentication check for protected routes
    const authHeader = eventHeaders.authorization;
    let isAuthenticated = false;
    let userEmail = null;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const payload = verifyToken(token);
      if (payload) {
        isAuthenticated = true;
        userEmail = payload.email;
      }
    }

    console.log('Admin route:', route, 'Authenticated:', isAuthenticated);

    // Routes that require authentication
    if (route === '/history' && httpMethod === 'GET') {
      if (!isAuthenticated) {
        return { 
          statusCode: 401, 
          headers, 
          body: JSON.stringify({ error: 'Authentication required' }) 
        };
      }

      try {
        const giftCards = await giftCardsCollection.find({})
          .sort({ check_date: -1 })
          .toArray();

        console.log('Found gift cards:', giftCards.length);
        return { 
          statusCode: 200, 
          headers, 
          body: JSON.stringify(giftCards) 
        };
      } catch (dbError) {
        console.error('Database error:', dbError);
        return { 
          statusCode: 500, 
          headers, 
          body: JSON.stringify({ error: 'Database error' }) 
        };
      }
    }

    if (route.startsWith('/record/') && httpMethod === 'DELETE') {
      if (!isAuthenticated) {
        return { 
          statusCode: 401, 
          headers, 
          body: JSON.stringify({ error: 'Authentication required' }) 
        };
      }

      try {
        const id = parseInt(route.split('/record/')[1]);
        const result = await giftCardsCollection.deleteOne({ id: id });

        if (result.deletedCount === 0) {
          return { 
            statusCode: 404, 
            headers, 
            body: JSON.stringify({ error: 'Record not found' }) 
          };
        }

        return { 
          statusCode: 200, 
          headers, 
          body: JSON.stringify({ message: 'Record deleted successfully' }) 
        };
      } catch (dbError) {
        console.error('Delete error:', dbError);
        return { 
          statusCode: 500, 
          headers, 
          body: JSON.stringify({ error: 'Delete failed' }) 
        };
      }
    }

    // Public route for checking if admin exists
    if (route === '/check' && httpMethod === 'GET') {
      try {
        const adminCollection = db.collection('admin');
        const admin = await adminCollection.findOne({});
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ adminExists: !!admin })
        };
      } catch (error) {
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({ error: 'Check failed' })
        };
      }
    }

    return { 
      statusCode: 404, 
      headers, 
      body: JSON.stringify({ error: 'Route not found' }) 
    };

  } catch (error) {
    console.error('Admin function error:', error);
    return { 
      statusCode: 500, 
      headers, 
      body: JSON.stringify({ error: 'Internal server error' }) 
    };
  }
};
