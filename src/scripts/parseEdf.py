import sys
import json
import os
import traceback
from pyedflib import EdfReader

def error_response(message):
    print(json.dumps({"error": message}))
    sys.exit(1)

def downsample_minmax(data, target_points):
    if len(data) <= target_points:
        return data
    factor = len(data) // target_points
    downsampled = []
    for i in range(0, len(data), factor):
        segment = data[i:i+factor]
        downsampled.append(float(np.min(segment)))
        downsampled.append(float(np.max(segment)))
    return downsampled[:target_points]

def get_edf_info(file_path):
    print(f"[DEBUG] Provjera postoji li fajl: {file_path}", file=sys.stderr)
    if not os.path.exists(file_path):
        error_response(f"File not found: {file_path}")

    try:
        print("[DEBUG] Otvaram EDF fajl za info...", file=sys.stderr)
        with EdfReader(file_path) as f:
            signal_labels = f.getSignalLabels()
            signal_count = f.signals_in_file
            duration = f.getFileDuration()
            frequencies = [f.getSampleFrequency(i) for i in range(signal_count)]
            start_time_obj = f.getStartdatetime()
            start_time = start_time_obj.isoformat() if start_time_obj else ""
            patient_info = f.getPatientCode()
            recording_info = f.getRecordingAdditional()

            print(f"[DEBUG] Signal count: {signal_count}", file=sys.stderr)
            print(f"[DEBUG] Signal labels: {signal_labels}", file=sys.stderr)
            print(f"[DEBUG] Duration: {duration}", file=sys.stderr)
            print(f"[DEBUG] Frequencies: {frequencies}", file=sys.stderr)
            print(f"[DEBUG] Start time: {start_time}", file=sys.stderr)
            print(f"[DEBUG] Patient info: {patient_info}", file=sys.stderr)
            print(f"[DEBUG] Recording info: {recording_info}", file=sys.stderr)

            return {
                "signalLabels": signal_labels,
                "signalCount": signal_count,
                "duration": duration,
                "frequencies": frequencies,
                "startTime": start_time,
                "patientInfo": patient_info,
                "recordingInfo": recording_info
            }
    except Exception as e:
        print("[ERROR] Exception prilikom parsiranja EDF fajla za info:", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        error_response(str(e))

def get_chunk(file_path, channel, start_sample, num_samples, max_points=None):
    print(f"[DEBUG] Provjera postoji li fajl za chunk: {file_path}", file=sys.stderr)
    if not os.path.exists(file_path):
        error_response(f"File not found: {file_path}")

    try:
        print("[DEBUG] Otvaram EDF fajl za chunk...", file=sys.stderr)
        with EdfReader(file_path) as f:
            signal_labels = f.getSignalLabels()
            print(f"[DEBUG] Dostupni kanali: {signal_labels}", file=sys.stderr)
            if channel not in signal_labels:
                error_response(f"Channel '{channel}' not found in EDF file")

            channel_idx = signal_labels.index(channel)
            print(f"[DEBUG] Indeks kanala '{channel}': {channel_idx}", file=sys.stderr)
            signal = f.readSignal(channel_idx)
            signal_length = len(signal)
            print(f"[DEBUG] Duljina signala za kanal '{channel}': {signal_length}", file=sys.stderr)

            start = int(start_sample)
            end = start + int(num_samples)
            print(f"[DEBUG] Dohvaćam uzorke od {start} do {end}", file=sys.stderr)

            if start < 0 or end > signal_length:
                error_response(f"Invalid sample range: start={start}, end={end}, signal length={signal_length}")

            chunk_data = signal[start:end]
            print(f"[DEBUG] Veličina chunk podataka: {len(chunk_data)}", file=sys.stderr)

            # Downsampling
            if max_points is not None and len(chunk_data) > max_points:
                chunk_data = downsample_minmax(chunk_data, max_points)
                print(f"[DEBUG] Downsampled na {len(chunk_data)} točaka.", file=sys.stderr)
            else:
                chunk_data = chunk_data.tolist()

            return {"data": chunk_data}

    except Exception as e:
        print("[ERROR] Exception prilikom dohvaćanja chunk podataka:", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        error_response(str(e))


if __name__ == "__main__":
    print(f"[DEBUG] Primljeni argumenti: {sys.argv}", file=sys.stderr)

    if len(sys.argv) < 3:
        error_response("Missing arguments. Usage: parseEdF.py <command> <file_path> [additional args]")

    command = sys.argv[1]
    file_path = sys.argv[2]

    print(f"[DEBUG] Komanda: {command}", file=sys.stderr)
    print(f"[DEBUG] Putanja fajla: {file_path}", file=sys.stderr)

    if command == "info":
        result = get_edf_info(file_path)
        print(json.dumps(result))
    elif command == "chunk":
        if len(sys.argv) < 6:
            error_response("Missing arguments for chunk. Usage: parseEdF.py chunk <file_path> <channel> <start_sample> <num_samples> [max_points]")
        channel = sys.argv[3]
        start_sample = sys.argv[4]
        num_samples = sys.argv[5]
        max_points = int(sys.argv[6]) if len(sys.argv) > 6 else None
        result = get_chunk(file_path, channel, start_sample, num_samples, max_points)
        print(json.dumps(result))
    else:
        error_response(f"Unknown command: {command}. Use 'info' or 'chunk'.")