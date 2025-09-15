"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const multer_1 = __importDefault(require("multer"));
const uploadController_1 = require("../controllers/uploadController");
const uploadController_2 = require("../controllers/uploadController");
const uploadController_3 = require("../controllers/uploadController");
const uploadController_4 = require("../controllers/uploadController");
const uploadController_5 = require("../controllers/uploadController");
const uploadController_6 = require("../controllers/uploadController");
const router = express_1.default.Router();
const storage = multer_1.default.diskStorage({
    destination: (req, file, cb) => {
        cb(null, "uploads/");
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
        cb(null, uniqueSuffix + "-" + file.originalname);
    },
});
const upload = (0, multer_1.default)({ storage });
router.post("/", upload.single("file"), (req, res, next) => {
    Promise.resolve((0, uploadController_1.handleFileUpload)(req, res)).catch(next);
});
router.get('/edf-chunk', (req, res, next) => {
    Promise.resolve((0, uploadController_2.handleEdfChunk)(req, res)).catch(next);
});
router.get('/edf-chunk-downsample', (req, res, next) => {
    Promise.resolve((0, uploadController_3.handleEdfChunkDownsample)(req, res)).catch(next);
});
router.get('/edf-multi-chunk', (req, res, next) => {
    Promise.resolve((0, uploadController_4.handleEdfMultiChunk)(req, res)).catch(next);
});
// AHI Analysis endpoint - POST because we need to send channel names in body
router.post('/ahi-analysis', (req, res, next) => {
    Promise.resolve((0, uploadController_5.handleAHIAnalysis)(req, res)).catch(next);
});
// Max/Min Values endpoint - POST because we need to send channel names in body
router.post('/max-min-values', (req, res, next) => {
    Promise.resolve((0, uploadController_6.handleMaxMinValues)(req, res)).catch(next);
});
exports.default = router;
