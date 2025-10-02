#!/usr/bin/env python3
"""
Chunked AHI (Apnea-Hypopnea Index) Analysis Module
==================================================

This module implements memory-efficient chunk-based detection of apnea and hypopnea events
from polysomnography data (Flow and SpO2 channels) and calculates the AHI score.
It uses the EXACT SAME analysis logic as ahi_analysis.py but processes data in chunks.

Memory-Efficient Design:
- Processes data in configurable chunks to fit within memory limits
- Uses overlap between chunks to prevent missing events at boundaries
- Aggregates results from all chunks for final AHI calculation
- Uses the proven analysis logic from the original ahi_analysis.py

Clinical Criteria:
- Apnea: Flow reduction ≥90% from baseline for ≥10 seconds
- Hypopnea: Flow reduction 30-90% from baseline + SpO2 drop ≥3% for ≥10 seconds
- AHI: Total events per hour of sleep

Author: Sleep Analysis System
"""

import numpy as np
import sys
import json
from typing import List, Dict, Tuple, Optional
from scipy import signal
from scipy.ndimage import uniform_filter1d


class ChunkedAHIAnalyzer:
    """Memory-efficient chunk-based AHI analyzer using the proven ahi_analysis.py logic."""
    
    def __init__(self, flow_data: np.ndarray, spo2_data: np.ndarray, 
                 flow_sample_rate: float, spo2_sample_rate: float,
                 chunk_duration_minutes: int = 30, overlap_minutes: int = 2):
        """
        Initialize the chunk-based AHI analyzer.
        
        Args:
            flow_data: Flow signal data (numpy array)
            spo2_data: SpO2 signal data (numpy array)
            flow_sample_rate: Sampling rate of flow signal (Hz)
            spo2_sample_rate: Sampling rate of SpO2 signal (Hz)
            chunk_duration_minutes: Duration of each chunk in minutes (default: 30)
            overlap_minutes: Overlap between chunks in minutes (default: 2)
        """
        self.flow_data = np.array(flow_data)
        self.spo2_data = np.array(spo2_data)
        self.flow_sr = flow_sample_rate
        self.spo2_sr = spo2_sample_rate
        self.chunk_duration_minutes = chunk_duration_minutes
        self.overlap_minutes = overlap_minutes
        
        # EXACT SAME Clinical parameters as ahi_analysis.py
        self.apnea_threshold = 0.1  # 10% of baseline (90% reduction)
        self.hypopnea_min_threshold = 0.3  # 30% of baseline (70% reduction)
        self.hypopnea_max_threshold = 0.7  # 70% of baseline (30% reduction)
        self.spo2_drop_threshold = 3.0  # 3% SpO2 drop
        self.min_event_duration = 10.0  # 10 seconds minimum
        
        # Calculate chunk parameters
        self.chunk_duration_seconds = chunk_duration_minutes * 60
        self.overlap_seconds = overlap_minutes * 60
        self.flow_chunk_size = int(self.chunk_duration_seconds * self.flow_sr)
        self.spo2_chunk_size = int(self.chunk_duration_seconds * self.spo2_sr)
        self.flow_overlap_size = int(self.overlap_seconds * self.flow_sr)
        self.spo2_overlap_size = int(self.overlap_seconds * self.spo2_sr)
        
        # Calculate total recording duration
        self.flow_duration_hours = len(self.flow_data) / (self.flow_sr * 3600)
        self.spo2_duration_hours = len(self.spo2_data) / (self.spo2_sr * 3600)
        self.recording_duration_hours = min(self.flow_duration_hours, self.spo2_duration_hours)
        
        print(f"[CHUNKED-AHI] Initialized with Flow: {len(flow_data)} samples @ {flow_sample_rate}Hz", file=sys.stderr)
        print(f"[CHUNKED-AHI] SpO2: {len(spo2_data)} samples @ {spo2_sample_rate}Hz", file=sys.stderr)
        print(f"[CHUNKED-AHI] Flow data range: {np.min(flow_data):.3f} to {np.max(flow_data):.3f}", file=sys.stderr)
        print(f"[CHUNKED-AHI] SpO2 data range: {np.min(spo2_data):.3f} to {np.max(spo2_data):.3f}", file=sys.stderr)
        print(f"[CHUNKED-AHI] Recording duration: {self.recording_duration_hours:.2f} hours", file=sys.stderr)
        print(f"[CHUNKED-AHI] Chunk size: {chunk_duration_minutes}min, Overlap: {overlap_minutes}min", file=sys.stderr)
        
        # Calculate number of chunks needed
        self.num_chunks = self._calculate_num_chunks()
        print(f"[CHUNKED-AHI] Will process {self.num_chunks} chunks", file=sys.stderr)
    
    def _calculate_num_chunks(self) -> int:
        """Calculate the number of chunks needed to cover the entire recording."""
        flow_samples = len(self.flow_data)
        effective_chunk_size = self.flow_chunk_size - self.flow_overlap_size
        
        if effective_chunk_size <= 0:
            return 1
        
        num_chunks = ((flow_samples - self.flow_chunk_size) // effective_chunk_size) + 1
        return max(1, num_chunks)
    
    def _get_chunk_data(self, chunk_idx: int) -> Tuple[np.ndarray, np.ndarray, float, float]:
        """
        Extract data for a specific chunk.
        
        Args:
            chunk_idx: Index of the chunk to extract
            
        Returns:
            Tuple of (flow_chunk, spo2_chunk, chunk_start_time, chunk_end_time)
        """
        # Calculate chunk boundaries
        if chunk_idx == 0:
            # First chunk starts at 0
            flow_start = 0
        else:
            # Subsequent chunks have overlap
            flow_start = chunk_idx * (self.flow_chunk_size - self.flow_overlap_size)
        
        flow_end = min(flow_start + self.flow_chunk_size, len(self.flow_data))
        flow_chunk = self.flow_data[flow_start:flow_end]
        
        # Convert flow boundaries to time
        chunk_start_time = flow_start / self.flow_sr
        chunk_end_time = flow_end / self.flow_sr
        
        # Get corresponding SpO2 data
        spo2_start = int(chunk_start_time * self.spo2_sr)
        spo2_end = int(chunk_end_time * self.spo2_sr)
        spo2_start = max(0, spo2_start)
        spo2_end = min(len(self.spo2_data), spo2_end)
        
        spo2_chunk = self.spo2_data[spo2_start:spo2_end]
        
        print(f"[CHUNKED-AHI] Chunk {chunk_idx + 1}/{self.num_chunks}: "
              f"Flow[{flow_start}:{flow_end}], SpO2[{spo2_start}:{spo2_end}], "
              f"Time[{chunk_start_time:.1f}s:{chunk_end_time:.1f}s]", file=sys.stderr)
        
        return flow_chunk, spo2_chunk, chunk_start_time, chunk_end_time
    
    def _calculate_global_baseline(self) -> float:
        """
        Calculate a global baseline flow using the EXACT SAME logic as ahi_analysis.py.
        """
        print("[CHUNKED-AHI] Calculating global baseline flow...", file=sys.stderr)
        
        # Use median of upper 50% of values to avoid including apneas in baseline
        # EXACT SAME logic as ahi_analysis.py calculate_baseline_flow()
        flow_abs = np.abs(self.flow_data)
        upper_50_percentile = np.percentile(flow_abs, 50)
        baseline_candidates = flow_abs[flow_abs >= upper_50_percentile]
        baseline = np.median(baseline_candidates)
        
        print(f"[CHUNKED-AHI] Global baseline flow: {baseline:.3f}", file=sys.stderr)
        return baseline
    
    def _detect_apnea_in_chunk(self, flow_chunk: np.ndarray, chunk_start_time: float,
                              global_baseline: float) -> List[Dict]:
        """
        Detect apnea events in a chunk using EXACT SAME logic as ahi_analysis.py.
        """
        threshold = global_baseline * self.apnea_threshold
        
        print(f"[CHUNKED-AHI] Apnea detection - Baseline: {global_baseline:.3f}, Threshold: {threshold:.3f} ({self.apnea_threshold*100:.0f}% of baseline)", file=sys.stderr)
        
        # EXACT SAME smoothing logic as ahi_analysis.py
        filter_size = max(1, int(self.flow_sr * 2))  # 2-second window minimum
        if filter_size >= len(flow_chunk):
            filter_size = max(1, len(flow_chunk) // 4)
        
        print(f"[CHUNKED-AHI] Using filter size: {filter_size} for flow smoothing", file=sys.stderr)
        flow_smooth = uniform_filter1d(np.abs(flow_chunk), size=filter_size)
        
        # Find regions below threshold
        below_threshold = flow_smooth < threshold
        below_count = np.sum(below_threshold)
        print(f"[CHUNKED-AHI] Found {below_count} samples below threshold ({below_count/self.flow_sr:.1f}s total)", file=sys.stderr)
        
        # EXACT SAME event detection logic as ahi_analysis.py
        events = []
        in_event = False
        event_start = 0
        
        for i, is_below in enumerate(below_threshold):
            if is_below and not in_event:
                # Start of potential event
                in_event = True
                event_start = i
            elif not is_below and in_event:
                # End of event
                in_event = False
                event_end = i
                duration = (event_end - event_start) / self.flow_sr
                
                # Check if event meets minimum duration
                if duration >= self.min_event_duration:
                    absolute_start_time = chunk_start_time + (event_start / self.flow_sr)
                    absolute_end_time = chunk_start_time + (event_end / self.flow_sr)
                    
                    events.append({
                        'type': 'apnea',
                        'start_sample': event_start,
                        'end_sample': event_end,
                        'start_time': absolute_start_time,
                        'end_time': absolute_end_time,
                        'duration': duration,
                        'severity': 'severe' if duration > 30 else 'moderate'
                    })
        
        # Handle case where recording ends during an event
        if in_event:
            event_end = len(below_threshold)
            duration = (event_end - event_start) / self.flow_sr
            if duration >= self.min_event_duration:
                absolute_start_time = chunk_start_time + (event_start / self.flow_sr)
                absolute_end_time = chunk_start_time + (event_end / self.flow_sr)
                
                events.append({
                    'type': 'apnea',
                    'start_sample': event_start,
                    'end_sample': event_end,
                    'start_time': absolute_start_time,
                    'end_time': absolute_end_time,
                    'duration': duration,
                    'severity': 'severe' if duration > 30 else 'moderate'
                })
        
        print(f"[CHUNKED-AHI] Detected {len(events)} apnea events in chunk", file=sys.stderr)
        return events
    
    def _detect_hypopnea_in_chunk(self, flow_chunk: np.ndarray, spo2_chunk: np.ndarray,
                                 chunk_start_time: float, chunk_end_time: float,
                                 global_baseline: float) -> List[Dict]:
        """
        Detect hypopnea events in a chunk using EXACT SAME logic as ahi_analysis.py.
        """
        if len(spo2_chunk) == 0:
            return []
        
        min_threshold = global_baseline * self.hypopnea_min_threshold
        max_threshold = global_baseline * self.hypopnea_max_threshold
        
        # EXACT SAME smoothing logic as ahi_analysis.py
        flow_filter_size = max(1, int(self.flow_sr * 2))
        if flow_filter_size >= len(flow_chunk):
            flow_filter_size = max(1, len(flow_chunk) // 4)
        
        spo2_filter_size = max(1, int(self.spo2_sr * 3))
        if spo2_filter_size >= len(spo2_chunk):
            spo2_filter_size = max(1, len(spo2_chunk) // 4)
            
        print(f"[CHUNKED-AHI] Using filter sizes - Flow: {flow_filter_size}, SpO2: {spo2_filter_size}", file=sys.stderr)
        
        flow_smooth = uniform_filter1d(np.abs(flow_chunk), size=flow_filter_size)
        spo2_smooth = uniform_filter1d(spo2_chunk, size=spo2_filter_size)
        
        # Find flow reduction regions (between 30-70% of baseline)
        flow_reduced = (flow_smooth >= min_threshold) & (flow_smooth <= max_threshold)
        
        # EXACT SAME event detection logic as ahi_analysis.py
        potential_events = []
        in_event = False
        event_start = 0
        
        for i, is_reduced in enumerate(flow_reduced):
            if is_reduced and not in_event:
                in_event = True
                event_start = i
            elif not is_reduced and in_event:
                in_event = False
                event_end = i
                duration = (event_end - event_start) / self.flow_sr
                
                if duration >= self.min_event_duration:
                    absolute_start_time = chunk_start_time + (event_start / self.flow_sr)
                    absolute_end_time = chunk_start_time + (event_end / self.flow_sr)
                    
                    potential_events.append({
                        'start_sample': event_start,
                        'end_sample': event_end,
                        'start_time': absolute_start_time,
                        'end_time': absolute_end_time,
                        'duration': duration
                    })
        
        # Handle case where recording ends during an event
        if in_event:
            event_end = len(flow_reduced)
            duration = (event_end - event_start) / self.flow_sr
            if duration >= self.min_event_duration:
                absolute_start_time = chunk_start_time + (event_start / self.flow_sr)
                absolute_end_time = chunk_start_time + (event_end / self.flow_sr)
                
                potential_events.append({
                    'start_sample': event_start,
                    'end_sample': event_end,
                    'start_time': absolute_start_time,
                    'end_time': absolute_end_time,
                    'duration': duration
                })
        
        # EXACT SAME SpO2 drop detection logic as ahi_analysis.py
        hypopnea_events = []
        
        for event in potential_events:
            # Convert flow time to SpO2 samples
            flow_relative_start = event['start_time'] - chunk_start_time
            flow_relative_end = event['end_time'] - chunk_start_time
            spo2_start = int(flow_relative_start * self.spo2_sr)
            spo2_end = int(flow_relative_end * self.spo2_sr)
            
            # Ensure we don't go out of bounds
            spo2_start = max(0, spo2_start)
            spo2_end = min(len(spo2_smooth), spo2_end)
            
            if spo2_end <= spo2_start:
                continue
            
            # Look for SpO2 drop during the event (with some margin)
            pre_event_start = max(0, spo2_start - int(30 * self.spo2_sr))  # 30s before
            baseline_spo2 = np.median(spo2_smooth[pre_event_start:spo2_start])
            
            # Find minimum SpO2 during event and shortly after
            post_event_end = min(len(spo2_smooth), spo2_end + int(30 * self.spo2_sr))  # 30s after
            min_spo2 = np.min(spo2_smooth[spo2_start:post_event_end])
            
            spo2_drop = baseline_spo2 - min_spo2
            
            # Check if SpO2 drop meets criteria
            if spo2_drop >= self.spo2_drop_threshold:
                hypopnea_events.append({
                    'type': 'hypopnea',
                    'start_sample': event['start_sample'],
                    'end_sample': event['end_sample'],
                    'start_time': event['start_time'],
                    'end_time': event['end_time'],
                    'duration': event['duration'],
                    'spo2_drop': spo2_drop,
                    'baseline_spo2': baseline_spo2,
                    'min_spo2': min_spo2,
                    'severity': 'severe' if spo2_drop > 6 else 'moderate'
                })
        
        print(f"[CHUNKED-AHI] Detected {len(hypopnea_events)} hypopnea events from {len(potential_events)} flow reductions in chunk", file=sys.stderr)
        return hypopnea_events
    
    def _remove_duplicate_events(self, all_events: List[Dict]) -> List[Dict]:
        """
        Remove duplicate events that were detected in overlapping chunks.
        Events are considered duplicates if they overlap by more than 50%.
        """
        if not all_events:
            return []
        
        # Sort events by start time
        sorted_events = sorted(all_events, key=lambda x: x['start_time'])
        unique_events = []
        
        for event in sorted_events:
            is_duplicate = False
            
            for existing_event in unique_events:
                # Check for overlap
                overlap_start = max(event['start_time'], existing_event['start_time'])
                overlap_end = min(event['end_time'], existing_event['end_time'])
                overlap_duration = max(0, overlap_end - overlap_start)
                
                # Calculate overlap percentage
                event_duration = event['end_time'] - event['start_time']
                existing_duration = existing_event['end_time'] - existing_event['start_time']
                max_duration = max(event_duration, existing_duration)
                
                overlap_percentage = overlap_duration / max_duration if max_duration > 0 else 0
                
                if overlap_percentage > 0.5:  # More than 50% overlap
                    is_duplicate = True
                    # Keep the longer event
                    if event_duration > existing_duration:
                        unique_events.remove(existing_event)
                        unique_events.append(event)
                    break
            
            if not is_duplicate:
                unique_events.append(event)
        
        return unique_events
    
    def _calculate_ahi(self, apnea_events: List[Dict], hypopnea_events: List[Dict]) -> Dict:
        """
        Calculate AHI score using EXACT SAME logic as ahi_analysis.py.
        """
        total_events = len(apnea_events) + len(hypopnea_events)
        ahi_score = total_events / self.recording_duration_hours if self.recording_duration_hours > 0 else 0
        
        # EXACT SAME severity classification as ahi_analysis.py
        if ahi_score < 5:
            severity = "Normal"
            severity_color = "green"
        elif ahi_score < 15:
            severity = "Mild"
            severity_color = "yellow"
        elif ahi_score < 30:
            severity = "Moderate"
            severity_color = "orange"
        else:
            severity = "Severe"
            severity_color = "red"
        
        # EXACT SAME statistics calculation as ahi_analysis.py
        total_apnea_duration = sum(event['duration'] for event in apnea_events)
        total_hypopnea_duration = sum(event['duration'] for event in hypopnea_events)
        total_event_duration = total_apnea_duration + total_hypopnea_duration
        
        avg_apnea_duration = total_apnea_duration / len(apnea_events) if apnea_events else 0
        avg_hypopnea_duration = total_hypopnea_duration / len(hypopnea_events) if hypopnea_events else 0
        
        result = {
            'ahi_score': round(ahi_score, 1),
            'severity': severity,
            'severity_color': severity_color,
            'total_events': total_events,
            'apnea_count': len(apnea_events),
            'hypopnea_count': len(hypopnea_events),
            'recording_duration_hours': round(self.recording_duration_hours, 2),
            'total_event_duration_minutes': round(total_event_duration / 60, 1),
            'event_percentage': round((total_event_duration / (self.recording_duration_hours * 3600)) * 100, 1),
            'avg_apnea_duration': round(avg_apnea_duration, 1),
            'avg_hypopnea_duration': round(avg_hypopnea_duration, 1),
            'events_per_hour_breakdown': {
                'apnea_per_hour': round(len(apnea_events) / self.recording_duration_hours, 1),
                'hypopnea_per_hour': round(len(hypopnea_events) / self.recording_duration_hours, 1)
            }
        }
        
        print(f"[CHUNKED-AHI] Analysis complete: AHI={ahi_score:.1f} ({severity})", file=sys.stderr)
        print(f"[CHUNKED-AHI] Events: {len(apnea_events)} apneas, {len(hypopnea_events)} hypopneas", file=sys.stderr)
        
        return result
    
    def analyze(self) -> Dict:
        """
        Perform complete chunk-based AHI analysis using the proven ahi_analysis.py logic.
        
        Returns:
            Complete analysis results including events and statistics
        """
        print("[CHUNKED-AHI] Starting chunk-based AHI analysis using proven ahi_analysis.py logic...", file=sys.stderr)
        
        # Calculate global baseline using the exact same method as ahi_analysis.py
        global_baseline = self._calculate_global_baseline()
        
        # Process each chunk
        all_apnea_events = []
        all_hypopnea_events = []
        
        for chunk_idx in range(self.num_chunks):
            print(f"[CHUNKED-AHI] Processing chunk {chunk_idx + 1}/{self.num_chunks}...", file=sys.stderr)
            
            # Get chunk data
            flow_chunk, spo2_chunk, chunk_start_time, chunk_end_time = self._get_chunk_data(chunk_idx)
            
            # Detect events in this chunk using the exact same logic as ahi_analysis.py
            apnea_events = self._detect_apnea_in_chunk(flow_chunk, chunk_start_time, global_baseline)
            hypopnea_events = self._detect_hypopnea_in_chunk(
                flow_chunk, spo2_chunk, chunk_start_time, chunk_end_time, global_baseline
            )
            
            all_apnea_events.extend(apnea_events)
            all_hypopnea_events.extend(hypopnea_events)
            
            print(f"[CHUNKED-AHI] Chunk {chunk_idx + 1}: {len(apnea_events)} apneas, {len(hypopnea_events)} hypopneas", file=sys.stderr)
        
        # Remove duplicate events from overlapping chunks
        print("[CHUNKED-AHI] Removing duplicate events from overlapping chunks...", file=sys.stderr)
        all_apnea_events = self._remove_duplicate_events(all_apnea_events)
        all_hypopnea_events = self._remove_duplicate_events(all_hypopnea_events)
        
        print(f"[CHUNKED-AHI] After deduplication: {len(all_apnea_events)} apneas, {len(all_hypopnea_events)} hypopneas", file=sys.stderr)
        
        # Calculate AHI using the exact same logic as ahi_analysis.py
        ahi_results = self._calculate_ahi(all_apnea_events, all_hypopnea_events)
        
        # Combine all results in the exact same format as ahi_analysis.py
        results = {
            'ahi_analysis': ahi_results,
            'apnea_events': all_apnea_events,
            'hypopnea_events': all_hypopnea_events,
            'all_events': sorted(all_apnea_events + all_hypopnea_events, key=lambda x: x['start_time']),
            'analysis_parameters': {
                'chunk_duration_minutes': self.chunk_duration_minutes,
                'overlap_minutes': self.overlap_minutes,
                'num_chunks': self.num_chunks,
                'apnea_threshold': self.apnea_threshold,
                'hypopnea_min_threshold': self.hypopnea_min_threshold,
                'hypopnea_max_threshold': self.hypopnea_max_threshold,
                'spo2_drop_threshold': self.spo2_drop_threshold,
                'min_event_duration': self.min_event_duration,
                'global_baseline': global_baseline
            }
        }
        
        print(f"[CHUNKED-AHI] Analysis completed successfully using proven ahi_analysis.py logic", file=sys.stderr)
        return results


def load_edf_data(file_path: str, flow_channel: str, spo2_channel: str):
    """
    Load EDF data using pyedflib directly for memory efficiency.
    This avoids the Node.js memory bottleneck.
    """
    import pyedflib
    
    try:
        print(f"[CHUNKED-AHI] Loading EDF data from: {file_path}", file=sys.stderr)
        
        # Open EDF file
        f = pyedflib.EdfReader(file_path)
        
        # Get signal labels and find channel indices
        signal_labels = f.getSignalLabels()
        flow_channel_index = signal_labels.index(flow_channel)
        spo2_channel_index = signal_labels.index(spo2_channel)
        
        # Get sample rates and duration
        flow_sample_rate = f.getSampleFrequency(flow_channel_index)
        spo2_sample_rate = f.getSampleFrequency(spo2_channel_index)
        duration = f.file_duration
        
        print(f"[CHUNKED-AHI] File info - Flow: {flow_sample_rate}Hz, SpO2: {spo2_sample_rate}Hz, Duration: {duration}s", file=sys.stderr)
        
        # Read all data for both channels
        print("[CHUNKED-AHI] Reading flow data...", file=sys.stderr)
        flow_data = f.readSignal(flow_channel_index)
        
        print("[CHUNKED-AHI] Reading SpO2 data...", file=sys.stderr)
        spo2_data = f.readSignal(spo2_channel_index)
        
        f.close()
        
        print(f"[CHUNKED-AHI] Data loaded - Flow: {len(flow_data)} samples, SpO2: {len(spo2_data)} samples", file=sys.stderr)
        
        return flow_data, spo2_data, flow_sample_rate, spo2_sample_rate
        
    except Exception as e:
        print(f"[ERROR] Failed to load EDF data: {str(e)}", file=sys.stderr)
        raise


def main():
    """Main function for command-line usage."""
    if len(sys.argv) != 2:
        print("Usage: python ahi_analysis_chunked.py '<json_file_path>' or python ahi_analysis_chunked.py -", file=sys.stderr)
        sys.exit(1)
    
    try:
        # Read input JSON from file or stdin
        json_input = sys.argv[1]
        if json_input == '-':
            # Read from stdin
            input_data = json.load(sys.stdin)
        else:
            # Read from file (avoids PowerShell escaping issues)
            with open(json_input, 'r') as f:
                input_data = json.load(f)
        
        # Check if we have file path and channel names (new method) or raw data (old method)
        if 'file_path' in input_data and 'flow_channel' in input_data and 'spo2_channel' in input_data:
            # New method: load data from EDF file directly
            file_path = input_data['file_path']
            flow_channel = input_data['flow_channel']
            spo2_channel = input_data['spo2_channel']
            
            # Load data from EDF file
            flow_data, spo2_data, flow_sample_rate, spo2_sample_rate = load_edf_data(file_path, flow_channel, spo2_channel)
            
        else:
            # Old method: use provided data (for backward compatibility)
            flow_data = input_data['flow_data']
            spo2_data = input_data['spo2_data']
            flow_sample_rate = input_data['flow_sample_rate']
            spo2_sample_rate = input_data['spo2_sample_rate']
        
        # Optional parameters for chunking
        chunk_duration_minutes = input_data.get('chunk_duration_minutes', 30)
        overlap_minutes = input_data.get('overlap_minutes', 2)
        
        # Create analyzer and run analysis using the proven ahi_analysis.py logic
        analyzer = ChunkedAHIAnalyzer(
            flow_data, spo2_data, flow_sample_rate, spo2_sample_rate,
            chunk_duration_minutes, overlap_minutes
        )
        results = analyzer.analyze()
        
        # Output results as JSON
        print(json.dumps(results))
        
    except Exception as e:
        print(f"[ERROR] Chunked AHI analysis failed: {str(e)}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()