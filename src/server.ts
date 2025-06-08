import express from 'express';
import cors from 'cors';
import dotnev from 'dotenv';
import uploadRoutes from './routes/upload';

dotnev.config();
const app = express();

const PORT = process.env.PORT || 5000;	
app.get('/', (_req, res) => {
  res.send('Somnoviz Backend Running!');
});
app.use(cors());
app.use(express.json());

app.use("/api/upload", uploadRoutes);

app.use(cors({
  origin: "http://localhost:5173", 
}));

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});