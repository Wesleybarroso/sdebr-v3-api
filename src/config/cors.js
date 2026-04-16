const allowedOrigins = process.env.FRONT_URL
  ? process.env.FRONT_URL.split(',').map(o => o.trim())
  : ['http://localhost:3000', 'http://localhost:5173'];

export const corsConfig = {
  origin: (origin, callback) => {
    // permite requisições sem origin (ex: Postman, mobile apps)
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`Origem não permitida pelo CORS: ${origin}`));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  optionsSuccessStatus: 200
};