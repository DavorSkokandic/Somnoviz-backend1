import { Request, Response } from "express";
import path from "path";

export const handleFileUpload = async (
  req: Request,
  res: Response
): Promise<void> => {
  const file = req.file;

  if (!file) {
    res.status(400).json({ error: "No file uploaded." });
    return;
  }

  console.log("File received:", file); // 👈 vidi sve o file-u

  const filePath = path.resolve(file.path);

  res.json({
    message: "File uploaded successfully.",
    originalName: file.originalname,
    storedName: file.filename,
    path: filePath,
    mimetype: file.mimetype,
    size: file.size,
  });
};
