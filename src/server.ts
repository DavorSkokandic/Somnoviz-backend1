// server.ts
import express from 'express';
import cors from 'cors'; // Ispravan import
import dotenv from 'dotenv'; // Ispravan import
import uploadRoutes from './routes/upload';

dotenv.config();
const app = express();

const PORT = process.env.PORT || 5000;

// Postavite CORS middleware na početku i samo jednom
app.use(cors({
  origin: "http://localhost:5173", // Dopušten samo vaš frontend origin
  methods: ["GET", "POST", "PUT", "DELETE"], // Dopuštene metode
  credentials: true, // Omogućava slanje kolačića i HTTP autentifikacijskih headera
}));

app.use(express.json()); // Za parsiranje JSON tijela zahtjeva

app.get('/', (_req, res) => {
  res.send('Somnoviz Backend Running!');
});

app.use("/api/upload", uploadRoutes); // Montira vašu rutu

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});