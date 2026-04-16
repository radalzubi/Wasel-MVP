import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(helmet());
app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', waitlistMode: process.env.WAITLIST_MODE === 'true' });
});

// Routes
import waitlistRouter from './routes/waitlist';
import authRouter from './routes/auth';
import tripsRouter from './routes/trips';
import driversRouter from './routes/drivers';

app.use('/api/waitlist', waitlistRouter);
app.use('/api/auth', authRouter);
app.use('/api/trips', tripsRouter);
app.use('/api/drivers', driversRouter);

app.listen(PORT, () => {
  console.log(`Wasel backend running on port ${PORT}`);
  console.log(`Waitlist mode: ${process.env.WAITLIST_MODE === 'true'}`);
});

export default app;
