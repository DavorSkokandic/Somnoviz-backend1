import { Request, Response } from "express";
import path from "path";
import { execFile } from "child_process";
import fs from "fs";

export const handleFileUpload = async (
  req: Request,
  res: Response
): Promise<void> => {
  const file = req.file;

  if (!file) {
    res.status(400).json({ error: "No file uploaded." });
    return;
  }

  const filePath = path.resolve(file.path);
  const pythonScriptPath = path.resolve(__dirname, "../scripts/parseEdf.py");

  execFile("python", [pythonScriptPath, filePath], (error, stdout, stderr) => {
    fs.unlink(filePath, (err) => {
      if (err) console.error("Failed to delete uploaded file:", err);
    });

    if (error) {
      console.error("Python error:", error, stderr);
      return res.status(500).json({ error: "Failed to parse EDF file." });
    }

    try {
      const data = JSON.parse(stdout);
      if (data.error) {
        console.error("Python skripta vratila grešku:", data.error);
        return res.status(500).json({ error: data.error });
      }
      res.json(data);
    } catch (parseError) {
      console.error("JSON parse error:", parseError, stdout);
      res.status(500).json({ error: "Invalid response from parser." });
    }
  });
};
