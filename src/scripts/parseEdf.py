import sys
import json
import os
import traceback
from pyedflib import EdfReader
import numpy as np
from mne.io import read_raw_edf

def error_response(message):
    print(json.dumps({"error": message}))
    sys.exit(1)

def downsample_stride(data, target_points):
    """Downsample by uniform stride selection to approximately target_points."""
    length = len(data)
    if length <= target_points:
        # Ensure list output
        return data.tolist() if isinstance(data, np.ndarray) else list(data)
    step = max(1, length // target_points)
    sliced = data[::step]
    return sliced.tolist() if isinstance(sliced, np.ndarray) else list(sliced)

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

            # Get number of samples for each channel (convert to regular int for JSON serialization)
            num_samples = [int(f.getNSamples()[i]) for i in range(signal_count)]
            
            print(f"[DEBUG] Number of samples: {num_samples}", file=sys.stderr)

            return {
                "signalLabels": signal_labels,
                "signalCount": signal_count,
                "duration": duration,
                "frequencies": frequencies,
                "numSamples": num_samples,  # Added missing field
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

            # Downsampling (unified stride-based)
            if max_points is not None and len(chunk_data) > max_points:
                chunk_data = downsample_stride(np.array(chunk_data), int(max_points))
                print(f"[DEBUG] Downsampled (stride) na {len(chunk_data)} točaka.", file=sys.stderr)
            else:
                chunk_data = chunk_data.tolist()

            return {"data": chunk_data}

    except Exception as e:
        print("[ERROR] Exception prilikom dohvaćanja chunk podataka:", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        error_response(str(e))

def get_multi_channel_chunk(file_path, channels, start_sec, end_sec, max_points):
    import numpy as np
    try:
        print(f"[DEBUG] Multi-channel loading: {file_path}", file=sys.stderr)
        print(f"[DEBUG] Channels: {channels}", file=sys.stderr)
        print(f"[DEBUG] Range (sec): {start_sec} to {end_sec}, max_points: {max_points}", file=sys.stderr)

        start_sec = float(start_sec)
        end_sec = float(end_sec)
        max_points = int(max_points)
        time_range = max(0.0, end_sec - start_sec)
        if time_range <= 0:
            print("[ERROR] Invalid time range.", file=sys.stderr)
            return {"labels": [], "channels": {}}

        response = {"labels": [], "channels": {}}

        # Read EDF using pyedflib for per-channel sampling rates
        with EdfReader(file_path) as f:
            available_channels = f.getSignalLabels()
            print(f"[DEBUG] Available channels: {available_channels[:5]}...", file=sys.stderr)

            # Base timestamp from file start
            start_dt = f.getStartdatetime()
            base_timestamp = start_dt.timestamp() * 1000 if start_dt else 0

            per_channel_data = {}
            per_channel_lengths = []

            for ch in channels:
                try:
                    # Normalize mapping
                    if ch not in available_channels:
                        normalized = { name.strip().lower(): idx for idx, name in enumerate(available_channels) }
                        key = ch.strip().lower()
                        if key in normalized:
                            ch_idx = normalized[key]
                            ch_use = available_channels[ch_idx]
                            print(f"[DEBUG] Mapping requested channel '{ch}' to '{ch_use}'", file=sys.stderr)
                        else:
                            print(f"[DEBUG] Channel {ch} not found; skipping", file=sys.stderr)
                            continue
                    else:
                        ch_idx = available_channels.index(ch)
                        ch_use = ch

                    sfreq = float(f.getSampleFrequency(ch_idx))
                    total_len = int(f.getNSamples()[ch_idx])
                    start_sample = max(0, int(start_sec * sfreq))
                    end_sample = min(total_len, max(start_sample + 1, int(end_sec * sfreq)))
                    seg_len = max(0, end_sample - start_sample)
                    print(f"[DEBUG] {ch_use}: sfreq={sfreq}, sample range={start_sample}-{end_sample} (len={seg_len})", file=sys.stderr)
                    if seg_len <= 0:
                        continue

                    raw_signal = f.readSignal(ch_idx, start_sample, seg_len)
                    arr = np.asarray(raw_signal, dtype=float)
                    per_channel_data[ch] = arr
                    per_channel_lengths.append(len(arr))
                except Exception as e:
                    print(f"[ERROR] Failed reading channel {ch}: {e}", file=sys.stderr)
                    continue

            if not per_channel_data:
                print("[ERROR] No channels could be read.", file=sys.stderr)
                return {"labels": [], "channels": {}}

            # Decide unified number of points
            desired_points = max(2, min(max_points, min(per_channel_lengths)))
            print(f"[DEBUG] desired_points={desired_points}", file=sys.stderr)

            # Build labels uniformly over the requested time span
            times = start_sec + (np.arange(desired_points) * (time_range / desired_points))
            response["labels"] = (times * 1000 + base_timestamp).tolist()

            # Downsample each channel to desired_points by uniform index mapping
            for ch, data in per_channel_data.items():
                n = len(data)
                if n == desired_points:
                    ds = data
                else:
                    idx = np.floor(np.linspace(0, n - 1, desired_points)).astype(int)
                    ds = data[idx]
                response["channels"][ch] = ds.tolist()

        print(f"[DEBUG] Multi-channel chunk built: labels={len(response['labels'])}, channels={len(response['channels'])}", file=sys.stderr)
        return response
    except Exception as e:
        print(f"[ERROR] Exception in get_multi_channel_chunk: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
        raise e

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
elif command == "chunk-downsample":
    if len(sys.argv) < 7:
        print("[ERROR] Nedovoljno argumenata za 'chunk-downsample'", file=sys.stderr)
        sys.exit(1)

    file_path = sys.argv[2]
    channel_label = sys.argv[3]
    start_sample = int(float(sys.argv[4]))
    num_samples = int(float(sys.argv[5]))
    target_points = int(float(sys.argv[6]))

    if num_samples <= 0:
     print(f"[ERROR] num_samples <= 0 ({num_samples}) — ne mogu dohvatiti chunk!", file=sys.stderr)
     sys.exit(1)

    try:
        with EdfReader(file_path) as f:
            signal_labels = f.getSignalLabels()
            if channel_label not in signal_labels:
                print(f"[ERROR] Kanal '{channel_label}' nije pronađen.", file=sys.stderr)
                sys.exit(1)

            channel_index = signal_labels.index(channel_label)
            total_length = f.getNSamples()[channel_index]

            end_sample = min(start_sample + num_samples, total_length)

            raw_signal = f.readSignal(channel_index, start_sample, end_sample - start_sample)
            if len(raw_signal) == 0:
                print(f"[ERROR] Prazan signal — ništa za downsample. Kanal: {channel_label}, start: {start_sample}, num: {num_samples}", file=sys.stderr)
                sys.exit(1)

            # Downsampling (unified stride-based)
            downsampled = downsample_stride(np.array(raw_signal), target_points)

            # Statistika
            stats = {
                "mean": float(np.mean(raw_signal)),
                "median": float(np.median(raw_signal)),
                "min": float(np.min(raw_signal)),
                "max": float(np.max(raw_signal)),
                "stddev": float(np.std(raw_signal))
            }

            print(json.dumps({
                "data": downsampled,
                "stats": stats
            }))

    except Exception as e:
        print(f"[ERROR] Exception in 'chunk-downsample': {e}", file=sys.stderr)
        sys.exit(1)
        
elif command == "multi-chunk-downsample":
    try:
        file_path = sys.argv[2]
        channel_list = json.loads(sys.argv[3])  # expects '["Ch1", "Ch2"]'
        start_sec = float(sys.argv[4])
        end_sec = float(sys.argv[5])
        max_points = int(float(sys.argv[6]))
        
        print(f"[DEBUG] Multi-chunk command parsed: {len(channel_list)} channels, {start_sec}-{end_sec} sec, max_points={max_points}", file=sys.stderr)
        
        result = get_multi_channel_chunk(file_path, channel_list, start_sec, end_sec, max_points)
        print(json.dumps(result))
    except Exception as e:
        print(f"[ERROR] Exception in 'multi-chunk-downsample': {e}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)
else:
    error_response(f"Unknown command: {command}. Use 'info', 'chunk', or 'chunk-downsample'.")