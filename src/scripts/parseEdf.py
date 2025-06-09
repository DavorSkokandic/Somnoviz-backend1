import sys
import json
import numpy as np
import pyedflib

def parse_edf(file_path):
    f = pyedflib.EdfReader(file_path)
    n = f.signals_in_file
    channels = f.getSignalLabels()
    sample_rate = f.getSampleFrequency(0)
    duration = f.getNSamples()[0] / sample_rate
    start_time = f.getStartdatetime().strftime('%Y-%m-%d %H:%M:%S') if f.getStartdatetime() else ""

    preview_data = {}
    diagnostics = {}

    for i in range(n):
        signal = f.readSignal(i)
        preview_data[channels[i]] = signal[:100].tolist()
        diagnostics[channels[i]] = {
            "min": float(np.min(signal)),
            "max": float(np.max(signal)),
            "mean": float(np.mean(signal)),
            "num_samples": len(signal)
        }

    f.close()

    return {
        "channels": channels,
        "sampleRate": sample_rate,
        "duration": duration,
        "startTime": start_time,
        "previewData": preview_data,
        "diagnostics": diagnostics
    }

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Missing file path argument"}))
        sys.exit(1)
    file_path = sys.argv[1]
    try:
        result = parse_edf(file_path)
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)
