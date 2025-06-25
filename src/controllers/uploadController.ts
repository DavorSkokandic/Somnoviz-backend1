// src/controllers/uploadController.ts

import { Request, Response } from "express";
import { spawn } from "child_process";
import path from "path";
import fs from "fs";

export const handleFileUpload = async (req: Request, res: Response) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: "No file uploaded." });

    const filePath = path.resolve(file.path);
    const pythonScriptPath = path.resolve("src/scripts/parseEdF.py");
    const python = spawn("python", [pythonScriptPath, "info", filePath]);

    let output = "";
    let errorOutput = "";

    python.stdout.on("data", (data) => {
      output += data.toString();
    });

    python.stderr.on("data", (data) => {
      const err = data.toString();
      errorOutput += err;
      console.error("[PYTHON STDERR]", err);
    });

    python.on("close", (code) => {
      if (code === 0) {
        const parsed = JSON.parse(output);

        const response = {
          channels: parsed.signalLabels,
          sampleRates: parsed.frequencies,
          duration: parsed.duration,
          startTime: parsed.startTime,
          previewData: {},
          diagnostics: {},
          patientInfo: parsed.patientInfo || "Nepoznat pacijent",
          recordingInfo: parsed.recordingInfo || "Nepoznata snimka",
          tempFilePath: filePath,
          originalFileName: file.originalname,
        };

        res.json(response);
      } else {
        console.error("Python error:", errorOutput);
        res.status(500).json({ error: "Greška pri obradi fajla.", details: errorOutput });
      }
    });
  } catch (error) {
    console.error("Server error:", error);
    res.status(500).json({ error: "Internal server error." });
  }
};
export const handleEdfChunk = async (req: Request, res: Response) => {
  const { filePath, channel, start_sample, num_samples } = req.query;

  if (!filePath || !channel || !start_sample || !num_samples) {
    return res.status(400).json({ error: "Nedostaju parametri." });
  }

  const decodedPath = decodeURIComponent(filePath as string);
  if (!fs.existsSync(decodedPath)) {
    return res.status(404).json({ error: "Fajl ne postoji." });
  }

  const pythonScriptPath = path.resolve("src/scripts/parseEdF.py");
  const args = [pythonScriptPath, "chunk", decodedPath, channel as string, start_sample as string, num_samples as string];

  console.log("Executing Python chunk script with:", args.join(" "));

  const python = spawn("python", args);

  let output = "";
  let errorOutput = "";

  python.stdout.on("data", (data) => {
    output += data.toString();
  });

  python.stderr.on("data", (data) => {
    const err = data.toString();
    errorOutput += err;
    console.error("[PYTHON STDERR]", err);
  });

  python.on("close", (code) => {
    if (code === 0) {
      const parsed = JSON.parse(output);
      res.json(parsed);
    } else {
      console.error("Python error:", errorOutput);
      res.status(500).json({ error: "Greška pri dohvaćanju chunka.", details: errorOutput });
    }
  });
};

export const handleEdfChunkDownsample = async (req: Request, res: Response) => {
  try {
    const { filePath, channel, start_sample, num_samples, target_points } = req.query;

    if (!filePath || !channel || !start_sample || !num_samples || !target_points) {
      return res.status(400).json({ error: "Missing required query parameters." });
    }

    const scriptPath = path.resolve('src/scripts/parseEdF.py');
    const python = spawn('python', [
      scriptPath,
      'chunk-downsample',
      String(filePath),
      String(channel),
      String(start_sample),
      String(num_samples),
      String(target_points),
    ]);

    let output = '';
    let errorOutput = '';

    python.stdout.on('data', (data) => (output += data.toString()));
    python.stderr.on('data', (data) => (errorOutput += data.toString()));

    python.on('close', (code) => {
      if (code === 0) {
        try {
          res.json(JSON.parse(output));
        } catch (e) {
          res.status(500).json({ error: "Failed to parse Python response." });
        }
      } else {
        console.error("Python error:", errorOutput);
        res.status(500).json({ error: "Failed to parse chunk", details: errorOutput });
      }
    });
  } catch (err) {
    console.error("Controller error:", err);
    res.status(500).json({ error: "Internal server error." });
  }
};
