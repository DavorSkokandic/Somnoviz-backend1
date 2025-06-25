import express from "express";
import multer from "multer";
import path from "path";
import {handleFileUpload} from "../controllers/uploadController";
import {handleEdfChunk} from "../controllers/uploadController";
import {handleEdfChunkDownsample} from "../controllers/uploadController";

const router = express.Router();


const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + "-" + file.originalname);
  },
});

const upload = multer({ storage });

router.post("/",upload.single("file"),(req, res, next) => {
    Promise.resolve(handleFileUpload(req, res)).catch(next);
  }
);
router.get('/edf-chunk', (req, res, next) => {
  Promise.resolve(handleEdfChunk(req, res)).catch(next);
});

router.get('/edf-chunk-downsample', (req, res, next) => {
  Promise.resolve(handleEdfChunkDownsample(req, res)).catch(next);
  }
);

export default router;
